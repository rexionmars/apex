import { useEffect, useState } from "react";
import { api, type Carcass } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { CarcassPanel } from "@/components/CarcassPanel";

// Carcass "Images" view: capture (webcam/Kinect) + image gallery.
export function CarcassImages({ obj, onChanged }: { obj: DomainObject; onChanged: () => void }) {
  const [c, setC] = useState<Carcass | null>(null);

  useEffect(() => {
    if (obj.carcassId == null || obj.batchId == null) return;
    api.listCarcasses(obj.batchId).then((list) => setC(list.find((x) => x.id === obj.carcassId) ?? null));
  }, [obj.carcassId, obj.batchId]);

  if (!c) return <div className="p-6 text-sm text-muted-foreground">loading…</div>;

  return (
    <div className="p-6">
      <CarcassPanel carcass={c} onImageSaved={onChanged} />
    </div>
  );
}
