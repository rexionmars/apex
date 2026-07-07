import { useCallback, useEffect, useRef, useState } from "react";

// useWebcam encapsula getUserMedia: lista câmeras, abre stream e captura um frame
// como JPEG base64. Depth (Kinect) NÃO passa por aqui — virá pelo sidecar Python.
export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string>("");

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const start = useCallback(
    async (id?: string) => {
      setError("");
      try {
        stop();
        const constraints: MediaStreamConstraints = {
          video: id
            ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setActive(true);
        // labels dos devices só aparecem após permissão concedida
        await refreshDevices();
      } catch (e) {
        setError(
          "Não foi possível acessar a câmera. Verifique se há uma webcam conectada e a permissão. " +
            String(e)
        );
        setActive(false);
      }
    },
    [refreshDevices]
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  // Captura o frame atual. Retorna { base64, width, height } (JPEG sem prefixo data:).
  const capture = useCallback((): { base64: string; width: number; height: number } | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    return {
      base64: dataUrl.split(",")[1] ?? "",
      width: canvas.width,
      height: canvas.height,
    };
  }, []);

  useEffect(() => {
    refreshDevices();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, devices, deviceId, setDeviceId, active, error, start, stop, capture, refreshDevices };
}
