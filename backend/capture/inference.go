package capture

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// InferenceProbe é o retorno do "probe" do sidecar de inferência.
type InferenceProbe struct {
	OK        bool            `json:"ok"`
	Available bool            `json:"available"`
	Device    string          `json:"device"` // cpu | mps | cuda
	Models    map[string]bool `json:"models"` // fat, finishing, eg
	Detail    string          `json:"detail"`
	Error     string          `json:"error,omitempty"`
}

// InferenceResult é o retorno do "infer".
type InferenceResult struct {
	OK                bool               `json:"ok"`
	FatPercent        float64            `json:"fatPercent"`
	MaskPath          string             `json:"maskPath"`
	OverlayPath       string             `json:"overlayPath"`
	CarcassPath       string             `json:"carcassPath"`
	BackgroundRemoved bool               `json:"backgroundRemoved"`
	ForegroundFrac    float64            `json:"foregroundFrac"`
	GradeExperimental bool               `json:"gradeExperimental"`
	FinishingClass    string             `json:"finishingClass"`
	FinishingProbs    map[string]float64 `json:"finishingProbs"`
	EGValue           float64            `json:"egValue"`
	Error             string             `json:"error,omitempty"`
}

// Inference gerencia o sidecar Python de inferência (torch). Mesmo padrão de
// roundtrip JSON do Kinect. Requer Python com torch/opencv/scipy + os pesos.
type Inference struct {
	mu         sync.Mutex
	pythonBin  string
	scriptPath string
	modelDir   string
	cmd        *exec.Cmd
	stdin      *bufio.Writer
	stdout     *bufio.Reader
	started    bool
}

func NewInference(pythonBin, scriptPath, modelDir string) *Inference {
	if pythonBin == "" {
		pythonBin = "python3"
	}
	return &Inference{pythonBin: pythonBin, scriptPath: scriptPath, modelDir: modelDir}
}

func (i *Inference) ScriptExists() bool {
	_, err := os.Stat(i.scriptPath)
	return err == nil
}

func (i *Inference) ensureStarted() error {
	if i.started {
		return nil
	}
	if !i.ScriptExists() {
		return fmt.Errorf("inference sidecar not found at %s", i.scriptPath)
	}
	cmd := exec.Command(i.pythonBin, i.scriptPath)
	// passa o diretório dos pesos por variável de ambiente
	cmd.Env = append(os.Environ(), "CARCASS_MODEL_DIR="+i.modelDir)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start inference sidecar (%s with torch?): %w", i.pythonBin, err)
	}
	i.cmd = cmd
	i.stdin = bufio.NewWriter(stdin)
	i.stdout = bufio.NewReader(stdout)
	i.started = true
	return nil
}

func (i *Inference) roundtrip(cmd map[string]interface{}, out interface{}, timeout time.Duration) error {
	if err := i.ensureStarted(); err != nil {
		return err
	}
	payload, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	if _, err := i.stdin.Write(append(payload, '\n')); err != nil {
		return err
	}
	if err := i.stdin.Flush(); err != nil {
		return err
	}

	type res struct {
		line []byte
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		line, err := i.stdout.ReadBytes('\n')
		ch <- res{line, err}
	}()

	select {
	case r := <-ch:
		if r.err != nil {
			return fmt.Errorf("read sidecar response: %w", r.err)
		}
		return json.Unmarshal(r.line, out)
	case <-time.After(timeout):
		return fmt.Errorf("inference timeout")
	}
}

// Probe verifica se o sidecar sobe e os modelos carregam.
func (i *Inference) Probe() InferenceProbe {
	i.mu.Lock()
	defer i.mu.Unlock()
	var pr InferenceProbe
	// primeiro probe carrega os modelos (pode levar alguns segundos).
	if err := i.roundtrip(map[string]interface{}{"cmd": "probe"}, &pr, 60*time.Second); err != nil {
		return InferenceProbe{OK: false, Available: false, Detail: err.Error(), Error: err.Error()}
	}
	return pr
}

// Infer roda a inferência numa imagem, salvando máscara/overlay em outDir.
func (i *Inference) Infer(image, outDir, prefix string, runGrade bool) InferenceResult {
	i.mu.Lock()
	defer i.mu.Unlock()
	var ir InferenceResult
	cmd := map[string]interface{}{
		"cmd":      "infer",
		"image":    filepath.Clean(image),
		"outDir":   filepath.Clean(outDir),
		"prefix":   prefix,
		"runGrade": runGrade,
	}
	if err := i.roundtrip(cmd, &ir, 120*time.Second); err != nil {
		return InferenceResult{OK: false, Error: err.Error()}
	}
	return ir
}

func (i *Inference) Shutdown() {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !i.started {
		return
	}
	var out map[string]interface{}
	_ = i.roundtrip(map[string]interface{}{"cmd": "shutdown"}, &out, 5*time.Second)
	if i.cmd != nil && i.cmd.Process != nil {
		_ = i.cmd.Process.Kill()
	}
	i.started = false
}
