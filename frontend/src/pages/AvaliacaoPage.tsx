import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Play } from "lucide-react";
import {
  api,
  type Batch,
  type Carcass,
  type Rater,
  type GradingSession,
  type Grade,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GradingWorkspace } from "@/components/GradingWorkspace";

// Inter-rater grading (R2): each rater scores independently and blind.
export function AvaliacaoPage({ batchId: fixedBatchId }: { batchId: number | null }) {
  const [raters, setRaters] = useState<Rater[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [raterId, setRaterId] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<number | null>(fixedBatchId);
  const [newRater, setNewRater] = useState("");
  const [session, setSession] = useState<GradingSession | null>(null);
  const [carcasses, setCarcasses] = useState<Carcass[]>([]);
  const [existing, setExisting] = useState<Record<number, Grade>>({});
  const bridged = api.isBridged();
  const lockedToBatch = fixedBatchId != null;

  async function load() {
    try {
      setRaters(await api.listRaters());
      const b = await api.listBatches();
      setBatches(b);
      if (fixedBatchId != null) setBatchId(fixedBatchId);
      else if (b.length && batchId === null) setBatchId(b[0].id);
    } catch (e) {
      toast.error(String(e));
    }
  }

  useEffect(() => {
    if (bridged) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addRater() {
    if (!newRater.trim()) return;
    try {
      const r = await api.createRater({ name: newRater.trim() });
      setNewRater("");
      await load();
      setRaterId(r.id);
      toast.success(`Rater "${r.name}" added.`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function begin() {
    if (raterId === null) {
      toast.error("Choose a rater.");
      return;
    }
    if (batchId === null) {
      toast.error("Choose a batch.");
      return;
    }
    try {
      const s = await api.startSession(raterId);
      const cs = await api.listCarcasses(batchId);
      const withImages = cs.filter((c) => c.imageCount > 0);
      if (withImages.length === 0) {
        toast.error("No carcass with images in this batch. Capture before grading.");
        return;
      }
      const g = await api.gradesForSession(s.id);
      setSession(s);
      setCarcasses(withImages);
      setExisting(g);
      toast.success("Blind session started. Other raters' scores are hidden.");
    } catch (e) {
      toast.error(String(e));
    }
  }

  if (!bridged) {
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        This screen must run inside the app (<code>wails dev</code> or a compiled binary).
      </div>
    );
  }

  if (session) {
    return (
      <GradingWorkspace
        session={session}
        carcasses={carcasses}
        initialGrades={existing}
        raterName={raters.find((r) => r.id === session.raterId)?.name ?? ""}
        onExit={() => {
          setSession(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Inter-rater grading</h1>
        <p className="text-sm text-muted-foreground">
          Each rater assigns the grade <strong>on the image</strong>, independently and blind.
          Agreement (Fleiss' κ) validates the score as a reference.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rater</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {raters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {raters.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRaterId(r.id)}
                  className={
                    "app-no-drag rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (raterId === r.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary")
                  }
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="New rater name"
              value={newRater}
              onChange={(e) => setNewRater(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRater()}
            />
            <Button size="sm" variant="outline" onClick={addRater}>
              <UserPlus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batch to grade</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lockedToBatch ? (
            <div className="text-sm text-muted-foreground">
              Batch: <span className="text-foreground">{batches.find((b) => b.id === batchId)?.name ?? "—"}</span>
            </div>
          ) : (
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={batchId ?? ""}
              onChange={(e) => setBatchId(Number(e.target.value))}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <div>
            <Button onClick={begin} disabled={raterId === null || batchId === null}>
              <Play className="size-4" /> Start blind session
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
