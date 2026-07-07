import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Beef } from "lucide-react";
import { api, type Carcass } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Batch overview: carcass grid + create new (quick registration at slaughter).
export function BatchOverview({
  obj,
  onOpenCarcass,
  onChanged,
}: {
  obj: DomainObject;
  onOpenCarcass: (carcassId: number, tag: string) => void;
  onChanged: () => void;
}) {
  const [carcasses, setCarcasses] = useState<Carcass[]>([]);
  const [tag, setTag] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [treatment, setTreatment] = useState("");
  const [stratum, setStratum] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (obj.batchId == null) return;
    setCarcasses(await api.listCarcasses(obj.batchId));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.batchId]);

  async function create() {
    if (obj.batchId == null) return;
    if (!tag.trim()) {
      toast.error("Physical tag is required — it pairs the image to the animal.");
      return;
    }
    setSaving(true);
    try {
      const c = await api.createCarcass({
        batchId: obj.batchId,
        physicalTag: tag.trim(),
        animalId: animalId.trim(),
        treatment: treatment.trim(),
        stratum: stratum.trim(),
      });
      setTag(""); setAnimalId(""); setTreatment(""); setStratum("");
      await load();
      onChanged();
      toast.success(`Carcass #${c.physicalTag} registered.`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Register carcass</div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Physical tag *"><Input placeholder="e.g.: 10" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} /></Field>
          <Field label="Animal (lab)"><Input placeholder="Spreadsheet ID" value={animalId} onChange={(e) => setAnimalId(e.target.value)} /></Field>
          <Field label="Treatment"><Input placeholder="T1 / 0%" value={treatment} onChange={(e) => setTreatment(e.target.value)} /></Field>
          <Field label="Stratum"><Input value={stratum} onChange={(e) => setStratum(e.target.value)} /></Field>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={create} disabled={saving}><Plus className="size-4" /> Register</Button>
        </div>
      </div>

      <div>
        <div className="eyebrow mb-2">Carcasses in batch ({carcasses.length})</div>
        {carcasses.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No carcasses yet. Register above, or import photos.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2.5">
            {carcasses.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenCarcass(c.id, c.physicalTag)}
                className={cn(
                  "panel app-no-drag flex items-center gap-2.5 rounded-md p-3 text-left transition-colors hover:border-primary/50"
                )}
              >
                <Beef className="size-4 text-primary/70" />
                <div className="min-w-0">
                  <div className="telemetry truncate text-sm">#{c.physicalTag}</div>
                  <div className="telemetry text-[11px] text-muted-foreground">{c.imageCount} img{c.animalId ? ` · ${c.animalId}` : ""}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}
