package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"carcass_integration/backend/capture"
	"carcass_integration/backend/export"
	"carcass_integration/backend/grading"
	"carcass_integration/backend/importer"
	"carcass_integration/backend/store"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// O script do sidecar é embarcado no binário e extraído para o data dir em runtime,
// para funcionar tanto em `wails dev` quanto no app empacotado.
//
//go:embed sidecar/kinect_capture.py
var kinectSidecarPy string

//go:embed sidecar/inference.py
var inferenceSidecarPy string

//go:embed sidecar/realtime.py
var realtimeSidecarPy string

//go:embed sidecar/conformation.py
var conformationSidecarPy string

// App é o struct exposto ao frontend via o bridge Wails. Cada método público
// vira uma função async tipada em window.go.main.App no React.
type App struct {
	ctx       context.Context
	store     *store.Store
	files     *store.FileStore
	root      string
	kinect       *capture.Kinect
	inference    *capture.Inference
	realtime     *capture.Realtime
	conformation *capture.Conformation
}

func NewApp() *App {
	return &App{}
}

// startup roda quando a janela sobe. Abre o banco no diretório de dados do usuário.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	root, err := dataDir()
	if err != nil {
		runtime.LogErrorf(ctx, "resolver diretório de dados: %v", err)
		return
	}
	a.root = root

	fs, err := store.NewFileStore(root)
	if err != nil {
		runtime.LogErrorf(ctx, "file store: %v", err)
		return
	}
	a.files = fs

	st, err := store.Open(filepath.Join(root, "carcass.db"))
	if err != nil {
		runtime.LogErrorf(ctx, "abrir banco: %v", err)
		return
	}
	a.store = st
	runtime.LogInfof(ctx, "banco aberto em %s", filepath.Join(root, "carcass.db"))

	// Extrai o sidecar Kinect embarcado para o data dir e prepara o gerenciador.
	scriptPath := filepath.Join(root, "kinect_capture.py")
	if err := os.WriteFile(scriptPath, []byte(kinectSidecarPy), 0o644); err != nil {
		runtime.LogErrorf(ctx, "extrair sidecar: %v", err)
	}
	a.kinect = capture.NewKinect(pythonBin(), scriptPath)

	// Extrai o sidecar de inferência e localiza os pesos dos modelos.
	inferScript := filepath.Join(root, "inference.py")
	if err := os.WriteFile(inferScript, []byte(inferenceSidecarPy), 0o644); err != nil {
		runtime.LogErrorf(ctx, "extrair sidecar de inferência: %v", err)
	}
	a.inference = capture.NewInference(pythonBin(), inferScript, modelWeightsDir())
	runtime.LogInfof(ctx, "pesos de modelo em %s", modelWeightsDir())

	// Sidecar de tempo real (overlay ao vivo).
	rtScript := filepath.Join(root, "realtime.py")
	if err := os.WriteFile(rtScript, []byte(realtimeSidecarPy), 0o644); err != nil {
		runtime.LogErrorf(ctx, "extrair sidecar de tempo real: %v", err)
	}
	a.realtime = capture.NewRealtime(pythonBin(), rtScript, modelWeightsDir())

	// Sidecar de conformação (convexidade integral — analítico, sem pesos).
	confScript := filepath.Join(root, "conformation.py")
	if err := os.WriteFile(confScript, []byte(conformationSidecarPy), 0o644); err != nil {
		runtime.LogErrorf(ctx, "extrair sidecar de conformação: %v", err)
	}
	a.conformation = capture.NewConformation(pythonBin(), confScript)
}

// modelWeightsDir localiza a pasta model/weights (dev ou empacotado).
// Override por CARCASS_MODEL_DIR.
func modelWeightsDir() string {
	if d := os.Getenv("CARCASS_MODEL_DIR"); d != "" {
		return d
	}
	candidates := []string{}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		// .app/Contents/MacOS/bin -> .app/Contents/Resources/model/weights
		candidates = append(candidates,
			filepath.Join(dir, "..", "Resources", "model", "weights"),
			filepath.Join(dir, "model", "weights"),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "model", "weights"))
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "fat_binary.pth")); err == nil {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	// fallback: primeiro candidato (mesmo que não exista ainda)
	if len(candidates) > 0 {
		abs, _ := filepath.Abs(candidates[len(candidates)-1])
		return abs
	}
	return "model/weights"
}

