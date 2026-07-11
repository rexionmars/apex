import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, Square, Camera, Crosshair, RotateCcw, Radio, FileVideo, Pause, Upload } from "lucide-react";
import { api, type RTProbe } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";

// Live monitor: real-time fat overlay to ASSIST WITH FRAMING
// (or to review a recording). Two sources: live camera or video file.
// Loop: grab a frame from <video> → Go → sidecar (background subtraction + model) →
// finished overlay. The <video> is the same element for both sources.
const MODEL_SIZE = 256;
const FRAME_W = 640;

type Source = "camera" | "video";

export function LiveMonitor() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);

  const [probe, setProbe] = useState<RTProbe | null>(null);
  const [source, setSource] = useState<Source>("camera");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoName, setVideoName] = useState<string>("");
  const [playing, setPlaying] = useState(false);

  const [running, setRunning] = useState(false);
  const [overlay, setOverlay] = useState<string>("");
  const [fatPct, setFatPct] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const [hasBg, setHasBg] = useState(false);
  const bridged = api.isBridged();

  useEffect(() => {
    if (bridged) api.rtProbe().then(setProbe).catch(() => setProbe(null));
    return () => {
      runningRef.current = false;
      stopStream();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // grabs a JPEG of the current <video> frame, downscaled to FRAME_W width.
  const grabJpeg = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = FRAME_W / v.videoWidth;
    const w = FRAME_W;
    const h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  // loop: 1 frame in flight at a time (no stacking). Runs while runningRef.
  const loop = useCallback(async () => {
    let last = performance.now();
    let frames = 0;
    let acc = 0;
    while (runningRef.current) {
      const v = videoRef.current;
      // for video: if paused/ended, wait without processing
      if (source === "video" && v && (v.paused || v.ended)) {
        await new Promise((r) => setTimeout(r, 80));
        last = performance.now();
        continue;
      }
      const jpeg = grabJpeg();
      if (!jpeg) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      try {
        const res = await api.rtFrame(jpeg, MODEL_SIZE);
        if (!runningRef.current) break;
        if (res.ok) {
          setOverlay("data:image/jpeg;base64," + res.overlay);
          setFatPct(res.fatPercent);
        }
      } catch {
        /* dropped frame */
      }
      const now = performance.now();
      acc += now - last;
      last = now;
      frames++;
      if (acc >= 500) {
        setFps(Math.round((frames / acc) * 1000));
        frames = 0;
        acc = 0;
      }
    }
  }, [grabJpeg, source]);

  async function startCamera() {
    stopStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 } },
      audio: false,
    });
    streamRef.current = stream;
    const v = videoRef.current!;
    v.srcObject = stream;
    v.src = "";
    await v.play();
    setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
  }

  async function start() {
    if (!probe?.available) {
      toast.error("Realtime engine unavailable. Requires Python with torch.");
      return;
    }
    try {
      if (source === "camera") {
        await startCamera();
      } else {
        if (!videoUrl) {
          toast.error("Choose a video file first.");
          return;
        }
        const v = videoRef.current!;
        v.srcObject = null;
        v.src = videoUrl;
        await v.play();
        setPlaying(true);
      }
      await new Promise((r) => setTimeout(r, 300));
      runningRef.current = true;
      setRunning(true);
      loop();
    } catch (e) {
      toast.error("Could not start: " + String(e));
    }
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);
    const v = videoRef.current;
    if (v) v.pause();
    stopStream();
    setPlaying(false);
    setFps(0);
  }

  const isRunning = running;

  function chooseVideo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(f);
      setVideoUrl(url);
      setVideoName(f.name);
      const v = videoRef.current!;
      v.srcObject = null;
      v.src = url;
      toast.success(`Video loaded: ${f.name}`);
    };
    input.click();
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  async function captureBackground() {
    const jpeg = grabJpeg();
    if (!jpeg) {
      toast.error("Start the source first (or wait for the video to load).");
      return;
    }
    try {
      await api.rtSetBackground(jpeg);
      setHasBg(true);
      toast.success(
        source === "camera"
          ? "Background captured. Now place the carcass in the scene."
          : "Background captured from this frame."
      );
    } catch (e) {
      toast.error(String(e));
    }
  }

  function switchSource(s: Source) {
    if (runningRef.current) stop();
    setSource(s);
    setOverlay("");
    setFatPct(null);
    setHasBg(false);
  }

  if (!bridged) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        This screen must run inside the app (<code>wails dev</code> or binary).
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
      {/* engine + source selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-background/30 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <Crosshair className="size-3.5 text-primary" />
          {probe === null ? (
            <span className="text-muted-foreground">checking engine…</span>
          ) : probe.available ? (
            <span className="telemetry text-muted-foreground">
              engine ready · device <span className="text-primary">{probe.device}</span>
            </span>
          ) : (
            <span className="text-alert">realtime unavailable — {probe.detail}</span>
          )}
        </div>

        <SegmentedControl
          value={source}
          onChange={(s) => switchSource(s)}
          options={[
            { value: "camera", label: "Live camera", icon: Radio },
            { value: "video", label: "Video file", icon: FileVideo },
          ]}
        />
      </div>

      {/* video source: choose file */}
      {source === "video" && (
        <div className="flex items-center gap-2 rounded-sm border border-border bg-background/30 px-3 py-2 text-sm">
          <Button size="sm" variant="outline" onClick={chooseVideo}>
            <Upload className="size-4" /> Choose video
          </Button>
          <span className="truncate text-xs text-muted-foreground">{videoName || "no file"}</span>
        </div>
      )}

      {/* stage: hidden <video> (source) + processed overlay */}
      <video ref={videoRef} className="hidden" muted playsInline loop={source === "video"} />

      <div className="panel relative overflow-hidden rounded-md">
        <div className="flex aspect-video items-center justify-center bg-black">
          {overlay ? (
            <img src={overlay} className="max-h-full max-w-full object-contain" />
          ) : (
            <EmptyState
              eyebrow={isRunning ? "Processing" : "Stage idle"}
              className="border-0 bg-transparent"
            >
              {isRunning
                ? "processing…"
                : source === "camera"
                  ? "Monitor stopped — start the camera"
                  : "Choose a video and start"}
            </EmptyState>
          )}
        </div>

        {isRunning && (
          <div className="absolute left-3 top-3 flex flex-col gap-1">
            <span className="telemetry rounded-sm bg-black/60 px-2 py-0.5 text-[11px] text-primary">{fps} FPS</span>
            {fatPct !== null && (
              <span className="telemetry rounded-sm bg-black/60 px-2 py-0.5 text-lg font-semibold text-primary">
                {fatPct.toFixed(0)}% fat
              </span>
            )}
          </div>
        )}
        {isRunning && !hasBg && (
          <span className="status-pill absolute right-3 top-3 bg-black/60 text-alert">no background · capture it</span>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!isRunning ? (
          <Button size="sm" onClick={start} disabled={!probe?.available || (source === "video" && !videoUrl)}>
            <Play className="size-4" /> Start
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={stop}>
            <Square className="size-4" /> Stop
          </Button>
        )}

        {source === "video" && isRunning && (
          <Button size="sm" variant="outline" onClick={togglePlay}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Resume"}
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={captureBackground}
          disabled={source === "camera" ? !isRunning : !videoUrl}
        >
          <Camera className="size-4" /> Capture background
        </Button>
        {hasBg && (
          <span className="status-pill text-ok">
            <RotateCcw className="size-3" /> background set
          </span>
        )}

        {source === "camera" && devices.length > 1 && (
          <select
            className="h-8 rounded-md border border-input bg-background/40 px-2 text-sm"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              if (isRunning) startCamera();
            }}
          >
            <option value="">Default camera</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
            ))}
          </select>
        )}
      </div>

      <p className="eyebrow leading-relaxed normal-case tracking-normal text-muted-foreground">
        {source === "camera" ? (
          <>Live framing guide. Fixed camera: capture the background with the scene empty, then position the carcass.</>
        ) : (
          <>Recording review with a frame-by-frame overlay. Pause on a frame without the carcass and capture background.</>
        )}{" "}
        Approximate overlay — validated numbers come from Analysis on a captured image.
      </p>
    </div>
  );
}
