import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, Play, Square, Save, Boxes } from "lucide-react";
import { api, type Carcass, type Image, type KinectProbe } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { useWebcam } from "@/hooks/useWebcam";
import { ImageThumb } from "@/components/ImageThumb";

const VIEWS = ["posterior", "lateral", "dorsal", "other"] as const;

export function CarcassPanel({
  carcass,
  onImageSaved,
}: {
  carcass: Carcass;
  onImageSaved: () => void;
}) {
  const cam = useWebcam();
  const [view, setView] = useState<string>("posterior");
  const [images, setImages] = useState<Image[]>([]);
  const [saving, setSaving] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ base64: string; width: number; height: number } | null>(
    null
  );
  const [kinect, setKinect] = useState<KinectProbe | null>(null);
  const [kinecting, setKinecting] = useState(false);

  async function loadImages() {
    try {
      setImages(await api.listImages(carcass.id));
    } catch (e) {
      toast.error(String(e));
    }
  }

  useEffect(() => {
    loadImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carcass.id]);

  useEffect(() => {
    let alive = true;
    api
      .kinectProbe()
      .then((p) => alive && setKinect(p))
      .catch(() => alive && setKinect(null));
    return () => {
      alive = false;
    };
  }, []);

  async function captureKinect() {
    setKinecting(true);
    try {
      await api.captureKinect(carcass.id, view);
      toast.success(`Kinect capture (RGB+depth) saved and paired to #${carcass.physicalTag}.`);
      await loadImages();
      onImageSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setKinecting(false);
    }
  }

  function grabFrame() {
    const frame = cam.capture();
    if (!frame) {
      toast.error("No frame available. Start the camera first.");
      return;
    }
    setPending(frame);
    setPendingPreview("data:image/jpeg;base64," + frame.base64);
  }

  async function saveFrame() {
    if (!pending) return;
    setSaving(true);
    try {
      await api.saveCapturedImage({
        carcassId: carcass.id,
        source: "webcam",
        view,
        width: pending.width,
        height: pending.height,
        dataBase64: pending.base64,
        ext: ".jpg",
      });
      setPending(null);
      setPendingPreview(null);
      toast.success(`Image saved and paired to carcass #${carcass.physicalTag}.`);
      await loadImages();
      onImageSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel rounded-md">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Camera className="size-3.5 text-muted-foreground" />
          <div className="eyebrow">Capture · #{carcass.physicalTag}</div>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {!cam.active ? (
              <Button size="sm" onClick={() => cam.start(cam.deviceId || undefined)}>
                <Play className="size-4" /> Start camera
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={cam.stop}>
                <Square className="size-4" /> Stop
              </Button>
            )}

            {cam.devices.length > 1 && (
              <select
                className="h-7 rounded-sm border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={cam.deviceId}
                onChange={(e) => {
                  cam.setDeviceId(e.target.value);
                  if (cam.active) cam.start(e.target.value);
                }}
              >
                <option value="">Default camera</option>
                {cam.devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}

            <SegmentedControl
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: v }))}
            />

            {kinect?.available ? (
              <Button size="sm" variant="secondary" onClick={captureKinect} disabled={kinecting}>
                <Boxes className="size-4" /> {kinecting ? "Capturing…" : "Kinect (RGB+depth)"}
              </Button>
            ) : (
              kinect && (
                <span className="text-xs text-muted-foreground" title={kinect.detail}>
                  Kinect unavailable
                </span>
              )
            )}
          </div>

          {cam.error && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {cam.error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="aspect-video overflow-hidden rounded-sm border border-border bg-black/40">
                <video ref={cam.videoRef} className="h-full w-full object-contain" muted playsInline />
              </div>
              <Button size="sm" onClick={grabFrame} disabled={!cam.active}>
                <Camera className="size-4" /> Capture frame
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="aspect-video overflow-hidden rounded-sm border border-dashed border-border bg-secondary/40">
                {pendingPreview ? (
                  <img src={pendingPreview} className="h-full w-full object-contain" />
                ) : (
                  <EmptyState eyebrow="Preview" className="h-full border-0 py-6">
                    Capture a frame to preview
                  </EmptyState>
                )}
              </div>
              <Button size="sm" onClick={saveFrame} disabled={!pending || saving}>
                <Save className="size-4" /> Save · pair to #{carcass.physicalTag}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {images.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Images ({images.length})</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {images.map((img) => (
              <ImageThumb key={img.id} image={img} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
