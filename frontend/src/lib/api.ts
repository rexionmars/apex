// Wrapper tipado do bridge Wails (Go -> JS). Espelha os métodos do App struct.
// Em `wails dev`/`build`, window.go.main.App é injetado pelo runtime. Estes tipos
// dão segurança de tipo no frontend sem depender do código gerado.

export interface Batch {
  id: number;
  name: string;
  location: string;
  operator: string;
  notes: string;
  collectedAt: string;
  createdAt: string;
}

export interface Carcass {
  id: number;
  batchId: number;
  physicalTag: string;
  animalId: string;
  treatment: string;
  species: string;
  stratum: string;
  fatThicknessMm: number | null;
  grMeasureMm: number | null;
  loinEyeAreaCm2: number | null;
  dissectionNotes: string;
  notes: string;
  createdAt: string;
  imageCount: number;
}

export interface Image {
  id: number;
  carcassId: number;
  rgbPath: string;
  depthPath: string;
  source: string;
  view: string;
  width: number;
  height: number;
  sha256: string;
  importedFrom: string;
  metaJson: string;
  capturedAt: string;
}

export interface CapturedImage {
  carcassId: number;
  source: string;
  view: string;
  width: number;
  height: number;
  dataBase64: string;
  ext: string;
}

export interface ScannedFile {
  path: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  duplicate: boolean;
  ext: string;
}

export interface Rater {
  id: number;
  name: string;
  role: string;
  createdAt: string;
}

export interface GradingSession {
  id: number;
  raterId: number;
  blind: boolean;
  startedAt: string;
}

export interface Grade {
  id: number;
  sessionId: number;
  carcassId: number;
  conformation: string;
  finishing: string;
  confidence: number;
  gradedAt: string;
}

export interface AxisAgreement {
  kappa: number;
  kappaLabel: string;
  kappaComputable: boolean;
  percentAgreement: number;
  itemsEvaluated: number;
}

export interface ConsensusRow {
  carcassId: number;
  physicalTag: string;
  raterCount: number;
  conformationConsensus: string;
  conformationTie: boolean;
  finishingConsensus: string;
  finishingTie: boolean;
}

export interface AgreementReport {
  conformation: AxisAgreement;
  finishing: AxisAgreement;
  rows: ConsensusRow[];
}

export interface BatchProgress {
  batchId: number;
  batchName: string;
  carcassCount: number;
  imageCount: number;
  gradedCount: number;
  byStratum: { stratum: string; count: number }[];
}

export interface UnpairedInfo {
  totalImages: number;
  unpaired: number;
}

export interface ImportBatchResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface ExportResult {
  dir: string;
  manifestPath: string;
  reportPath: string;
  carcassesExported: number;
  imagesExported: number;
}

export interface KinectProbe {
  ok: boolean;
  backend: string; // kinect_v2 | kinect_v1 | none
  available: boolean;
  detail: string;
  error?: string;
}

export interface GlobalStats {
  batches: number;
  carcasses: number;
  images: number;
  graded: number;
}

export interface Analysis {
  id: number;
  imageId: number;
  carcassId: number;
  fatPercent: number;
  backgroundRemoved: boolean;
  foregroundFrac: number;
  finishingClass: string;
  finishingProbs: string;
  egValue: number | null;
  overlayPath: string;
  carcassPath: string;
  gradeExperimental: boolean;
  convPerna: number | null;
  convLombo: number | null;
  convPaleta: number | null;
  conformationIndex: number | null;
  conformationGrade: string;
  conformationConf: number | null;
  conformationMap: string;
  analyzedAt: string;
  physicalTag: string;
  stratum: string;
  treatment: string;
  fatThicknessMm: number | null;
  grMeasureMm: number | null;
  loinEyeAreaCm2: number | null;
}

export interface AnalysisRow extends Analysis {
  overlayUrl: string;
  conformationUrl: string;
}

export interface CarcassGradeRow {
  carcassId: number;
  physicalTag: string;
  raterCount: number;
  conformation: Record<string, number>;
  finishing: Record<string, number>;
}

export interface RTProbe {
  ok: boolean;
  available: boolean;
  device: string;
  detail: string;
  error?: string;
}

export interface RTFrame {
  ok: boolean;
  overlay: string; // base64 JPEG (sem prefixo)
  fatPercent: number;
  fgFrac: number;
  ms: number;
  error?: string;
}

export interface InferenceProbe {
  ok: boolean;
  available: boolean;
  device: string; // cpu | mps | cuda
  models: { fat?: boolean; finishing?: boolean; eg?: boolean };
  detail: string;
  error?: string;
}

export interface ConformResult {
  ok: boolean;
  mapPath: string;
  convPerna: number;
  convLombo: number;
  convPaleta: number;
  conformationIndex: number;
  gradeEstimate: string;
  gradeConfidence: number;
  error?: string;
}

export interface AnalysisResult {
  ok: boolean;
  imageId: number;
  fatPercent: number;
  maskPath: string;
  overlayPath: string;
  carcassPath: string;
  overlayUrl: string;
  maskUrl: string;
  carcassUrl: string;
  backgroundRemoved: boolean;
  foregroundFrac: number;
  gradeExperimental: boolean;
  finishingClass: string;
  finishingProbs: Record<string, number>;
  egValue: number;
  conformation?: ConformResult | null;
  conformationUrl: string;
  error?: string;
}

