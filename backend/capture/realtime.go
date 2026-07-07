package capture

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"
)

// RTProbeResult é o retorno do "probe" do sidecar de tempo real.
type RTProbeResult struct {
	OK        bool   `json:"ok"`
	Available bool   `json:"available"`
	Device    string `json:"device"`
	Detail    string `json:"detail"`
	Error     string `json:"error,omitempty"`
}

// RTFrameResult é o retorno do "frame": overlay pronto + métricas.
type RTFrameResult struct {
	OK         bool    `json:"ok"`
	Overlay    string  `json:"overlay"` // base64 JPEG (overlay pronto p/ exibir)
	FatPercent float64 `json:"fatPercent"`
	FgFrac     float64 `json:"fgFrac"`
	MS         float64 `json:"ms"`
	Error      string  `json:"error,omitempty"`
}

// Realtime gerencia o sidecar de streaming (overlay de gordura ao vivo).
// Mantém um loop quente; cada frame vai/volta em ~pucos ms de transporte.
type Realtime struct {
	mu         sync.Mutex
	pythonBin  string
	scriptPath string
	modelDir   string
	cmd        *exec.Cmd
	stdin      *bufio.Writer
	stdout     *bufio.Reader
	started    bool
}

func NewRealtime(pythonBin, scriptPath, modelDir string) *Realtime {
	if pythonBin == "" {
		pythonBin = "python3"
	}
	return &Realtime{pythonBin: pythonBin, scriptPath: scriptPath, modelDir: modelDir}
}

func (r *Realtime) ScriptExists() bool {
	_, err := os.Stat(r.scriptPath)
	return err == nil
}

func (r *Realtime) ensureStarted() error {
	if r.started {
		return nil
	}
	if !r.ScriptExists() {
		return fmt.Errorf("realtime sidecar not found at %s", r.scriptPath)
	}
	cmd := exec.Command(r.pythonBin, r.scriptPath)
	cmd.Env = append(os.Environ(), "CARCASS_MODEL_DIR="+r.modelDir)
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
		return fmt.Errorf("start realtime sidecar: %w", err)
	}
	r.cmd = cmd
	// buffers grandes: um frame base64 pode ter centenas de KB
	r.stdin = bufio.NewWriterSize(stdin, 1<<20)
	r.stdout = bufio.NewReaderSize(stdout, 1<<22)
	r.started = true
	return nil
}

func (r *Realtime) roundtrip(cmd map[string]interface{}, out interface{}, timeout time.Duration) error {
	if err := r.ensureStarted(); err != nil {
		return err
	}
	payload, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	if _, err := r.stdin.Write(append(payload, '\n')); err != nil {
		return err
	}
	if err := r.stdin.Flush(); err != nil {
		return err
	}

	type res struct {
		line []byte
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		line, err := r.stdout.ReadBytes('\n')
		ch <- res{line, err}
	}()
	select {
	case rr := <-ch:
		if rr.err != nil {
			return fmt.Errorf("read response: %w", rr.err)
		}
		return json.Unmarshal(rr.line, out)
	case <-time.After(timeout):
		return fmt.Errorf("frame timeout")
	}
}

// Probe verifica se o motor de tempo real está pronto (carrega o modelo).
func (r *Realtime) Probe() RTProbeResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	var pr RTProbeResult
	if err := r.roundtrip(map[string]interface{}{"cmd": "probe"}, &pr, 60*time.Second); err != nil {
		return RTProbeResult{OK: false, Detail: err.Error(), Error: err.Error()}
	}
	return pr
}

// SetBackground captura o fundo vazio (base64 JPEG) para subtração.
func (r *Realtime) SetBackground(jpegB64 string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out map[string]interface{}
	return r.roundtrip(map[string]interface{}{"cmd": "bg", "jpeg": jpegB64}, &out, 15*time.Second)
}

// Frame processa um frame e devolve o overlay + métricas.
func (r *Realtime) Frame(jpegB64 string, size int) RTFrameResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	var fr RTFrameResult
	cmd := map[string]interface{}{"cmd": "frame", "jpeg": jpegB64, "size": size}
	if err := r.roundtrip(cmd, &fr, 10*time.Second); err != nil {
		return RTFrameResult{OK: false, Error: err.Error()}
	}
	return fr
}

func (r *Realtime) Shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.started {
		return
	}
	var out map[string]interface{}
	_ = r.roundtrip(map[string]interface{}{"cmd": "shutdown"}, &out, 3*time.Second)
	if r.cmd != nil && r.cmd.Process != nil {
		_ = r.cmd.Process.Kill()
	}
	r.started = false
}
