import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Check, LogOut } from "lucide-react";
import { api, type Carcass, type Grade, type GradingSession, type Image } from "@/lib/api";
import { Button } from "@/components/ui/button";

// Grading scales (ordinal). Conformation and finishing follow the 1..5 standard.
const CONFORMATION = ["1", "2", "3", "4", "5"]; // worse -> better muscle development
const FINISHING = ["1", "2", "3", "4", "5"]; // less -> more fat cover

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
  const carcass = carcasses[idx];

  const current = grades[carcass.id] ?? {};

  const gradedCount = useMemo(
    () => Object.values(grades).filter((g) => g.conformation || g.finishing).length,
    [grades]
  );

  useEffect(() => {
    let alive = true;
    setImgSrc("");
    api.listImages(carcass.id).then(async (imgs) => {
      if (!alive) return;
      setImages(imgs);
      if (imgs.length) {
        const url = await api.imageDataURL(imgs[0].rgbPath);
        if (alive) setImgSrc(url);
      }
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
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Blind session · {raterName}</h1>
          <p className="text-xs text-muted-foreground">
            Carcass {idx + 1} of {carcasses.length} · {gradedCount} graded · other raters' scores
            hidden
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onExit}>
          <LogOut className="size-4" /> End session
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4">
        {/* Image */}
        <div className="flex flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-black/40">
            {imgSrc ? (
              <img src={imgSrc} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">loading image…</span>
            )}
          </div>
          {images.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              {images.length} images · showing 1st
            </p>
          )}
        </div>

        {/* Scores panel */}
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="font-medium">Carcass #{carcass.physicalTag}</div>
            {carcass.animalId && (
              <div className="text-xs text-muted-foreground">animal {carcass.animalId}</div>
            )}
          </div>

          <AxisPicker
            label="Conformation"
            hint="shape and muscle development (observable in the image)"
            options={CONFORMATION}
            value={current.conformation ?? ""}
            onPick={(v) => setAxis("conformation", v)}
          />

          <AxisPicker
            label="Finishing"
            hint="fat cover — optical limitation: ideally validated by physical reference"
            options={FINISHING}
            value={current.finishing ?? ""}
            onPick={(v) => setAxis("finishing", v)}
          />

          <div className="mt-auto flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => go(-1)} disabled={idx === 0}>
              <ChevronLeft className="size-4" /> Previous
            </Button>
            {(current.conformation || current.finishing) && (
              <span className="flex items-center gap-1 text-xs text-ok">
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
    <div className="flex flex-col gap-1.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] leading-tight text-muted-foreground">{hint}</div>
      </div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            className={
              "h-9 flex-1 rounded-md border text-sm font-medium transition-colors " +
              (value === o
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border hover:bg-secondary")
            }
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
