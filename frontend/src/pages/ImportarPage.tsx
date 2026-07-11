import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Link2, Sparkles, Loader2 } from "lucide-react";
import { api, type Batch, type Carcass, type ScannedFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { bump } from "@/App";

// Importing external datasets. Two paths:
//  A) Import everything as NEW carcasses (1 photo = 1 carcass, tag = filename).
//     Fast for those who already have the photos; the data is edited later in the
//     Overview. Pairing stays guaranteed — the carcass is created alongside the image.
//  B) Pair to an EXISTING carcass (manual reconciliation), per item.
export function ImportarPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [carcasses, setCarcasses] = useState<Carcass[]>([]);
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [imported, setImported] = useState<Set<string>>(new Set());
  const bridged = api.isBridged();

  useEffect(() => {
    if (!bridged) return;
    api.listBatches().then((b) => {
      setBatches(b);
      if (b.length) setBatchId(b[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (batchId !== null) api.listCarcasses(batchId).then(setCarcasses);
  }, [batchId]);

  async function chooseAndScan() {
    try {
      const chosen = await api.chooseDirectory();
      if (!chosen) return;
      setDir(chosen);
      setScanning(true);
      const found = await api.scanImportDir(chosen);
      setFiles(found);
      setAssign({});
      setImported(new Set());
      const dups = found.filter((f) => f.duplicate).length;
      toast.success(`${found.length} images found${dups ? ` (${dups} already in dataset)` : ""}.`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setScanning(false);
    }
  }

  const pending = files.filter((f) => !f.duplicate && !imported.has(f.path));

  // (A) import ALL pending as new carcasses
  async function importAllAsNew() {
    if (batchId === null) {
      toast.error("Select the target batch.");
      return;
    }
    if (pending.length === 0) {
      toast.error("No pending images to import.");
      return;
    }
    setImportingAll(true);
    try {
      const res = await api.importAllAsNewCarcasses(batchId, pending.map((f) => f.path));
      setImported((prev) => {
        const n = new Set(prev);
        pending.forEach((f) => n.add(f.path));
        return n;
      });
      await api.listCarcasses(batchId).then(setCarcasses);
      bump.fn();
      if (res.errors.length) {
        toast.warning(`${res.created} created, ${res.skipped} skipped. See details.`);
        res.errors.slice(0, 3).forEach((e) => toast.error(e));
      } else {
        toast.success(`${res.created} carcasses created from the photos. Edit the data in the Overview.`);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImportingAll(false);
    }
  }

  // (A-item) import ONE image as a new carcass
  async function importOneAsNew(f: ScannedFile) {
    if (batchId === null) return;
    try {
      await api.importImageAsNewCarcass(batchId, f.path);
      setImported((prev) => new Set(prev).add(f.path));
      await api.listCarcasses(batchId).then(setCarcasses);
      bump.fn();
      toast.success(`${f.name} imported as a new carcass.`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  // (B) pair to existing carcass
  async function pairToExisting(f: ScannedFile) {
    const carcassId = assign[f.path];
    if (!carcassId) {
      toast.error("Choose the target carcass.");
      return;
    }
    try {
      await api.importImage(carcassId, f.path, "");
      setImported((prev) => new Set(prev).add(f.path));
      await api.listCarcasses(batchId!).then(setCarcasses);
      bump.fn();
      toast.success(`${f.name} paired to the carcass.`);
    } catch (e) {
      toast.error(String(e));
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
      <div>
        <div className="eyebrow">Import</div>
        <p className="text-sm text-muted-foreground">
          Already have the photos? Import them all at once — each photo becomes a carcass (the tag
          gets the filename) and you fill in the data later in the Overview.
        </p>
      </div>

      <div className="panel rounded-md">
        <div className="border-b border-hairline px-4 py-3">
          <div className="eyebrow">Source</div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={chooseAndScan} disabled={scanning}>
              <FolderOpen className="size-4" /> Choose folder and scan
            </Button>
            {dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Target batch</span>
            <select
              className="h-8 rounded-sm border border-input bg-background/40 px-2 text-sm"
              value={batchId ?? ""}
              onChange={(e) => setBatchId(Number(e.target.value))}
            >
              {batches.length === 0 && <option value="">create a batch first</option>}
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {pending.length > 0 && (
            <div className="flex items-center gap-3 rounded-sm border border-primary/40 bg-primary/5 p-3">
              <Sparkles className="size-4 text-primary" />
              <div className="flex-1 text-sm">
                Import <strong>{pending.length}</strong> photo(s) as new carcasses in this batch.
                <div className="text-xs text-muted-foreground">
                  The tag uses the filename; edit everything later in the Overview.
                </div>
              </div>
              <Button size="sm" onClick={importAllAsNew} disabled={importingAll || batchId === null}>
                {importingAll ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {importingAll ? "Importing…" : "Import all"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="panel rounded-md">
          <div className="border-b border-hairline px-4 py-3">
            <div className="eyebrow">
              Files — {pending.length} pending, {imported.size} imported
            </div>
          </div>
          <div className="flex flex-col gap-1 p-4">
            {files.map((f) => {
              const done = imported.has(f.path);
              return (
                <div
                  key={f.path}
                  className="flex items-center gap-3 rounded-sm border border-border px-3 py-2 text-sm"
                >
                  <span className="w-52 truncate" title={f.path}>
                    {f.name}
                  </span>
                  <span className="telemetry w-20 text-xs text-muted-foreground">
                    {(f.sizeBytes / 1024).toFixed(0)} KB
                  </span>

                  {f.duplicate ? (
                    <span className="text-xs text-muted-foreground">already in dataset (dedup)</span>
                  ) : done ? (
                    <span className="text-xs text-primary">✓ imported</span>
                  ) : (
                    <div className="flex flex-1 items-center gap-2">
                      <Button size="sm" onClick={() => importOneAsNew(f)}>
                        <Sparkles className="size-4" /> New carcass
                      </Button>
                      <span className="text-xs text-muted-foreground">or</span>
                      <select
                        className="h-8 flex-1 rounded-sm border border-input bg-background/40 px-2 text-sm"
                        value={assign[f.path] ?? ""}
                        onChange={(e) =>
                          setAssign((prev) => ({ ...prev, [f.path]: Number(e.target.value) }))
                        }
                      >
                        <option value="">— pair to existing carcass —</option>
                        {carcasses.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.physicalTag}
                            {c.animalId ? ` · animal ${c.animalId}` : ""}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" onClick={() => pairToExisting(f)}>
                        <Link2 className="size-4" /> Pair
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