// Formato da ponte gerada pelo Wails.
type GoApp = {
  CreateBatch(b: Partial<Batch>): Promise<Batch>;
  ListBatches(): Promise<Batch[]>;
  CreateCarcass(c: Partial<Carcass>): Promise<Carcass>;
  UpdateCarcass(c: Carcass): Promise<Carcass>;
  ListCarcasses(batchId: number): Promise<Carcass[]>;
  SaveCapturedImage(cap: CapturedImage): Promise<Image>;
  ListImages(carcassId: number): Promise<Image[]>;
  ImageDataURL(relPath: string): Promise<string>;
  ChooseDirectory(): Promise<string>;
  ScanImportDir(dir: string): Promise<ScannedFile[]>;
  ImportImage(carcassId: number, srcPath: string, view: string): Promise<Image>;
  ImportImageAsNewCarcass(batchId: number, srcPath: string): Promise<Carcass>;
  ImportAllAsNewCarcasses(batchId: number, srcPaths: string[]): Promise<ImportBatchResult>;
  DataDir(): Promise<string>;
  CreateRater(r: Partial<Rater>): Promise<Rater>;
  ListRaters(): Promise<Rater[]>;
  StartSession(raterId: number): Promise<GradingSession>;
  SaveGrade(g: Partial<Grade>): Promise<Grade>;
  GradesForSession(sessionId: number): Promise<Record<number, Grade>>;
  ComputeAgreement(batchId: number): Promise<AgreementReport>;
  BatchProgressReport(): Promise<BatchProgress[]>;
  UnpairedReport(): Promise<UnpairedInfo>;
  ExportDataset(batchId: number, onlyWithConsensus: boolean): Promise<ExportResult>;
  KinectProbe(): Promise<KinectProbe>;
  CaptureKinect(carcassId: number, view: string): Promise<Image>;
  OpenExternal(url: string): Promise<void>;
  GlobalStats(): Promise<GlobalStats>;
  InferenceProbe(): Promise<InferenceProbe>;
  RunInference(imageId: number, runGrade: boolean): Promise<AnalysisResult>;
  AnalyzeBatch(batchId: number, runGrade: boolean, reanalyze: boolean): Promise<number>;
  ListAnalyses(batchId: number): Promise<AnalysisRow[]>;
  ListCarcassGrades(batchId: number): Promise<CarcassGradeRow[]>;
  CountToAnalyze(batchId: number): Promise<number>;
  RTProbe(): Promise<RTProbe>;
  RTSetBackground(jpegB64: string): Promise<void>;
  RTFrame(jpegB64: string, size: number): Promise<RTFrame>;
};

declare global {
  interface Window {
    go?: { main?: { App?: GoApp } };
  }
}

function app(): GoApp {
  const a = window.go?.main?.App;
  if (!a) {
    throw new Error(
      "Bridge Wails indisponível. Rode via `wails dev` ou o binário compilado (não no navegador puro)."
    );
  }
  return a;
}

export const api = {
  createBatch: (b: Partial<Batch>) => app().CreateBatch(b),
  listBatches: () => app().ListBatches(),
  createCarcass: (c: Partial<Carcass>) => app().CreateCarcass(c),
  updateCarcass: (c: Carcass) => app().UpdateCarcass(c),
  listCarcasses: (batchId: number) => app().ListCarcasses(batchId),
  saveCapturedImage: (cap: CapturedImage) => app().SaveCapturedImage(cap),
  listImages: (carcassId: number) => app().ListImages(carcassId),
  imageDataURL: (relPath: string) => app().ImageDataURL(relPath),
  chooseDirectory: () => app().ChooseDirectory(),
  scanImportDir: (dir: string) => app().ScanImportDir(dir),
  importImage: (carcassId: number, srcPath: string, view: string) =>
    app().ImportImage(carcassId, srcPath, view),
  importImageAsNewCarcass: (batchId: number, srcPath: string) =>
    app().ImportImageAsNewCarcass(batchId, srcPath),
  importAllAsNewCarcasses: (batchId: number, srcPaths: string[]) =>
    app().ImportAllAsNewCarcasses(batchId, srcPaths),
  dataDir: () => app().DataDir(),

  createRater: (r: Partial<Rater>) => app().CreateRater(r),
  listRaters: () => app().ListRaters(),
  startSession: (raterId: number) => app().StartSession(raterId),
  saveGrade: (g: Partial<Grade>) => app().SaveGrade(g),
  gradesForSession: (sessionId: number) => app().GradesForSession(sessionId),
  computeAgreement: (batchId: number) => app().ComputeAgreement(batchId),
  batchProgressReport: () => app().BatchProgressReport(),
  unpairedReport: () => app().UnpairedReport(),
  exportDataset: (batchId: number, onlyWithConsensus: boolean) =>
    app().ExportDataset(batchId, onlyWithConsensus),
  kinectProbe: () => app().KinectProbe(),
  captureKinect: (carcassId: number, view: string) => app().CaptureKinect(carcassId, view),
  openExternal: (url: string) => app().OpenExternal(url),
  globalStats: () => app().GlobalStats(),
  inferenceProbe: () => app().InferenceProbe(),
  runInference: (imageId: number, runGrade: boolean) => app().RunInference(imageId, runGrade),
  analyzeBatch: (batchId: number, runGrade: boolean, reanalyze: boolean) =>
    app().AnalyzeBatch(batchId, runGrade, reanalyze),
  listAnalyses: (batchId: number) => app().ListAnalyses(batchId),
  listCarcassGrades: (batchId: number) => app().ListCarcassGrades(batchId),
  countToAnalyze: (batchId: number) => app().CountToAnalyze(batchId),
  rtProbe: () => app().RTProbe(),
  rtSetBackground: (jpegB64: string) => app().RTSetBackground(jpegB64),
  rtFrame: (jpegB64: string, size: number) => app().RTFrame(jpegB64, size),

  // true quando rodando dentro do WebView Wails (com bridge).
  isBridged: () => !!window.go?.main?.App,
};
