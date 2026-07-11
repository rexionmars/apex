import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Beef } from "lucide-react";
import { api, type Carcass } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
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
  const [loading, setLoading] = useState(true);
  const [tag, setTag] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [treatment, setTreatment] = useState("");
  const [stratum, setStratum] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (obj.batchId == null) return;
    setLoading(true);
    try {
      setCarcasses(await api.listCarcasses(obj.batchId));
    } finally {
      setLoading(false);
    }
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
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Register carcass</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field id="reg-tag" label="Physical tag *">
            <Input id="reg-tag" placeholder="e.g.: 10" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </Field>
          <Field id="reg-animal" label="Animal (lab)">
            <Input id="reg-animal" placeholder="Spreadsheet ID" value={animalId} onChange={(e) => setAnimalId(e.target.value)} />
          </Field>
          <Field id="reg-treatment" label="Treatment">
            <Input id="reg-treatment" placeholder="T1 / 0%" value={treatment} onChange={(e) => setTreatment(e.target.value)} />
          </Field>
          <Field id="reg-stratum" label="Stratum">
            <Input id="reg-stratum" value={stratum} onChange={(e) => setStratum(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={create} disabled={saving}><Plus className="size-4" /> Register</Button>
        </div>
      </div>

      <div>
        <div className="eyebrow mb-2">Carcasses in batch ({carcasses.length})</div>
        {loading ? (
          <div className="py-4"><div className="loading-line" /></div>
        ) : carcasses.length === 0 ? (
          <EmptyState eyebrow="No carcasses">
            No carcasses yet. Register above, or import photos.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
            {carcasses.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenCarcass(c.id, c.physicalTag)}
                className={cn(
                  "panel app-no-drag flex items-center gap-2.5 rounded-md p-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
