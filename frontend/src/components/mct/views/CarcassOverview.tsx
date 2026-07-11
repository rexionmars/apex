import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api, type Carcass } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";

export function CarcassOverview({ obj, onChanged }: { obj: DomainObject; onChanged: () => void }) {
  const [c, setC] = useState<Carcass | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (obj.carcassId == null || obj.batchId == null) return;
    setLoading(true);
    setMissing(false);
    api.listCarcasses(obj.batchId).then((list) => {
      const found = list.find((x) => x.id === obj.carcassId) ?? null;
      setC(found);
      setMissing(!found);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
      setMissing(true);
    });
  }, [obj.carcassId, obj.batchId]);

  if (loading) {
    return (
      <div className="p-5">
        <div className="loading-line mb-2" />
        <p className="text-xs text-muted-foreground">loading</p>
      </div>
    );
  }

  if (missing || !c) {
    return (
      <div className="p-5">
        <EmptyState eyebrow="Not found">Carcass not found in this batch.</EmptyState>
      </div>
    );
  }

  const num = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  async function save() {
    if (!c) return;
    if (!c.physicalTag.trim()) {
      toast.error("Physical tag is required.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateCarcass(c);
      setC(saved);
      onChanged();
      toast.success(`Carcass #${saved.physicalTag} updated.`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-5">
      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Identification</div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="c-tag" label="Physical tag *">
            <Input id="c-tag" value={c.physicalTag} onChange={(e) => setC({ ...c, physicalTag: e.target.value })} />
          </Field>
          <Field id="c-animal" label="Animal (laboratory)">
            <Input id="c-animal" value={c.animalId} onChange={(e) => setC({ ...c, animalId: e.target.value })} />
          </Field>
          <Field id="c-treatment" label="Treatment">
            <Input id="c-treatment" value={c.treatment} onChange={(e) => setC({ ...c, treatment: e.target.value })} />
          </Field>
          <Field id="c-stratum" label="Stratum">
            <Input id="c-stratum" value={c.stratum} onChange={(e) => setC({ ...c, stratum: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Physical reference (measured on the animal)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="c-fat" label="Fat thickness (mm)">
            <Input id="c-fat" inputMode="decimal" value={c.fatThicknessMm ?? ""} onChange={(e) => setC({ ...c, fatThicknessMm: num(e.target.value) })} />
          </Field>
          <Field id="c-gr" label="GR (mm)">
            <Input id="c-gr" inputMode="decimal" value={c.grMeasureMm ?? ""} onChange={(e) => setC({ ...c, grMeasureMm: num(e.target.value) })} />
          </Field>
          <Field id="c-lea" label="Loin eye area (cm²)">
            <Input id="c-lea" inputMode="decimal" value={c.loinEyeAreaCm2 ?? ""} onChange={(e) => setC({ ...c, loinEyeAreaCm2: num(e.target.value) })} />
          </Field>
        </div>
      </div>

      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Notes</div>
        <Input id="c-notes" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
      </div>

      <div>
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="size-4" /> Save
        </Button>
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
