import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { api, type Carcass, type AnalysisRow } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { summarize } from "@/lib/stats";

// Open MCT Inspector: properties of the selected object. Read-only — editing
// stays in the views. Collapsible.
export function Inspector({
  obj,
  collapsed,
  onToggle,
  refreshKey,
}: {
  obj: DomainObject | null;
  collapsed: boolean;
  onToggle: () => void;
  refreshKey: number;
}) {
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        title="Open inspector"
        className="app-no-drag flex w-8 shrink-0 items-center justify-center border-l border-border bg-panel text-muted-foreground hover:text-foreground"
      >
        <PanelRightOpen className="size-4" />
      </button>
    );
  }

  return (
    <aside className="panel-scroll flex w-72 shrink-0 flex-col overflow-auto border-l border-border bg-panel">
      <div className="flex h-9 items-center justify-between border-b border-hairline px-3">
        <span className="eyebrow">Inspector</span>
        <button onClick={onToggle} title="Collapse" className="app-no-drag text-muted-foreground hover:text-foreground">
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {!obj && <Empty />}
        {obj?.type === "carcass" && <CarcassInspector obj={obj} refreshKey={refreshKey} />}
        {obj?.type === "batch" && <BatchInspector obj={obj} refreshKey={refreshKey} />}
        {obj && (obj.type === "import" || obj.type === "dashboard" || obj.type === "live") && (
          <Prop label="Type">
            {obj.type === "import"
              ? "Image import"
              : obj.type === "dashboard"
                ? "Project panel"
                : "Live fat monitor"}
          </Prop>
        )}
      </div>
    </aside>
  );
}

function Empty() {
  return (
    <div className="rounded-sm border border-dashed border-border p-4 text-xs text-muted-foreground">
      No object selected. Choose a batch or carcass in the navigation to see its properties.
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="loading-line" />
      <span className="text-[10px] text-muted-foreground">loading</span>
    </div>
  );
}

function CarcassInspector({ obj, refreshKey }: { obj: DomainObject; refreshKey: number }) {
  const [c, setC] = useState<Carcass | null>(null);
  const [imgCount, setImgCount] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisRow | null>(null);

  useEffect(() => {
    if (obj.carcassId == null) return;
    let alive = true;
    (async () => {
      const list = await api.listCarcasses(obj.batchId!);
      const found = list.find((x) => x.id === obj.carcassId) ?? null;
      const imgs = await api.listImages(obj.carcassId!);
      const analyses = await api.listAnalyses(obj.batchId!);
      if (!alive) return;
      setC(found);
      setImgCount(imgs.filter((i) => i.source !== "analysis").length);
      setAnalysis(analyses.find((a) => a.carcassId === obj.carcassId) ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [obj.carcassId, obj.batchId, refreshKey]);

  if (!c) return <Loading />;

  return (
    <>
      <Section title="Identification" />
      <Prop label="Physical tag" mono>{c.physicalTag}</Prop>
      <Prop label="Animal (lab)" mono>{c.animalId || "—"}</Prop>
      <Prop label="Treatment">{c.treatment || "—"}</Prop>
      <Prop label="Stratum">{c.stratum || "—"}</Prop>
      <Prop label="Species">{c.species}</Prop>

      <Section title="Acquisition" />
      <Prop label="Images" mono>{imgCount}</Prop>

      <Section title="Physical reference" />
      <Prop label="Fat thickness" mono>{c.fatThicknessMm != null ? `${c.fatThicknessMm} mm` : "—"}</Prop>
      <Prop label="GR" mono>{c.grMeasureMm != null ? `${c.grMeasureMm} mm` : "—"}</Prop>
      <Prop label="Loin eye area" mono>{c.loinEyeAreaCm2 != null ? `${c.loinEyeAreaCm2} cm²` : "—"}</Prop>

      {analysis && (
        <>
          <Section title="Model analysis" />
          <Prop label="Fat (model)" mono accent>{analysis.fatPercent.toFixed(1)}%</Prop>
          {analysis.backgroundRemoved && <Prop label="Background removed" mono>yes</Prop>}
          {analysis.finishingClass && (
            <Prop label="Grade (experimental)" alert>{analysis.finishingClass}</Prop>
          )}
        </>
      )}

      {analysis && analysis.conformationIndex != null && (
        <>
          <Section title="Conformation (convexity)" />
          <Prop label="Leg convexity" mono>{analysis.convPerna?.toFixed(3) ?? "—"}</Prop>
          <Prop label="Loin convexity" mono>{analysis.convLombo?.toFixed(3) ?? "—"}</Prop>
          <Prop label="Shoulder convexity" mono>{analysis.convPaleta?.toFixed(3) ?? "—"}</Prop>
          <Prop label="Index" mono>{analysis.conformationIndex.toFixed(3)}</Prop>
          {analysis.conformationGrade && (
            <Prop label="Grade (estimate)" alert>{analysis.conformationGrade}</Prop>
          )}
        </>
      )}
    </>
  );
}

function BatchInspector({ obj, refreshKey }: { obj: DomainObject; refreshKey: number }) {
  const [n, setN] = useState(0);
  const [imgs, setImgs] = useState(0);
  const [fat, setFat] = useState<number[]>([]);

  useEffect(() => {
    if (obj.batchId == null) return;
    let alive = true;
    (async () => {
      const cs = await api.listCarcasses(obj.batchId!);
      const analyses = await api.listAnalyses(obj.batchId!);
      if (!alive) return;
      setN(cs.length);
      setImgs(cs.reduce((s, x) => s + x.imageCount, 0));
      setFat(analyses.map((a) => a.fatPercent));
    })();
    return () => {
      alive = false;
    };
  }, [obj.batchId, refreshKey]);

  const s = summarize(fat);

  return (
    <>
      <Section title="Batch" />
      <Prop label="Carcasses" mono>{n}</Prop>
      <Prop label="Images" mono>{imgs}</Prop>
      <Prop label="Analyzed" mono>{s.n}</Prop>

      {s.n > 0 && (
        <>
          <Section title="Fat (model)" />
          <Prop label="Mean" mono accent>{s.mean.toFixed(1)}%</Prop>
          <Prop label="Std dev" mono>±{s.std.toFixed(1)}</Prop>
          <Prop label="Range" mono>{s.min.toFixed(0)}–{s.max.toFixed(0)}%</Prop>
        </>
      )}
    </>
  );
}

function Section({ title }: { title: string }) {
  return <div className="eyebrow border-b border-hairline pb-1 pt-1">{title}</div>;
}

function Prop({
  label,
  children,
  mono,
  accent,
  alert,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={[
          "text-right text-sm",
          mono ? "telemetry" : "",
          accent ? "text-primary" : alert ? "text-alert" : "text-foreground",
        ].join(" ")}
      >
        {children}
      </span>
    </div>
  );
}
