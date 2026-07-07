#!/usr/bin/env python3
"""Sidecar de inferência (torch) para o app Go/Wails.

Roda os modelos treinados na pesquisa (PAVIC/UFPI) sobre uma imagem de carcaça:

  1. Segmentação de gordura  (fat_binary)   — ColorNaming LUT + CNN decoder.
     Resultado VALIDADO pela pesquisa (IoU ~0.92). Produz máscara de gordura e
     a fração de gordura (%) da carcaça.

  2. Grau de acabamento      (direct_class) — EXPERIMENTAL / NÃO validado.
  3. EG / medida contínua    (eg_regression) — EXPERIMENTAL / NÃO validado.

  Os modelos de grau vêm de n=22 com pareamento incerto (ver
  docs/avaliacao_carcaca_por_foto.tex): acurácia instável (0.25–0.80 entre folds).
  Por isso o app os marca como experimentais e não como referência.

As arquiteturas são reconstruídas a partir do state_dict (shapes determinísticos)
e carregadas com strict=True — se carregar sem erro, a reconstrução é fiel.

Protocolo (uma linha JSON por comando em stdin -> uma resposta JSON em stdout):
  {"cmd":"probe"}
      -> {"ok":true,"available":bool,"device":"cpu|mps|cuda","models":{...},"detail":"..."}
  {"cmd":"infer","image":"/abs/img.jpg","outDir":"/abs/out","prefix":"an_x",
   "runGrade":true}
      -> {"ok":true,"fatPercent":..,"maskPath":"..","overlayPath":"..",
          "finishingClass":"..","finishingProbs":{..},"egValue":..,
          "gradeExperimental":true}
"""
import json
import os
import sys
import traceback

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "model", "weights")
MODEL_DIR = os.path.abspath(os.environ.get("CARCASS_MODEL_DIR", MODEL_DIR))

FAT_W = os.path.join(MODEL_DIR, "fat_binary.pth")
CLASS_W = os.path.join(MODEL_DIR, "direct_class.pth")
EG_W = os.path.join(MODEL_DIR, "eg_regression.pth")
LUT = os.path.join(MODEL_DIR, "joost_color_naming.mat")

FINISHING_CLASSES = ["Magro", "Escasso", "Mediano"]  # do config do direct_class
SEG_SIZE = 512   # fat_binary treinado em 512
GRADE_SIZE = 256 # direct_class / eg_regression treinados em 256


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Arquiteturas (reconstruídas a partir dos state_dicts dos checkpoints)
# ---------------------------------------------------------------------------

