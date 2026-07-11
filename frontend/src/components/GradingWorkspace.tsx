import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Check, LogOut } from "lucide-react";
import { api, type Carcass, type Grade, type GradingSession, type Image } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const CONFORMATION = ["1", "2", "3", "4", "5"];
const FINISHING = ["1", "2", "3", "4", "5"];

export function GradingWorkspace({
  session,
  carcasses,
  initialGrades,
  raterName,
  onExit,
}: {
  session: GradingSession;
  carcasses: Carcass[];
  initialGrades: Record<number, Grade>;
  raterName: string;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [grades, setGrades] = useState<Record<number, Partial<Grade>>>(initialGrades);
  const [images, setImages] = useState<Image[]>([]);
  const [imgSrc, setImgSrc] = useState<string>("");
  const [imgLoading, setImgLoading] = useState(true);
  const carcass = carcasses[idx];

  const current = grades[carcass.id] ?? {};

  const gradedCount = useMemo(
    () => Object.values(grades).filter((g) => g.conformation || g.finishing).length,
    [grades]
  );

  useEffect(() => {
    let alive = true;
    setImgSrc("");
    setImgLoading(true);
    setImages([]);
    api.listImages(carcass.id).then(async (imgs) => {
      if (!alive) return;
      setImages(imgs);
      if (imgs.length) {
        const url = await api.imageDataURL(imgs[0].rgbPath);
        if (alive) setImgSrc(url);
      }
      if (alive) setImgLoading(false);
    }).catch(() => {
      if (alive) setImgLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [carcass.id]);

  async function setAxis(axis: "conformation" | "finishing", value: string) {
    const next: Partial<Grade> = { ...current, [axis]: value };
    setGrades((g) => ({ ...g, [carcass.id]: next }));
    try {
      await api.saveGrade({
        sessionId: session.id,
        carcassId: carcass.id,
        conformation: next.conformation ?? "",
        finishing: next.finishing ?? "",
        confidence: next.confidence ?? 0,
      });
    } catch (e) {
      toast.error(String(e));
    }
  }

  function go(delta: number) {
    setIdx((i) => Math.max(0, Math.min(carcasses.length - 1, i + delta)));
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Blind session · {raterName}</div>
          <p className="telemetry text-xs text-muted-foreground">
            Carcass {idx + 1} of {carcasses.length} · {gradedCount} graded · other raters hidden
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onExit}>
          <LogOut className="size-4" /> End session
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="panel flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-md bg-black/40">
            {imgSrc ? (
              <img src={imgSrc} className="max-h-full max-w-full object-contain" />
            ) : imgLoading ? (
              <div className="w-40 px-4">
                <div className="loading-line" />
                <p className="mt-2 text-center text-[11px] text-muted-foreground">loading image</p>
              </div>
            ) : (
              <EmptyState eyebrow="No image" className="border-0">
                This carcass has no images to grade.
              </EmptyState>
            )}
          </div>
          {images.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              {images.length} images · showing 1st
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="panel rounded-md p-3">
            <div className="telemetry text-sm">#{carcass.physicalTag}</div>
            {carcass.animalId && (
              <div className="text-xs text-muted-foreground">animal {carcass.animalId}</div>
            )}
          </div>

          <div className="panel rounded-md p-3">
            <AxisPicker
              label="Conformation"
              hint="shape and muscle development"
              options={CONFORMATION}
              value={current.conformation ?? ""}
              onPick={(v) => setAxis("conformation", v)}
            />
          </div>

          <div className="panel rounded-md p-3">
            <AxisPicker
              label="Finishing"
              hint="fat cover — optical limit"
              options={FINISHING}
              value={current.finishing ?? ""}
              onPick={(v) => setAxis("finishing", v)}
            />
          </div>

          <div className="mt-auto flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => go(-1)} disabled={idx === 0}>
              <ChevronLeft className="size-4" /> Previous
            </Button>
            {(current.conformation || current.finishing) && (
              <span className="status-pill text-ok">
                <Check className="size-3" /> saved
              </span>
            )}
            <Button size="sm" onClick={() => go(1)} disabled={idx === carcasses.length - 1}>
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AxisPicker({
  label,
  hint,
  options,
  value,
  onPick,
}: {
  label: string;
  hint: string;
  options: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="eyebrow">{label}</div>
        <div className="text-[11px] leading-tight text-muted-foreground">{hint}</div>
      </div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            className={cn(
              "app-no-drag h-8 flex-1 rounded-sm border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              value === o
                ? "border-primary bg-primary/25 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
