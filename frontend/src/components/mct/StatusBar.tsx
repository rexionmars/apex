import { useEffect, useState } from "react";
import { Cpu, Database } from "lucide-react";
import { api, type GlobalStats, type InferenceProbe } from "@/lib/api";

// Bottom status bar — the analog of Open MCT's "time conductor":
// global system state (inference engine, device, dataset counts).
export function StatusBar({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [probe, setProbe] = useState<InferenceProbe | null>(null);

  useEffect(() => {
    if (!api.isBridged()) return;
    api.globalStats().then(setStats).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!api.isBridged()) return;
    api.inferenceProbe().then(setProbe).catch(() => setProbe(null));
  }, []);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-border bg-head-bg px-4 text-[11px] text-muted-foreground">
      {/* inference engine */}
      <span className="flex items-center gap-1.5">
        <Cpu className="size-3" />
        {probe === null ? (
          <span>engine —</span>
        ) : probe.available ? (
          <span className="telemetry">
            engine <span className="text-ok">ready</span> · <span className="text-primary">{probe.device}</span>
          </span>
        ) : (
          <span className="telemetry text-alert">engine offline</span>
        )}
      </span>

      <span className="h-3 w-px bg-border" />

      {/* dataset */}
      <span className="telemetry flex items-center gap-1.5">
        <Database className="size-3" />
        {stats
          ? `${stats.batches} batches · ${stats.carcasses} carcasses · ${stats.images} images · ${stats.graded} graded`
          : "loading…"}
      </span>

      <span className="telemetry ml-auto tracking-[0.14em] text-muted-foreground/70">
        CARCASS · iCEV
      </span>
    </footer>
  );
}
