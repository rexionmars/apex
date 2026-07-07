#!/usr/bin/env python3
"""Sidecar de conformação: convexidade integral do perfil da carcaça.

Porta o método do experimento integral_invariant_conformation (PAVIC/UFPI):
transcrição da norma EUROP/MAPA de conformação — "perfis convexos = boa
musculosidade; côncavos, osso aparente = ruim" — como uma medida geométrica,
INVARIANTE a rotação/translação/escala/iluminação e SEM treino.

Método (Manay et al. 2004; Pottmann et al. 2009): em cada ponto do contorno,
a área da interseção de um disco de raio r com o interior da carcaça carrega a
curvatura com sinal sem derivar. Convexidade normalizada:
    c(p,r) = 1/2 - A(p,r)/(pi r^2)   (c>0 convexo, c<0 côncavo)
Agregada por região anatômica (perna/lombo/paleta), no perfil lateral externo.

IMPORTANTE (honestidade científica): o experimento-oráculo do projeto mostrou que
a conformação NÃO é recuperável de forma validada a partir de uma imagem 2D única
(n=22, zero descritores sobrevivem à correção FDR). Portanto o "grau estimado"
aqui é uma ESTIMATIVA NÃO-VALIDADA a partir da convexidade — o mapa e os índices
são medidas objetivas; o grau é indicativo, a ser validado quando o dataset
pareado crescer.

Protocolo (JSON stdin/stdout): probe / conform / shutdown.
  {"cmd":"conform","image":"/abs/carcass.png","outDir":"...","prefix":"c1"}
    -> {"ok":true, "mapPath":"...", "convPerna":..,"convLombo":..,"convPaleta":..,
        "conformationIndex":.., "gradeEstimate":"...", "gradeConfidence":..}
O "image" deve ser a CARCAÇA JÁ RECORTADA (fundo preto), como a saída do sidecar
de inferência (carcass.png) — a silhueta vem dos pixels não-pretos.
"""
import base64
import json
import os
import sys
import traceback

RADII_FRAC = [0.04, 0.07, 0.11]
REGIONS = ["perna", "lombo", "paleta"]  # topo, meio, base (pendurada pelo jarrete)
CLIP = 0.25  # escala de cor do mapa

