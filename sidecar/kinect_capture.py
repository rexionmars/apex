#!/usr/bin/env python3
"""Sidecar de captura Kinect (RGB + depth) para o app Go/Wails.

Protocolo (linha a linha, JSON):
  O Go escreve UM comando JSON por linha em stdin; o sidecar responde UM JSON por
  linha em stdout. Nada além de JSON vai para stdout (logs vão para stderr).

Comandos:
  {"cmd": "probe"}
      -> {"ok": true, "backend": "kinect_v2"|"kinect_v1"|"none", "available": bool,
          "detail": "..."}
  {"cmd": "capture", "outDir": "/abs/pasta", "prefix": "rgb_xxx"}
      -> {"ok": true, "rgbPath": "...", "depthPath": "...", "width": W, "height": H}
      ou {"ok": false, "error": "..."}
  {"cmd": "shutdown"} -> encerra.

O sidecar tenta, em ordem: pylibfreenect2 (Kinect v2), freenect (Kinect v1).
Se nenhum estiver instalado, responde available=false — o app segue funcionando
apenas com webcam. Depth é salvo como PNG 16-bit (milímetros) quando disponível.
"""
import json
import os
import sys
import traceback


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


class Backend:
    """Interface comum. Subclasses implementam capture()."""

    name = "none"
    available = False
    detail = "nenhum backend Kinect disponível"

    def capture(self, out_dir, prefix):
        raise RuntimeError("backend indisponível")

    def close(self):
        pass


def try_v2():
    """Kinect v2 via pylibfreenect2 + libfreenect2."""
    try:
        import numpy as np  # noqa: F401
        from pylibfreenect2 import Freenect2, SyncMultiFrameListener
        from pylibfreenect2 import FrameType, Registration, Frame
        try:
            from pylibfreenect2 import OpenGLPacketPipeline as Pipeline
        except Exception:
            from pylibfreenect2 import CpuPacketPipeline as Pipeline
    except Exception as e:
        return None, f"pylibfreenect2 ausente: {e}"

    class V2(Backend):
        name = "kinect_v2"
        available = True
        detail = "Kinect v2 (libfreenect2)"

        def __init__(self):
            import numpy as np
            from pylibfreenect2 import Freenect2, SyncMultiFrameListener, FrameType
            self.np = np
            self.FrameType = FrameType
            self.fn = Freenect2()
            if self.fn.enumerateDevices() == 0:
                raise RuntimeError("nenhum dispositivo Kinect v2 conectado")
            self.pipeline = Pipeline()
            serial = self.fn.getDefaultDeviceSerialNumber()
            self.device = self.fn.openDevice(serial, pipeline=self.pipeline)
            self.listener = SyncMultiFrameListener(
                FrameType.Color | FrameType.Depth
            )
            self.device.setColorFrameListener(self.listener)
            self.device.setIrAndDepthFrameListener(self.listener)
            self.device.start()

        def capture(self, out_dir, prefix):
            import cv2
            frames = self.listener.waitForNewFrame()
            try:
                color = frames["color"]
                depth = frames["depth"]
                rgb = color.asarray()  # BGRA
                rgb = cv2.cvtColor(rgb, cv2.COLOR_BGRA2BGR)
                depth_mm = depth.asarray(dtype=self.np.float32)  # mm
                depth_u16 = self.np.clip(depth_mm, 0, 65535).astype(self.np.uint16)

                rgb_path = os.path.join(out_dir, prefix + ".jpg")
                depth_path = os.path.join(out_dir, prefix + "_depth.png")
                cv2.imwrite(rgb_path, rgb)
                cv2.imwrite(depth_path, depth_u16)
                h, w = rgb.shape[:2]
                return rgb_path, depth_path, w, h
            finally:
                self.listener.release(frames)

        def close(self):
            try:
                self.device.stop()
                self.device.close()
            except Exception:
                pass

    try:
        return V2(), V2.detail
    except Exception as e:
        return None, f"Kinect v2 presente mas falhou: {e}"


def try_v1():
    """Kinect v1 via freenect (libfreenect)."""
    try:
        import freenect  # noqa: F401
        import numpy as np  # noqa: F401
        import cv2  # noqa: F401
    except Exception as e:
        return None, f"freenect ausente: {e}"

    class V1(Backend):
        name = "kinect_v1"
        available = True
        detail = "Kinect v1 (libfreenect)"

        def capture(self, out_dir, prefix):
            import freenect
            import numpy as np
            import cv2
            rgb, _ = freenect.sync_get_video()
            depth, _ = freenect.sync_get_depth()  # 11-bit -> uint16
            rgb = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            depth_u16 = depth.astype(np.uint16)
            rgb_path = os.path.join(out_dir, prefix + ".jpg")
            depth_path = os.path.join(out_dir, prefix + "_depth.png")
            cv2.imwrite(rgb_path, rgb)
            cv2.imwrite(depth_path, depth_u16)
            h, w = rgb.shape[:2]
            return rgb_path, depth_path, w, h

    return V1(), V1.detail


def pick_backend():
    b, why2 = try_v2()
    if b:
        return b
    b, why1 = try_v1()
    if b:
        return b
    nb = Backend()
    nb.detail = f"{why2} | {why1}"
    return nb


def main():
    backend = None
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
                if backend is None:
                    backend = pick_backend()
                send({
                    "ok": True,
                    "backend": backend.name,
                    "available": backend.available,
                    "detail": backend.detail,
                })
            elif cmd == "capture":
                if backend is None:
                    backend = pick_backend()
                if not backend.available:
                    send({"ok": False, "error": f"Kinect indisponível: {backend.detail}"})
                    continue
                out_dir = msg["outDir"]
                prefix = msg.get("prefix", "kinect")
                os.makedirs(out_dir, exist_ok=True)
                rgb, depth, w, h = backend.capture(out_dir, prefix)
                send({"ok": True, "rgbPath": rgb, "depthPath": depth, "width": w, "height": h})
            elif cmd == "shutdown":
                if backend:
                    backend.close()
                send({"ok": True})
                return
            else:
                send({"ok": False, "error": f"comando desconhecido: {cmd}"})
        except Exception as e:
            log(traceback.format_exc())
            send({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