def _build_torch():
    import torch
    import torch.nn as nn

    class ColorNamingFrontend(nn.Module):
        """LUT ColorNaming (Van de Weijer et al.): RGB[0-255] -> 11 mapas de cor.
        Índice = floor(R/8) + 32*floor(G/8) + 1024*floor(B/8)."""

        def __init__(self, lut):
            super().__init__()
            self.register_buffer("lookup_table", lut)  # (32768, 11)

        def forward(self, x):  # x: (B,3,H,W) em [0,255]
            B, C, H, W = x.shape
            q = (x / 8.0).long().clamp(0, 31)
            idx = q[:, 0] + q[:, 1] * 32 + q[:, 2] * 1024  # (B,H,W)
            feat = self.lookup_table[idx.view(-1)]          # (B*H*W, 11)
            return feat.view(B, H, W, 11).permute(0, 3, 1, 2).contiguous()

    class ConvDecoderSeg(nn.Module):
        """fat_binary: frontend + decoder Sequential (Conv-BN-ReLU x3 + Conv1x1).
        Índices do Sequential: 0 Conv,1 BN,2 ReLU,3 Conv,4 BN,5 ReLU,6 Conv,7 BN,8 ReLU,9 Conv1x1."""

        def __init__(self, lut, num_classes=1):
            super().__init__()
            self.frontend = ColorNamingFrontend(lut)
            self.decoder = nn.Module()
            self.decoder.decoder = nn.Sequential(
                nn.Conv2d(11, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                nn.Conv2d(64, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                nn.Conv2d(64, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(inplace=True),
                nn.Conv2d(32, num_classes, 1),
            )

        def forward(self, x):
            return self.decoder.decoder(self.frontend(x))

    def _enc_block(cin, cout, pool=True):
        layers = [nn.Conv2d(cin, cout, 3, padding=1), nn.BatchNorm2d(cout), nn.ReLU(inplace=True)]
        if pool:
            layers.append(nn.MaxPool2d(2))
        return layers

    class DirectClassifier(nn.Module):
        """direct_class: frontend + classifier.encoder (4 blocos Conv-BN-ReLU-MaxPool)
        + classifier.classifier (AdaptiveAvgPool->Flatten->Linear256-128->ReLU/Drop->Linear128-3).
        encoder idx: 0..3 (32), 4..7 (64), 8..11 (128), 12..15 (256). classifier idx 1 e 4 = Linear."""

        def __init__(self, lut, num_classes=3):
            super().__init__()
            self.frontend = ColorNamingFrontend(lut)
            self.classifier = nn.Module()
            self.classifier.encoder = nn.Sequential(
                *_enc_block(11, 32), *_enc_block(32, 64),
                *_enc_block(64, 128), *_enc_block(128, 256),
            )
            self.classifier.pool = nn.AdaptiveAvgPool2d(1)
            self.classifier.classifier = nn.Sequential(
                nn.Flatten(),                       # idx 0
                nn.Linear(256, 128),                # idx 1
                nn.ReLU(inplace=True),              # idx 2
                nn.Dropout(0.5),                    # idx 3
                nn.Linear(128, num_classes),        # idx 4
            )

        def forward(self, x):
            f = self.classifier.encoder(self.frontend(x))
            f = self.classifier.pool(f)
            return self.classifier.classifier(f)

    class EGRegressor(nn.Module):
        """eg_regression: frontend + regressor.encoder (blocos, alguns sem pool)
        + regressor.regressor (Linear512-256->..->Linear64-1).
        encoder idx: 0(64),3(64),7(128),10(128),14(256),17(256),21(512) — o pool
        aparece entre alguns blocos (índices puladores 2,5/6,9,12/13,16,19/20)."""

        def __init__(self, lut):
            super().__init__()
            self.frontend = ColorNamingFrontend(lut)
            self.regressor = nn.Module()
            # reconstruído para casar índices: bloco duplo antes de cada pool
            self.regressor.encoder = nn.Sequential(
                nn.Conv2d(11, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),   # 0,1,2
                nn.Conv2d(64, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),   # 3,4,5
                nn.MaxPool2d(2),                                                              # 6
                nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(inplace=True), # 7,8,9
                nn.Conv2d(128, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(inplace=True),# 10,11,12
                nn.MaxPool2d(2),                                                              # 13
                nn.Conv2d(128, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(inplace=True),# 14,15,16
                nn.Conv2d(256, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(inplace=True),# 17,18,19
                nn.MaxPool2d(2),                                                              # 20
                nn.Conv2d(256, 512, 3, padding=1), nn.BatchNorm2d(512), nn.ReLU(inplace=True),# 21,22,23
            )
            self.regressor.pool = nn.AdaptiveAvgPool2d(1)
            self.regressor.regressor = nn.Sequential(
                nn.Flatten(),                 # 0
                nn.Linear(512, 256),          # 1
                nn.ReLU(inplace=True),        # 2
                nn.Dropout(0.5),              # 3
                nn.Linear(256, 64),           # 4
                nn.ReLU(inplace=True),        # 5
                nn.Dropout(0.5),              # 6
                nn.Linear(64, 1),             # 7
            )

        def forward(self, x):
            f = self.regressor.encoder(self.frontend(x))
            f = self.regressor.pool(f)
            return self.regressor.regressor(f)

    return torch, nn, ColorNamingFrontend, ConvDecoderSeg, DirectClassifier, EGRegressor


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class Engine:
    def __init__(self):
        self.ok = False
        self.detail = ""
        self.device = "cpu"
        self.torch = None
        self.seg = None
        self.clf = None
        self.reg = None
        self.models_loaded = {"fat": False, "finishing": False, "eg": False}

    def load(self):
        try:
            import numpy as np  # noqa
            import cv2  # noqa
            from scipy.io import loadmat
            torch, nn, CN, Seg, Clf, Reg = _build_torch()
        except Exception as e:
            self.detail = f"dependência ausente: {e}"
            return
        self.torch = torch
        self.cv2 = cv2
        self.np = np

        if not os.path.exists(LUT):
            self.detail = f"LUT não encontrada: {LUT}"
            return

        # device
        if torch.backends.mps.is_available():
            self.device = "mps"
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"

        lut = torch.from_numpy(loadmat(LUT)["w2c"]).float()

        def load_model(ctor, path, key):
            if not os.path.exists(path):
                return None
            m = ctor()
            ck = torch.load(path, map_location="cpu", weights_only=False)
            sd = ck.get("model_state_dict", ck)
            m.load_state_dict(sd, strict=True)  # falha se a arquitetura divergir
            m.eval().to(self.device)
            self.models_loaded[key] = True
            return m

        try:
            self.seg = load_model(lambda: Seg(lut.clone(), 1), FAT_W, "fat")
            self.clf = load_model(lambda: Clf(lut.clone(), 3), CLASS_W, "finishing")
            self.reg = load_model(lambda: Reg(lut.clone()), EG_W, "eg")
        except Exception as e:
            self.detail = f"carregar modelo: {e}\n{traceback.format_exc()}"
            return

        self.ok = self.seg is not None
        self.detail = "modelos carregados" if self.ok else "fat_binary ausente"

    def _read_rgb(self, path, size):
        img = self.cv2.imread(path, self.cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"não foi possível ler a imagem: {path}")
        img = self.cv2.cvtColor(img, self.cv2.COLOR_BGR2RGB)
        img = self.cv2.resize(img, (size, size), interpolation=self.cv2.INTER_LINEAR)
        t = self.torch.from_numpy(img).float().permute(2, 0, 1).unsqueeze(0)  # (1,3,H,W) [0,255]
        return t.to(self.device), img

    def _rembg_session(self):
        # sessão do rembg é cara de criar -> cria uma vez e reusa.
        if getattr(self, "_rembg", "unset") == "unset":
            try:
                from rembg import new_session
                self._rembg = new_session("u2net")
            except Exception as e:
                log(f"rembg indisponível ({e}); análise seguirá sem recorte de fundo")
                self._rembg = None
        return self._rembg

    def _cutout_rgb(self, path):
        """Remove o fundo (rembg) e compõe a carcaça sobre PRETO — igual ao treino.
        Retorna (rgb_uint8, foreground_frac) ou (None, 0) se indisponível/inconclusivo."""
        sess = self._rembg_session()
        if sess is None:
            return None, 0.0
        try:
            from rembg import remove
            with open(path, "rb") as f:
                data = f.read()
            rgba = self.cv2.imdecode(
                self.np.frombuffer(remove(data, session=sess), self.np.uint8),
                self.cv2.IMREAD_UNCHANGED,
            )
            if rgba is None or rgba.shape[2] != 4:
                return None, 0.0
            alpha = rgba[:, :, 3:4].astype(self.np.float32) / 255.0
            bgr = rgba[:, :, :3]
            fg = float((rgba[:, :, 3] > 10).mean())
            # carcaça sobre preto, convertido para RGB
            comp = (bgr * alpha).astype(self.np.uint8)
            comp = self.cv2.cvtColor(comp, self.cv2.COLOR_BGR2RGB)
            return comp, fg
        except Exception as e:
            log(f"recorte falhou ({e}); seguindo sem recorte")
            return None, 0.0

    def _tensor(self, rgb_full, size):
        img = self.cv2.resize(rgb_full, (size, size), interpolation=self.cv2.INTER_LINEAR)
        t = self.torch.from_numpy(img).float().permute(2, 0, 1).unsqueeze(0)
        return t.to(self.device), img

    def infer(self, image, out_dir, prefix, run_grade):
        os.makedirs(out_dir, exist_ok=True)
        torch = self.torch
        np = self.np
        out = {"ok": True}

        # --- passo 0: recorte de fundo (rembg) -> carcaça sobre preto ---
        # Os modelos foram treinados com fundo preto; sem recorte, o modelo de
        # gordura conta o fundo do frigorífico como gordura (ex.: ~88% falso).
        cut_rgb, fg = self._cutout_rgb(image)
        if cut_rgb is not None and fg > 0.02:
            base_rgb = cut_rgb
            out["backgroundRemoved"] = True
            out["foregroundFrac"] = fg
            cut_path = os.path.join(out_dir, prefix + "_carcass.png")
            self.cv2.imwrite(cut_path, self.cv2.cvtColor(base_rgb, self.cv2.COLOR_RGB2BGR))
            out["carcassPath"] = cut_path
        else:
            # fallback: imagem original (recorte indisponível ou inconclusivo)
            base_rgb = self.cv2.cvtColor(self.cv2.imread(image, self.cv2.IMREAD_COLOR),
                                         self.cv2.COLOR_BGR2RGB)
            out["backgroundRemoved"] = False

        # --- segmentação de gordura (validada), sobre a carcaça recortada ---
        x, rgb = self._tensor(base_rgb, SEG_SIZE)
        with torch.no_grad():
            logits = self.seg(x)                       # (1,1,H,W)
            prob = torch.sigmoid(logits)[0, 0].cpu().numpy()
        mask = (prob >= 0.5).astype(np.uint8)
        # se recortou, ignora qualquer "gordura" fora da carcaça (borda preta)
        if out.get("backgroundRemoved"):
            fg_mask = (rgb.sum(axis=2) > 12).astype(np.uint8)  # pixels não-pretos
            mask = mask * fg_mask
            denom = max(int(fg_mask.sum()), 1)
            out["fatPercent"] = float(mask.sum()) / denom * 100.0  # % relativa à carcaça
        else:
            out["fatPercent"] = float(mask.mean() * 100.0)

        mask_path = os.path.join(out_dir, prefix + "_fatmask.png")
        self.cv2.imwrite(mask_path, mask * 255)
        out["maskPath"] = mask_path

        # overlay cyan sobre a imagem
        overlay = rgb.copy()
        overlay[mask == 1] = (0.4 * overlay[mask == 1] +
                              0.6 * np.array([0, 200, 210])).astype(np.uint8)
        overlay_path = os.path.join(out_dir, prefix + "_overlay.png")
        self.cv2.imwrite(overlay_path, self.cv2.cvtColor(overlay, self.cv2.COLOR_RGB2BGR))
        out["overlayPath"] = overlay_path

        # --- grau (experimental) --- também sobre a carcaça recortada
        if run_grade:
            out["gradeExperimental"] = True
            xg, _ = self._tensor(base_rgb, GRADE_SIZE)
            if self.clf is not None:
                with torch.no_grad():
                    p = torch.softmax(self.clf(xg), dim=1)[0].cpu().numpy()
                out["finishingClass"] = FINISHING_CLASSES[int(p.argmax())]
                out["finishingProbs"] = {c: float(p[i]) for i, c in enumerate(FINISHING_CLASSES)}
            if self.reg is not None:
                with torch.no_grad():
                    out["egValue"] = float(self.reg(xg)[0, 0].cpu().item())
        return out


def main():
    engine = Engine()
    # modo autoteste (linha de comando): carrega tudo com strict=True e sai.
    if "--selftest" in sys.argv:
        engine.load()
        print(json.dumps({
            "ok": engine.ok, "device": engine.device,
            "models": engine.models_loaded, "detail": engine.detail,
        }, indent=2))
        sys.exit(0 if engine.ok else 1)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except Exception as e:
            send({"ok": False, "error": f"json inválido: {e}"})
            continue
        cmd = msg.get("cmd")
        try:
            if cmd == "probe":
                if engine.torch is None:
                    engine.load()
                send({"ok": True, "available": engine.ok, "device": engine.device,
                      "models": engine.models_loaded, "detail": engine.detail})
            elif cmd == "infer":
                if engine.torch is None:
                    engine.load()
                if not engine.ok:
                    send({"ok": False, "error": f"inferência indisponível: {engine.detail}"})
                    continue
                res = engine.infer(msg["image"], msg.get("outDir", "."),
                                   msg.get("prefix", "an"), bool(msg.get("runGrade", False)))
                send(res)
            elif cmd == "shutdown":
                send({"ok": True})
                return
            else:
                send({"ok": False, "error": f"comando desconhecido: {cmd}"})
        except Exception as e:
            log(traceback.format_exc())
            send({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
