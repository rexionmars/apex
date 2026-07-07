#!/usr/bin/env python3
"""Sidecar de tempo real: overlay de gordura ao vivo para enquadramento.

Diferente do inference.py (request/response, uma imagem por vez), este mantém um
LOOP quente: o modelo e o fundo ficam em memória, e cada frame é processado em
~30ms (≈30 FPS). NÃO usa rembg (lento); usa subtração de fundo clássica sobre um
fundo capturado uma vez — ideal para estação fixa (câmera parada).

Protocolo (uma linha JSON por comando em stdin → uma linha JSON por resposta):
  {"cmd":"probe"}
      → {"ok":true,"available":bool,"device":"..."}
  {"cmd":"bg","jpeg":"<base64>"}                      # captura o fundo vazio
      → {"ok":true}
  {"cmd":"frame","jpeg":"<base64>","size":256}        # processa um frame
      → {"ok":true,"overlay":"<base64 jpeg>","fatPercent":..,"fgFrac":..,"ms":..}
  {"cmd":"shutdown"} → encerra.

O overlay já vem pronto (carcaça + máscara de gordura cyan) para o front só exibir.
"""
import base64
import json
import os
import sys
import time
import traceback

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "model", "weights")
MODEL_DIR = os.path.abspath(os.environ.get("CARCASS_MODEL_DIR", MODEL_DIR))
LUT = os.path.join(MODEL_DIR, "joost_color_naming.mat")
FAT_W = os.path.join(MODEL_DIR, "fat_binary.pth")


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class RTEngine:
    def __init__(self):
        self.ok = False
        self.detail = ""
        self.device = "cpu"
        self.seg = None
        self.bg = None  # fundo capturado (BGR)
        self.cv2 = None
        self.np = None
        self.torch = None

    def load(self):
        try:
            import cv2
            import numpy as np
            import torch
            from scipy.io import loadmat
        except Exception as e:
            self.detail = f"dependência ausente: {e}"
            return
        self.cv2, self.np, self.torch = cv2, np, torch

        if not (os.path.exists(LUT) and os.path.exists(FAT_W)):
            self.detail = "pesos/LUT não encontrados"
            return

        if torch.backends.mps.is_available():
            self.device = "mps"
        elif torch.cuda.is_available():
            self.device = "cuda"

        # reconstrói o ColorNamingConvDecoder (mesma arquitetura do inference.py)
        import torch.nn as nn

        class Frontend(nn.Module):
            def __init__(self, lut):
                super().__init__()
                self.register_buffer("lookup_table", lut)

            def forward(self, x):
                B, C, H, W = x.shape
                q = (x / 8.0).long().clamp(0, 31)
                idx = q[:, 0] + q[:, 1] * 32 + q[:, 2] * 1024
                return self.lookup_table[idx.view(-1)].view(B, H, W, 11).permute(0, 3, 1, 2).contiguous()

        class Seg(nn.Module):
            def __init__(self, lut):
                super().__init__()
                self.frontend = Frontend(lut)
                self.decoder = nn.Module()
                self.decoder.decoder = nn.Sequential(
                    nn.Conv2d(11, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                    nn.Conv2d(64, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(inplace=True),
                    nn.Conv2d(32, 1, 1),
                )

            def forward(self, x):
                return self.decoder.decoder(self.frontend(x))

        try:
            lut = torch.from_numpy(loadmat(LUT)["w2c"]).float()
            m = Seg(lut)
            ck = torch.load(FAT_W, map_location="cpu", weights_only=False)
            m.load_state_dict(ck.get("model_state_dict", ck), strict=True)
            m.eval().to(self.device)
            self.seg = m
            # warmup
            dummy = torch.zeros(1, 3, 256, 256).to(self.device)
            with torch.no_grad():
                self.seg(dummy)
            self.ok = True
            self.detail = "pronto"
        except Exception as e:
            self.detail = f"carregar modelo: {e}"

    def _decode(self, b64):
        data = base64.b64decode(b64)
        arr = self.np.frombuffer(data, self.np.uint8)
        return self.cv2.imdecode(arr, self.cv2.IMREAD_COLOR)  # BGR

    def set_bg(self, jpeg_b64):
        self.bg = self.cv2.GaussianBlur(self._decode(jpeg_b64), (0, 0), 3)

    def frame(self, jpeg_b64, size):
        t0 = time.time()
        cv2, np, torch = self.cv2, self.np, self.torch
        frame = self._decode(jpeg_b64)  # BGR
        H, W = frame.shape[:2]

        # 1) subtração de fundo (se houver fundo capturado)
        fg_frac = 1.0
        if self.bg is not None and self.bg.shape[:2] == frame.shape[:2]:
            diff = cv2.absdiff(cv2.GaussianBlur(frame, (0, 0), 3), self.bg)
            g = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            _, fgmask = cv2.threshold(g, 22, 255, cv2.THRESH_BINARY)
            k = np.ones((5, 5), np.uint8)
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN, k)
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
            cut = cv2.bitwise_and(frame, frame, mask=fgmask)
            fg_frac = float((fgmask > 0).mean())
        else:
            cut = frame
            fgmask = None

        # 2) modelo de gordura @size (rápido)
        rgb = cv2.cvtColor(cv2.resize(cut, (size, size)), cv2.COLOR_BGR2RGB)
        x = torch.from_numpy(rgb).float().permute(2, 0, 1).unsqueeze(0).to(self.device)
        with torch.no_grad():
            prob = torch.sigmoid(self.seg(x))[0, 0].cpu().numpy()
        mask_small = (prob >= 0.5).astype(np.uint8)

        # restringe à carcaça (pixels não-pretos após recorte)
        base_small = cv2.resize(cut, (size, size))
        carc = (base_small.sum(axis=2) > 12).astype(np.uint8)
        mask_small = mask_small * carc
        denom = max(int(carc.sum()), 1)
        fat_pct = float(mask_small.sum()) / denom * 100.0

        # 3) overlay na resolução do preview (redimensiona a máscara de volta)
        mask_full = cv2.resize(mask_small * 255, (W, H), interpolation=cv2.INTER_NEAREST)
        overlay = frame.copy()
        cyan = np.zeros_like(frame); cyan[:] = (210, 200, 0)  # BGR do cyan
        sel = mask_full > 127
        overlay[sel] = (0.45 * overlay[sel] + 0.55 * cyan[sel]).astype(np.uint8)

        ok, buf = cv2.imencode(".jpg", overlay, [cv2.IMWRITE_JPEG_QUALITY, 75])
        b64 = base64.b64encode(buf.tobytes()).decode() if ok else ""
        return {
            "ok": True,
            "overlay": b64,
            "fatPercent": fat_pct,
            "fgFrac": fg_frac,
            "ms": (time.time() - t0) * 1000.0,
        }


def main():
    eng = RTEngine()
    if "--selftest" in sys.argv:
        eng.load()
        print(json.dumps({"ok": eng.ok, "device": eng.device, "detail": eng.detail}))
        sys.exit(0 if eng.ok else 1)

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
                if eng.torch is None:
                    eng.load()
                send({"ok": True, "available": eng.ok, "device": eng.device, "detail": eng.detail})
            elif cmd == "bg":
                if eng.torch is None:
                    eng.load()
                eng.set_bg(msg["jpeg"])
                send({"ok": True})
            elif cmd == "frame":
                if not eng.ok:
                    send({"ok": False, "error": eng.detail or "motor indisponível"})
                    continue
                send(eng.frame(msg["jpeg"], int(msg.get("size", 256))))
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
