import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api, type Carcass } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Carcass overview = edit form for all fields.
// (Replaces the former CarcassEditor, now as the object's "view".)
export function CarcassOverview({ obj, onChanged }: { obj: DomainObject; onChanged: () => void }) {
  const [c, setC] = useState<Carcass | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (obj.carcassId == null || obj.batchId == null) return;
    api.listCarcasses(obj.batchId).then((list) => {
      setC(list.find((x) => x.id === obj.carcassId) ?? null);
    });
  }, [obj.carcassId, obj.batchId]);

  if (!c) return <div className="p-6 text-sm text-muted-foreground">loading…</div>;

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
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Identification</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Physical tag *"><Input value={c.physicalTag} onChange={(e) => setC({ ...c, physicalTag: e.target.value })} /></Field>
          <Field label="Animal (laboratory)"><Input value={c.animalId} onChange={(e) => setC({ ...c, animalId: e.target.value })} /></Field>
          <Field label="Treatment"><Input value={c.treatment} onChange={(e) => setC({ ...c, treatment: e.target.value })} /></Field>
          <Field label="Stratum"><Input value={c.stratum} onChange={(e) => setC({ ...c, stratum: e.target.value })} /></Field>
        </div>
      </div>

      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Physical reference (measured on the animal)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fat thickness (mm)"><Input inputMode="decimal" value={c.fatThicknessMm ?? ""} onChange={(e) => setC({ ...c, fatThicknessMm: num(e.target.value) })} /></Field>
          <Field label="GR (mm)"><Input inputMode="decimal" value={c.grMeasureMm ?? ""} onChange={(e) => setC({ ...c, grMeasureMm: num(e.target.value) })} /></Field>
          <Field label="Loin eye area (cm²)"><Input inputMode="decimal" value={c.loinEyeAreaCm2 ?? ""} onChange={(e) => setC({ ...c, loinEyeAreaCm2: num(e.target.value) })} /></Field>
        </div>
      </div>

      <div className="panel rounded-md p-4">
        <div className="eyebrow mb-3">Notes</div>
        <Input value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
      </div>

      <div>
        <Button onClick={save} disabled={saving}><Save className="size-4" /> Save</Button>
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