# Faixa observada da convexidade da perna (r07) no dataset do experimento (n=22):
# min 0.067, max 0.201, média 0.151. Usada para derivar o grau estimado (5 classes).
PERNA_LO, PERNA_HI = 0.06, 0.21
GRADE_LABELS = ["Inferior", "Regular", "Bom", "Muito bom", "Excelente"]


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class ConformEngine:
    def __init__(self):
        self.ok = False
        self.detail = ""
        self.np = None

    def load(self):
        try:
            import numpy as np
            import cv2  # noqa
            from scipy import ndimage  # noqa
            from scipy.signal import fftconvolve  # noqa
            from scipy.ndimage import map_coordinates  # noqa
            from skimage.measure import find_contours, label  # noqa
            from skimage.morphology import disk, binary_opening  # noqa
        except Exception as e:
            self.detail = f"dependência ausente: {e}"
            return
        self.np = np
        self.cv2 = cv2
        self.ok = True
        self.detail = "pronto"

    # ---- silhueta a partir da carcaça recortada (fundo preto) ----
    def _silhouette(self, image_path):
        np = self.np
        from scipy import ndimage
        from skimage.morphology import disk, binary_opening
        from skimage.measure import label

        img = self.cv2.imread(image_path, self.cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"não foi possível ler: {image_path}")
        # reduz para lado máximo 384 (como o experimento)
        H, W = img.shape[:2]
        s = max(H, W) / 384.0
        if s > 1:
            img = self.cv2.resize(img, (int(W / s), int(H / s)), interpolation=self.cv2.INTER_NEAREST)
        # silhueta = pixels não-pretos (carcaça recortada tem fundo preto)
        body = img.sum(axis=2) > 12
        body = ndimage.binary_fill_holes(body)
        body = binary_opening(body, disk(2))
        lab = label(body)
        if lab.max() == 0:
            return body
        body = lab == (1 + int(np.argmax(np.bincount(lab.flat)[1:])))
        return ndimage.binary_fill_holes(body)

    def _ball_area_field(self, region, r_px):
        from scipy.signal import fftconvolve
        from skimage.morphology import disk
        k = disk(int(round(r_px))).astype(float)
        return fftconvolve(region.astype(float), k, mode="same"), k.sum()

    def _convexity_along_contour(self, region, r_px):
        from skimage.measure import find_contours
        from scipy.ndimage import map_coordinates
        conts = find_contours(region.astype(float), 0.5)
        if not conts:
            return None, None
        cont = max(conts, key=len)
        field, disk_area = self._ball_area_field(region, r_px)
        A = map_coordinates(field, [cont[:, 0], cont[:, 1]], order=1, mode="nearest")
        c = 0.5 - A / disk_area
        return cont, c

    def _region_of(self, rows, ymin, ymax):
        np = self.np
        h = ymax - ymin
        t1, t2 = ymin + h / 3.0, ymin + 2.0 * h / 3.0
        return np.where(rows < t1, 0, np.where(rows < t2, 1, 2))

    def _lateral_index(self, region, cont, tol=2):
        np = self.np
        H, W = region.shape
        ys, xs = np.where(region)
        left = np.full(H, W, dtype=float)
        right = np.full(H, -1, dtype=float)
        np.minimum.at(left, ys, xs)
        np.maximum.at(right, ys, xs)
        rows = np.clip(np.round(cont[:, 0]).astype(int), 0, H - 1)
        cols = cont[:, 1]
        return (np.abs(cols - left[rows]) <= tol) | (np.abs(cols - right[rows]) <= tol)

    def conform(self, image_path, out_dir, prefix):
        np = self.np
        os.makedirs(out_dir, exist_ok=True)
        region = self._silhouette(image_path)
        ys, xs = np.where(region)
        if len(ys) == 0:
            raise RuntimeError("silhueta vazia")
        ymin, ymax = int(ys.min()), int(ys.max())
        height = ymax - ymin + 1

        out = {"ok": True}
        per_region = {r: [] for r in REGIONS}
        viz_cont, viz_c = None, None

        for rf in RADII_FRAC:
            r_px = max(2.0, rf * height)
            cont, c = self._convexity_along_contour(region, r_px)
            if cont is None:
                continue
            lat = self._lateral_index(region, cont)
            band = self._region_of(cont[:, 0], ymin, ymax)
            if abs(rf - 0.07) < 1e-6:
                viz_cont, viz_c = cont, c  # escala média para o mapa
            for ri, rname in enumerate(REGIONS):
                sel = (band == ri) & lat
                cc = c[sel]
                if len(cc) and abs(rf - 0.07) < 1e-6:
                    per_region[rname] = cc

        conv = {r: float(np.mean(per_region[r])) if len(per_region[r]) else 0.0 for r in REGIONS}
        out["convPerna"] = conv["perna"]
        out["convLombo"] = conv["lombo"]
        out["convPaleta"] = conv["paleta"]
        out["conformationIndex"] = float(np.mean([conv[r] for r in REGIONS]))

        # grau estimado (NÃO validado) a partir da convexidade da perna
        perna = conv["perna"]
        t = (perna - PERNA_LO) / (PERNA_HI - PERNA_LO)
        t = min(max(t, 0.0), 1.0)
        idx = min(int(t * len(GRADE_LABELS)), len(GRADE_LABELS) - 1)
        out["gradeEstimate"] = GRADE_LABELS[idx]
        out["gradeConfidence"] = round(t, 3)

        # mapa de convexidade (contorno colorido azul=convexo / vermelho=côncavo)
        if viz_cont is not None:
            map_path = os.path.join(out_dir, prefix + "_convmap.png")
            self._draw_map(image_path, region, viz_cont, viz_c, conv, ymin, ymax, map_path)
            out["mapPath"] = map_path
        return out

    def _draw_map(self, image_path, region, cont, c, conv, ymin, ymax, out_path):
        np = self.np
        cv2 = self.cv2
        H, W = region.shape
        # base: a carcaça (escurecida) redimensionada ao frame da silhueta
        base = cv2.imread(image_path, cv2.IMREAD_COLOR)
        base = cv2.resize(base, (W, H), interpolation=cv2.INTER_LINEAR)
        canvas = (base * 0.5).astype(np.uint8)

        # cor por convexidade: azul (BGR 255,60,0) convexo, vermelho (0,40,255) côncavo
        cc = np.clip(c / CLIP, -1, 1)
        for i in range(len(cont) - 1):
            y0, x0 = int(cont[i, 0]), int(cont[i, 1])
            y1, x1 = int(cont[i + 1, 0]), int(cont[i + 1, 1])
            v = cc[i]
            if v >= 0:  # convexo -> azul
                col = (int(255 * v + (1 - v) * 200), int(60 + (1 - v) * 195), int((1 - v) * 200))
            else:       # côncavo -> vermelho
                a = -v
                col = (int((1 - a) * 200), int((1 - a) * 195 + 40 * a), int(255 * a + (1 - a) * 200))
            cv2.line(canvas, (x0, y0), (x1, y1), col, 2, cv2.LINE_AA)

        # rótulos por região
        band_h = (ymax - ymin) / 3.0
        for ri, rname in enumerate(REGIONS):
            yc = int(ymin + band_h * (ri + 0.5))
            txt = f"{rname} {conv[rname]:+.3f}"
            cv2.putText(canvas, txt, (6, yc), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imwrite(out_path, canvas)


def main():
    eng = ConformEngine()
    if "--selftest" in sys.argv:
        eng.load()
        print(json.dumps({"ok": eng.ok, "detail": eng.detail}))
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
                if eng.np is None:
                    eng.load()
                send({"ok": True, "available": eng.ok, "detail": eng.detail})
            elif cmd == "conform":
                if eng.np is None:
                    eng.load()
                if not eng.ok:
                    send({"ok": False, "error": eng.detail})
                    continue
                send(eng.conform(msg["image"], msg.get("outDir", "."), msg.get("prefix", "conf")))
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
