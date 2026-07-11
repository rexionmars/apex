import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import {
  api,
  type Batch,
  type BatchProgress,
  type AgreementReport,
  type UnpairedInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const TARGET = 100; // sample target (R3): 100–120 carcasses

export function DashboardPage() {
  const [progress, setProgress] = useState<BatchProgress[]>([]);
  const [unpaired, setUnpaired] = useState<UnpairedInfo | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState<number>(0); // 0 = all
  const [agreement, setAgreement] = useState<AgreementReport | null>(null);
  const [exporting, setExporting] = useState(false);
  const [onlyConsensus, setOnlyConsensus] = useState(true);
  const bridged = api.isBridged();

  async function load() {
    try {
      setProgress(await api.batchProgressReport());
      setUnpaired(await api.unpairedReport());
      setBatches(await api.listBatches());
      setAgreement(await api.computeAgreement(batchId));
    } catch (e) {
      toast.error(String(e));
    }
  }

  useEffect(() => {
    if (bridged) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bridged) api.computeAgreement(batchId).then(setAgreement).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function doExport() {
    setExporting(true);
    try {
      const res = await api.exportDataset(batchId, onlyConsensus);
      toast.success(
        `Dataset exported: ${res.imagesExported} images from ${res.carcassesExported} carcasses.`
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  }

  if (!bridged) {
    return (
      <div className="p-5">
        <EmptyState eyebrow="Bridge required">
          This screen must run inside the app (<code>wails dev</code> or a compiled binary).
        </EmptyState>
      </div>
    );
  }

  const totalCarcasses = progress.reduce((s, p) => s + p.carcassCount, 0);
  const totalImages = progress.reduce((s, p) => s + p.imageCount, 0);
  const totalGraded = progress.reduce((s, p) => s + p.gradedCount, 0);
  const pct = Math.min(100, Math.round((totalCarcasses / TARGET) * 100));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Project</div>
          <p className="text-sm text-muted-foreground">
            Sample progress, inter-rater agreement, and pairing integrity.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Carcasses" value={totalCarcasses} sub={`target ${TARGET}–120`} />
        <Stat label="Images" value={totalImages} />
        <Stat label="Graded" value={totalGraded} />
        <Stat
          label="Pairing"
          value={unpaired ? `${unpaired.totalImages - unpaired.unpaired}/${unpaired.totalImages}` : "—"}
          sub={unpaired && unpaired.unpaired === 0 ? "intact" : "check"}
          ok={unpaired?.unpaired === 0}
        />
      </div>

      <div className="panel rounded-md">
        <div className="border-b border-hairline px-4 py-3">
          <div className="eyebrow">Stratified sample (R3)</div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="progress-track h-2">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="telemetry text-xs text-muted-foreground">
            {totalCarcasses} of {TARGET} carcasses ({pct}%)
          </div>
          {progress.map((p) => (
            <div key={p.batchId} className="rounded-sm border border-border bg-background/30 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{p.batchName}</span>
                <span className="telemetry text-xs text-muted-foreground">
                  {p.carcassCount} carcasses · {p.imageCount} img · {p.gradedCount} graded
                </span>
              </div>
              {p.byStratum.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.byStratum.map((s) => (
                    <span
                      key={s.stratum}
                      className="rounded-sm bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {s.stratum}: {s.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel rounded-md">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="eyebrow">Inter-rater agreement (Fleiss' κ)</div>
          <select
            className="h-7 rounded-sm border border-input bg-transparent px-2 text-xs"
            value={batchId}
            onChange={(e) => setBatchId(Number(e.target.value))}
          >
            <option value={0}>All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <AxisCard title="Conformation" a={agreement?.conformation} />
          <AxisCard title="Finishing" a={agreement?.finishing} />
          <p className="col-span-full text-xs text-muted-foreground">
            Finishing (fat) is limited by surface imaging; predictive validation requires
            physical reference on the same animals.
          </p>
        </div>
      </div>

      <div className="panel rounded-md">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <ShieldCheck className="size-3.5 text-muted-foreground" />
          <div className="eyebrow">Export dataset</div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyConsensus}
              onChange={(e) => setOnlyConsensus(e.target.checked)}
            />
            Export only carcasses with consensus grade
          </label>
          <div>
            <Button size="sm" onClick={doExport} disabled={exporting}>
              <Download className="size-4" /> Export (manifest + integrity report)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Generates <code>manifest.csv</code> (one row per image, with full pairing) and
            <code> integrity_report.txt</code>. Only images with an associated carcass are included.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string | number;
  sub?: string;
  ok?: boolean;
}) {
  return (
    <div className="panel rounded-md p-3">
      <div className="eyebrow">{label}</div>
      <div className="telemetry mt-1 text-2xl font-semibold">{value}</div>
      {sub && (
        <div className={"telemetry text-xs " + (ok ? "text-primary" : "text-muted-foreground")}>
          {sub}
        </div>
      )}
    </div>
  );
}

function AxisCard({ title, a }: { title: string; a?: { kappa: number; kappaLabel: string; kappaComputable: boolean; percentAgreement: number; itemsEvaluated: number } }) {
  return (
    <div className="rounded-sm border border-border bg-background/30 p-3">
      <div className="eyebrow">{title}</div>
      {a && a.kappaComputable ? (
        <>
          <div className="telemetry mt-1 text-2xl font-semibold text-primary">
            {a.kappa.toFixed(3)}
          </div>
          <div className="text-xs text-muted-foreground">
            {a.kappaLabel} · {(a.percentAgreement * 100).toFixed(0)}% unanimous agreement ·{" "}
            {a.itemsEvaluated} carcasses
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          κ not computable yet (needs ≥2 raters on the same set of carcasses).
        </div>
      )}
    </div>
  );
}