func (a *App) shutdown(ctx context.Context) {
	if a.kinect != nil {
		a.kinect.Shutdown()
	}
	if a.inference != nil {
		a.inference.Shutdown()
	}
	if a.realtime != nil {
		a.realtime.Shutdown()
	}
	if a.conformation != nil {
		a.conformation.Shutdown()
	}
	if a.store != nil {
		a.store.Close()
	}
}

// pythonBin resolve o interpretador Python (respeita CARCASS_PYTHON se definido).
func pythonBin() string {
	if p := os.Getenv("CARCASS_PYTHON"); p != "" {
		return p
	}
	return "python3"
}

// dataDir devolve <userConfigDir>/carcass-integration, criando-o.
func dataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "carcass-integration")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func (a *App) ready() error {
	if a.store == nil {
		return fmt.Errorf("database not initialized")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Métodos expostos: Batches
// ---------------------------------------------------------------------------

func (a *App) CreateBatch(b store.Batch) (store.Batch, error) {
	if err := a.ready(); err != nil {
		return store.Batch{}, err
	}
	return a.store.CreateBatch(b)
}

func (a *App) ListBatches() ([]store.Batch, error) {
	if err := a.ready(); err != nil {
		return []store.Batch{}, err
	}
	return a.store.ListBatches()
}

// ---------------------------------------------------------------------------
// Métodos expostos: Carcasses
// ---------------------------------------------------------------------------

func (a *App) CreateCarcass(c store.Carcass) (store.Carcass, error) {
	if err := a.ready(); err != nil {
		return store.Carcass{}, err
	}
	return a.store.CreateCarcass(c)
}

func (a *App) UpdateCarcass(c store.Carcass) (store.Carcass, error) {
	if err := a.ready(); err != nil {
		return store.Carcass{}, err
	}
	return a.store.UpdateCarcass(c)
}

func (a *App) ListCarcasses(batchID int64) ([]store.Carcass, error) {
	if err := a.ready(); err != nil {
		return []store.Carcass{}, err
	}
	return a.store.ListCarcasses(batchID)
}

// ---------------------------------------------------------------------------
// Métodos expostos: Imagens (captura webcam)
// ---------------------------------------------------------------------------

// CapturedImage é o payload que o frontend envia após capturar via getUserMedia.
type CapturedImage struct {
	CarcassID int64  `json:"carcassId"`
	Source    string `json:"source"` // 'webcam'
	View      string `json:"view"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	// DataBase64 é a imagem JPEG/PNG em base64 (sem o prefixo data:).
	DataBase64 string `json:"dataBase64"`
	Ext        string `json:"ext"` // '.jpg' | '.png'
}

// SaveCapturedImage grava uma imagem capturada, já pareada à carcaça. Todo o
// pareamento acontece aqui, no servidor — o frontend nunca inventa vínculo.
func (a *App) SaveCapturedImage(cap CapturedImage) (store.Image, error) {
	if err := a.ready(); err != nil {
		return store.Image{}, err
	}
	if cap.CarcassID == 0 {
		return store.Image{}, fmt.Errorf("carcass_id is required")
	}
	c, err := a.store.GetCarcass(cap.CarcassID)
	if err != nil {
		return store.Image{}, fmt.Errorf("carcass not found: %w", err)
	}

	data, err := decodeBase64Image(cap.DataBase64)
	if err != nil {
		return store.Image{}, err
	}

	rel, sha, err := a.files.SaveBytes(c.BatchID, c.PhysicalTag, data, cap.Ext)
	if err != nil {
		return store.Image{}, err
	}

	source := cap.Source
	if source == "" {
		source = "webcam"
	}
	return a.store.AddImage(store.Image{
		CarcassID:  cap.CarcassID,
		RGBPath:    rel,
		Source:     source,
		View:       cap.View,
		Width:      cap.Width,
		Height:     cap.Height,
		SHA256:     sha,
		CapturedAt: "",
	})
}

func (a *App) ListImages(carcassID int64) ([]store.Image, error) {
	if err := a.ready(); err != nil {
		return []store.Image{}, err
	}
	return a.store.ListImages(carcassID)
}

// ImageDataURL lê uma imagem do disco e devolve como data URL para exibição no WebView.
func (a *App) ImageDataURL(relPath string) (string, error) {
	if a.files == nil {
		return "", fmt.Errorf("file store not initialized")
	}
	return readAsDataURL(filepath.Join(a.files.Root(), relPath))
}

// ---------------------------------------------------------------------------
// Métodos expostos: Import de diretórios externos
// ---------------------------------------------------------------------------

// ChooseDirectory abre o seletor nativo de pastas.
func (a *App) ChooseDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Escolher pasta de imagens para importar",
	})
}

// ScanImportDir varre um diretório e devolve as imagens (marcando duplicatas).
func (a *App) ScanImportDir(dir string) ([]importer.ScannedFile, error) {
	if err := a.ready(); err != nil {
		return []importer.ScannedFile{}, err
	}
	if dir == "" {
		return []importer.ScannedFile{}, fmt.Errorf("empty directory")
	}
	return importer.ScanDir(dir, a.store)
}

// ImportImage copia UMA imagem externa para uma carcaça (conciliação). Sem
// carcassID, não há import — é a garantia de pareamento.
func (a *App) ImportImage(carcassID int64, srcPath, view string) (store.Image, error) {
	if err := a.ready(); err != nil {
		return store.Image{}, err
	}
	if carcassID == 0 {
		return store.Image{}, fmt.Errorf("select the target carcass")
	}
	c, err := a.store.GetCarcass(carcassID)
	if err != nil {
		return store.Image{}, fmt.Errorf("carcass not found: %w", err)
	}
	rel, sha, err := a.files.CopyFile(c.BatchID, c.PhysicalTag, srcPath)
	if err != nil {
		return store.Image{}, err
	}
	exists, _ := a.store.SHA256Exists(sha)
	if exists {
		// arquivo idêntico já pareado; remove a cópia órfã que acabamos de fazer
		os.Remove(filepath.Join(a.files.Root(), rel))
		return store.Image{}, fmt.Errorf("identical image already in dataset (dedup)")
	}
	return a.store.AddImage(store.Image{
		CarcassID:    carcassID,
		RGBPath:      rel,
		Source:       "import",
		View:         view,
		SHA256:       sha,
		ImportedFrom: srcPath,
	})
}

// DataDir devolve o diretório onde ficam banco e imagens (para a UI mostrar).
func (a *App) DataDir() string { return a.root }

// tagFromFilename deriva uma etiqueta a partir do nome do arquivo (sem extensão).
func tagFromFilename(p string) string {
	base := filepath.Base(p)
	ext := filepath.Ext(base)
	return base[:len(base)-len(ext)]
}

// ImportImageAsNewCarcass cria UMA carcaça nova (etiqueta = nome do arquivo) e
// importa a imagem já pareada a ela. Não exige pré-cadastro — resolve o caso de
// quem já tem as fotos e vai preencher os dados depois (editável na aba Coleta).
func (a *App) ImportImageAsNewCarcass(batchID int64, srcPath string) (store.Carcass, error) {
	if err := a.ready(); err != nil {
		return store.Carcass{}, err
	}
	if batchID == 0 {
		return store.Carcass{}, fmt.Errorf("select the batch")
	}
	tag := tagFromFilename(srcPath)
	// evita colisão com UNIQUE(batch_id, physical_tag)
	c, err := a.store.CreateCarcassUniqueTag(store.Carcass{BatchID: batchID, PhysicalTag: tag})
	if err != nil {
		return store.Carcass{}, err
	}
	if _, err := a.ImportImage(c.ID, srcPath, ""); err != nil {
		return store.Carcass{}, err
	}
	return a.store.GetCarcass(c.ID)
}

// ImportBatchResult resume um import em lote.
type ImportBatchResult struct {
	Created  int      `json:"created"`
	Skipped  int      `json:"skipped"`
	Errors   []string `json:"errors"`
}

// ImportAllAsNewCarcasses importa vários arquivos, cada um como carcaça nova.
// Pula duplicatas (mesmo sha256 já no dataset).
func (a *App) ImportAllAsNewCarcasses(batchID int64, srcPaths []string) (ImportBatchResult, error) {
	res := ImportBatchResult{Errors: []string{}}
	if err := a.ready(); err != nil {
		return res, err
	}
	if batchID == 0 {
		return res, fmt.Errorf("select the batch")
	}
	for _, p := range srcPaths {
		if _, err := a.ImportImageAsNewCarcass(batchID, p); err != nil {
			res.Skipped++
			res.Errors = append(res.Errors, filepath.Base(p)+": "+err.Error())
			continue
		}
		res.Created++
	}
	return res, nil
}

// OpenExternal abre uma URL no navegador do sistema.
func (a *App) OpenExternal(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}

// GlobalStats é o resumo do dataset para o readout de telemetria da title bar.
type GlobalStats struct {
	Batches   int `json:"batches"`
	Carcasses int `json:"carcasses"`
	Images    int `json:"images"`
	Graded    int `json:"graded"`
}

func (a *App) GlobalStats() (GlobalStats, error) {
	var g GlobalStats
	if err := a.ready(); err != nil {
		return g, err
	}
	a.store.CountAll(&g.Batches, &g.Carcasses, &g.Images, &g.Graded)
	return g, nil
}

// ---------------------------------------------------------------------------
// Métodos expostos: Avaliação inter-avaliador (R2)
// ---------------------------------------------------------------------------

func (a *App) CreateRater(r store.Rater) (store.Rater, error) {
	if err := a.ready(); err != nil {
		return store.Rater{}, err
	}
	return a.store.CreateRater(r)
}

func (a *App) ListRaters() ([]store.Rater, error) {
	if err := a.ready(); err != nil {
		return []store.Rater{}, err
	}
	return a.store.ListRaters()
}

func (a *App) StartSession(raterID int64) (store.GradingSession, error) {
	if err := a.ready(); err != nil {
		return store.GradingSession{}, err
	}
	return a.store.StartSession(raterID, true) // sempre cega
}

func (a *App) SaveGrade(g store.Grade) (store.Grade, error) {
	if err := a.ready(); err != nil {
		return store.Grade{}, err
	}
	return a.store.UpsertGrade(g)
}

func (a *App) GradesForSession(sessionID int64) (map[int64]store.Grade, error) {
	if err := a.ready(); err != nil {
		return map[int64]store.Grade{}, err
	}
	return a.store.GradesForSession(sessionID)
}

// AxisAgreement resume a concordância de UM eixo.
type AxisAgreement struct {
	Kappa            float64 `json:"kappa"`
	KappaLabel       string  `json:"kappaLabel"`
	KappaComputable  bool    `json:"kappaComputable"`
	PercentAgreement float64 `json:"percentAgreement"`
	ItemsEvaluated   int     `json:"itemsEvaluated"` // carcaças com >=2 avaliadores
}

// ConsensusRow é o consenso por carcaça num eixo.
type ConsensusRow struct {
	CarcassID            int64  `json:"carcassId"`
	PhysicalTag          string `json:"physicalTag"`
	RaterCount           int    `json:"raterCount"`
	ConformationConsensus string `json:"conformationConsensus"`
	ConformationTie       bool   `json:"conformationTie"`
	FinishingConsensus    string `json:"finishingConsensus"`
	FinishingTie          bool   `json:"finishingTie"`
}

// AgreementReport é o relatório completo de concordância de um lote (ou todos se batchId=0).
type AgreementReport struct {
	Conformation AxisAgreement  `json:"conformation"`
	Finishing    AxisAgreement  `json:"finishing"`
	Rows         []ConsensusRow `json:"rows"`
}

// ComputeAgreement calcula κ de Fleiss, % de acordo e consenso para os dois eixos.
// Só entram na estatística de κ as carcaças com o mesmo nº de avaliadores (>=2).
func (a *App) ComputeAgreement(batchID int64) (AgreementReport, error) {
	rep := AgreementReport{Rows: []ConsensusRow{}}
	if err := a.ready(); err != nil {
		return rep, err
	}
	agg, err := a.store.GradesByCarcass(batchID)
	if err != nil {
		return rep, err
	}

	// Para o κ de Fleiss precisamos de n constante; usamos o nº de avaliadores mais comum.
	confVotes := []grading.CategoryVotes{}
	finVotes := []grading.CategoryVotes{}
	nMode := modeRaterCount(agg)

	for _, row := range agg {
		rep.Rows = append(rep.Rows, consensusRowFrom(row))
		if row.RaterCount >= 2 && row.RaterCount == nMode {
			confVotes = append(confVotes, grading.CategoryVotes(row.Conformation))
			finVotes = append(finVotes, grading.CategoryVotes(row.Finishing))
		}
	}

	rep.Conformation = axisAgreementFrom(confVotes)
	rep.Finishing = axisAgreementFrom(finVotes)
	return rep, nil
}

func modeRaterCount(rows []store.CarcassGradeRow) int {
	freq := map[int]int{}
	for _, r := range rows {
		if r.RaterCount >= 2 {
			freq[r.RaterCount]++
		}
	}
	best, mode := 0, 0
	for n, f := range freq {
		if f > best || (f == best && n > mode) {
			best, mode = f, n
		}
	}
	return mode
}

func consensusRowFrom(row store.CarcassGradeRow) ConsensusRow {
	cc, ct := grading.Consensus(row.Conformation)
	fc, ft := grading.Consensus(row.Finishing)
	return ConsensusRow{
		CarcassID: row.CarcassID, PhysicalTag: row.PhysicalTag, RaterCount: row.RaterCount,
		ConformationConsensus: cc, ConformationTie: ct,
		FinishingConsensus: fc, FinishingTie: ft,
	}
}

func axisAgreementFrom(votes []grading.CategoryVotes) AxisAgreement {
	k, ok := grading.FleissKappa(votes)
	pa, _ := grading.PercentAgreement(votes)
	label := ""
	if ok {
		label = grading.InterpretKappa(k)
	}
	return AxisAgreement{
		Kappa: k, KappaLabel: label, KappaComputable: ok,
		PercentAgreement: pa, ItemsEvaluated: len(votes),
	}
}

// ---------------------------------------------------------------------------
// Métodos expostos: Dashboard e Export (R3/R4)
// ---------------------------------------------------------------------------

func (a *App) BatchProgressReport() ([]store.BatchProgress, error) {
	if err := a.ready(); err != nil {
		return []store.BatchProgress{}, err
	}
	return a.store.BatchProgressReport()
}

func (a *App) UnpairedReport() (store.UnpairedInfo, error) {
	if err := a.ready(); err != nil {
		return store.UnpairedInfo{}, err
	}
	return a.store.UnpairedReport()
}

// ExportDataset gera manifesto + relatório de integridade num diretório escolhido.
func (a *App) ExportDataset(batchID int64, onlyWithConsensus bool) (export.Result, error) {
	if err := a.ready(); err != nil {
		return export.Result{}, err
	}

	outParent, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Escolher pasta de destino do dataset",
	})
	if err != nil {
		return export.Result{}, err
	}
	if outParent == "" {
		return export.Result{}, fmt.Errorf("export canceled")
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	outDir := filepath.Join(outParent, "carcass_dataset_"+stamp)

	rows, err := a.store.ExportRows(batchID)
	if err != nil {
		return export.Result{}, err
	}

	// consenso por carcaça
	agg, err := a.store.GradesByCarcass(batchID)
	if err != nil {
		return export.Result{}, err
	}
	cons := map[int64]export.Consensus{}
	for _, r := range agg {
		cc, ct := grading.Consensus(r.Conformation)
		fc, ft := grading.Consensus(r.Finishing)
		cons[r.CarcassID] = export.Consensus{
			Conformation: cc, ConfTie: ct, Finishing: fc, FinTie: ft, RaterCount: r.RaterCount,
		}
	}

	res, err := export.WriteManifest(outDir, rows, cons, onlyWithConsensus)
	if err != nil {
		return export.Result{}, err
	}

	rep, _ := a.ComputeAgreement(batchID)
	unpaired, _ := a.store.UnpairedReport()
	reportPath, err := export.WriteReport(outDir, res, unpaired,
		rep.Conformation.KappaLabel, rep.Finishing.KappaLabel,
		rep.Conformation.Kappa, rep.Finishing.Kappa,
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return export.Result{}, err
	}
	res.ReportPath = reportPath

	runtime.LogInfof(a.ctx, "dataset exportado em %s (%d imagens)", outDir, res.ImagesExported)
	return res, nil
}

// ---------------------------------------------------------------------------
// Métodos expostos: Kinect (Fase 2 — RGB + depth via sidecar Python)
// ---------------------------------------------------------------------------

// KinectProbe pergunta ao sidecar qual backend Kinect está disponível.
func (a *App) KinectProbe() capture.ProbeResult {
	if a.kinect == nil {
		return capture.ProbeResult{OK: false, Backend: "none", Detail: "kinect not initialized"}
	}
	return a.kinect.Probe()
}

// CaptureKinect dispara uma captura RGB+depth pareada a uma carcaça.
func (a *App) CaptureKinect(carcassID int64, view string) (store.Image, error) {
	if err := a.ready(); err != nil {
		return store.Image{}, err
	}
	if a.kinect == nil {
		return store.Image{}, fmt.Errorf("kinect not initialized")
	}
	c, err := a.store.GetCarcass(carcassID)
	if err != nil {
		return store.Image{}, fmt.Errorf("carcass not found: %w", err)
	}

	// grava direto na pasta pareada da carcaça
	outDir := filepath.Join(a.files.Root(), "images",
		fmt.Sprintf("batch_%d", c.BatchID), "carcass_"+store.SanitizeTag(c.PhysicalTag))
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return store.Image{}, err
	}
	prefix := "kinect_" + time.Now().UTC().Format("20060102-150405")

	cr := a.kinect.Capture(outDir, prefix)
	if !cr.OK {
		return store.Image{}, fmt.Errorf("Kinect capture failed: %s", cr.Error)
	}

	// caminhos relativos ao root para portabilidade
	rgbRel, _ := filepath.Rel(a.files.Root(), cr.RGBPath)
	depthRel, _ := filepath.Rel(a.files.Root(), cr.DepthPath)
	sha, err := store.HashFile(cr.RGBPath)
	if err != nil {
		return store.Image{}, err
	}

	probe := a.kinect.Probe()
	return a.store.AddImage(store.Image{
		CarcassID:  carcassID,
		RGBPath:    rgbRel,
		DepthPath:  depthRel,
		Source:     probe.Backend, // kinect_v1 | kinect_v2
		View:       view,
		Width:      cr.Width,
		Height:     cr.Height,
		SHA256:     sha,
		CapturedAt: "",
	})
}

// ---------------------------------------------------------------------------
// Métodos expostos: Inferência (modelos treinados na pesquisa)
// ---------------------------------------------------------------------------

// InferenceProbe verifica se o sidecar de inferência sobe e os modelos carregam.
func (a *App) InferenceProbe() capture.InferenceProbe {
	if a.inference == nil {
		return capture.InferenceProbe{OK: false, Detail: "inference not initialized"}
	}
	return a.inference.Probe()
}

// AnalysisResult acrescenta os caminhos de saída como data URLs para a UI exibir.
type AnalysisResult struct {
	capture.InferenceResult
	ImageID    int64  `json:"imageId"`
	OverlayURL string `json:"overlayUrl"`
	MaskURL    string `json:"maskUrl"`
	CarcassURL string `json:"carcassUrl"`
	// Conformação (convexidade integral)
	Conformation    *capture.ConformResult `json:"conformation"`
	ConformationURL string                 `json:"conformationUrl"`
}

// RunInference roda os modelos numa imagem já pareada (imageID) e devolve
// máscara de gordura, % de gordura e (se runGrade) o grau experimental.
func (a *App) RunInference(imageID int64, runGrade bool) (AnalysisResult, error) {
	var out AnalysisResult
	if err := a.ready(); err != nil {
		return out, err
	}
	if a.inference == nil {
		return out, fmt.Errorf("inference not initialized")
	}

	img, err := a.store.GetImage(imageID)
	if err != nil {
		return out, fmt.Errorf("image not found: %w", err)
	}
	absImage := filepath.Join(a.files.Root(), img.RGBPath)

	// salva as saídas junto da imagem, numa subpasta analysis/
	outDir := filepath.Join(filepath.Dir(absImage), "analysis")
	prefix := fmt.Sprintf("img%d", imageID)

	res := a.inference.Infer(absImage, outDir, prefix, runGrade)
	if !res.OK {
		return out, fmt.Errorf("inference failed: %s", res.Error)
	}
	out.InferenceResult = res
	out.ImageID = imageID

	if res.OverlayPath != "" {
		if url, err := readAsDataURL(res.OverlayPath); err == nil {
			out.OverlayURL = url
		}
	}
	if res.MaskPath != "" {
		if url, err := readAsDataURL(res.MaskPath); err == nil {
			out.MaskURL = url
		}
	}
	if res.CarcassPath != "" {
		if url, err := readAsDataURL(res.CarcassPath); err == nil {
			out.CarcassURL = url
		}
	}

	// Conformação: roda sobre a carcaça recortada (fundo preto) que a inferência
	// já produziu. Só faz sentido se o fundo foi removido (silhueta limpa).
	var conf *capture.ConformResult
	if a.conformation != nil && res.CarcassPath != "" && res.BackgroundRemoved {
		cr := a.conformation.Conform(res.CarcassPath, outDir, prefix)
		if cr.OK {
			conf = &cr
			out.Conformation = &cr
			if cr.MapPath != "" {
				if url, err := readAsDataURL(cr.MapPath); err == nil {
					out.ConformationURL = url
				}
			}
		} else {
			runtime.LogErrorf(a.ctx, "conformação img %d falhou: %s", imageID, cr.Error)
		}
	}

	// persiste o resultado (para tabela/estatística e para não reanalisar)
	a.persistAnalysis(imageID, img.CarcassID, res, conf)

	runtime.LogInfof(a.ctx, "inferência img %d: %.1f%% gordura (fundo removido: %v)",
		imageID, res.FatPercent, res.BackgroundRemoved)
	return out, nil
}

func (a *App) persistAnalysis(imageID, carcassID int64, res capture.InferenceResult, conf *capture.ConformResult) {
	probsJSON := ""
	if len(res.FinishingProbs) > 0 {
		if b, err := json.Marshal(res.FinishingProbs); err == nil {
			probsJSON = string(b)
		}
	}
	var eg *float64
	if res.GradeExperimental {
		v := res.EGValue
		eg = &v
	}
	relOverlay, _ := filepath.Rel(a.files.Root(), res.OverlayPath)
	relCarcass, _ := filepath.Rel(a.files.Root(), res.CarcassPath)

	rec := store.Analysis{
		ImageID:           imageID,
		CarcassID:         carcassID,
		FatPercent:        res.FatPercent,
		BackgroundRemoved: res.BackgroundRemoved,
		ForegroundFrac:    res.ForegroundFrac,
		FinishingClass:    res.FinishingClass,
		FinishingProbs:    probsJSON,
		EGValue:           eg,
		OverlayPath:       relOverlay,
		CarcassPath:       relCarcass,
		GradeExperimental: res.GradeExperimental,
	}
	if conf != nil {
		cp, cl, cpa, ci, cc := conf.ConvPerna, conf.ConvLombo, conf.ConvPaleta, conf.ConformationIndex, conf.GradeConfidence
		rec.ConvPerna = &cp
		rec.ConvLombo = &cl
		rec.ConvPaleta = &cpa
		rec.ConformationIndex = &ci
		rec.ConformationConf = &cc
		rec.ConformationGrade = conf.GradeEstimate
		if conf.MapPath != "" {
			rel, _ := filepath.Rel(a.files.Root(), conf.MapPath)
			rec.ConformationMap = rel
		}
	}
	a.store.UpsertAnalysis(rec)
}

// AnalyzeBatch roda a inferência em todas as imagens de um lote, emitindo
// progresso. Se reanalyze=false, pula as que já têm análise.
func (a *App) AnalyzeBatch(batchID int64, runGrade, reanalyze bool) (int, error) {
	if err := a.ready(); err != nil {
		return 0, err
	}
	if a.inference == nil {
		return 0, fmt.Errorf("inference not initialized")
	}
	var ids []int64
	var err error
	if reanalyze {
		ids, err = a.store.AllImagesOfBatch(batchID)
	} else {
		ids, err = a.store.ImagesToAnalyze(batchID)
	}
	if err != nil {
		return 0, err
	}

	total := len(ids)
	done := 0
	for i, id := range ids {
		runtime.EventsEmit(a.ctx, "analyze:progress", map[string]interface{}{
			"current": i, "total": total, "imageId": id,
		})
		if _, err := a.RunInference(id, runGrade); err != nil {
			runtime.LogErrorf(a.ctx, "análise img %d falhou: %v", id, err)
			continue
		}
		done++
	}
	runtime.EventsEmit(a.ctx, "analyze:progress", map[string]interface{}{
		"current": total, "total": total, "done": true,
	})
	return done, nil
}

// AnalysisRow é uma linha de análise com a URL do overlay para a galeria.
type AnalysisRow struct {
	store.Analysis
	OverlayURL      string `json:"overlayUrl"`
	ConformationURL string `json:"conformationUrl"`
}

// ListAnalyses devolve as análises de um lote (0 = todos), com overlay em data URL.
func (a *App) ListAnalyses(batchID int64) ([]AnalysisRow, error) {
	if err := a.ready(); err != nil {
		return []AnalysisRow{}, err
	}
	items, err := a.store.ListAnalysesByBatch(batchID)
	if err != nil {
		return []AnalysisRow{}, err
	}
	out := make([]AnalysisRow, 0, len(items))
	for _, it := range items {
		row := AnalysisRow{Analysis: it}
		if it.OverlayPath != "" {
			if url, err := readAsDataURL(filepath.Join(a.files.Root(), it.OverlayPath)); err == nil {
				row.OverlayURL = url
			}
		}
		if it.ConformationMap != "" {
			if url, err := readAsDataURL(filepath.Join(a.files.Root(), it.ConformationMap)); err == nil {
				row.ConformationURL = url
			}
		}
		out = append(out, row)
	}
	return out, nil
}

// CountToAnalyze diz quantas imagens ainda não têm análise num lote.
func (a *App) CountToAnalyze(batchID int64) (int, error) {
	if err := a.ready(); err != nil {
		return 0, err
	}
	ids, err := a.store.ImagesToAnalyze(batchID)
	return len(ids), err
}

// ---------------------------------------------------------------------------
// Métodos expostos: Monitor ao vivo (overlay de gordura em tempo real)
// ---------------------------------------------------------------------------

func (a *App) RTProbe() capture.RTProbeResult {
	if a.realtime == nil {
		return capture.RTProbeResult{OK: false, Detail: "realtime not initialized"}
	}
	return a.realtime.Probe()
}

// RTSetBackground captura o fundo vazio (base64 JPEG cru, sem prefixo data:).
func (a *App) RTSetBackground(jpegB64 string) error {
	if a.realtime == nil {
		return fmt.Errorf("realtime not initialized")
	}
	return a.realtime.SetBackground(stripDataURL(jpegB64))
}

// RTFrame processa um frame e devolve o overlay (base64 JPEG) + métricas.
func (a *App) RTFrame(jpegB64 string, size int) capture.RTFrameResult {
	if a.realtime == nil {
		return capture.RTFrameResult{OK: false, Error: "realtime not initialized"}
	}
	if size <= 0 {
		size = 256
	}
	return a.realtime.Frame(stripDataURL(jpegB64), size)
}
