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

// ConformProbe é o retorno do "probe" do sidecar de conformação.
type ConformProbe struct {
	OK        bool   `json:"ok"`
	Available bool   `json:"available"`
	Detail    string `json:"detail"`
	Error     string `json:"error,omitempty"`
}

// ConformResult é o retorno do "conform": convexidade por região + grau estimado.
type ConformResult struct {
	OK                bool    `json:"ok"`
	MapPath           string  `json:"mapPath"`
	ConvPerna         float64 `json:"convPerna"`
	ConvLombo         float64 `json:"convLombo"`
	ConvPaleta        float64 `json:"convPaleta"`
	ConformationIndex float64 `json:"conformationIndex"`
	GradeEstimate     string  `json:"gradeEstimate"`
	GradeConfidence   float64 `json:"gradeConfidence"`
	Error             string  `json:"error,omitempty"`
}

// Conformation gerencia o sidecar de conformação (convexidade integral).
type Conformation struct {
	mu         sync.Mutex
	pythonBin  string
	scriptPath string
	cmd        *exec.Cmd
	stdin      *bufio.Writer
	stdout     *bufio.Reader
	started    bool
}

func NewConformation(pythonBin, scriptPath string) *Conformation {
	if pythonBin == "" {
		pythonBin = "python3"
	}
	return &Conformation{pythonBin: pythonBin, scriptPath: scriptPath}
}

func (c *Conformation) ScriptExists() bool {
	_, err := os.Stat(c.scriptPath)
	return err == nil
}

func (c *Conformation) ensureStarted() error {
	if c.started {
		return nil
	}
	if !c.ScriptExists() {
		return fmt.Errorf("conformation sidecar not found at %s", c.scriptPath)
	}
	cmd := exec.Command(c.pythonBin, c.scriptPath)
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
		return fmt.Errorf("start conformation sidecar (%s with scipy/skimage?): %w", c.pythonBin, err)
	}
	c.cmd = cmd
	c.stdin = bufio.NewWriter(stdin)
	c.stdout = bufio.NewReaderSize(stdout, 1<<20)
	c.started = true
	return nil
}

func (c *Conformation) roundtrip(cmd map[string]interface{}, out interface{}, timeout time.Duration) error {
	if err := c.ensureStarted(); err != nil {
		return err
	}
	payload, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	if _, err := c.stdin.Write(append(payload, '\n')); err != nil {
		return err
	}
	if err := c.stdin.Flush(); err != nil {
		return err
	}
	type res struct {
		line []byte
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		line, err := c.stdout.ReadBytes('\n')
		ch <- res{line, err}
	}()
	select {
	case r := <-ch:
		if r.err != nil {
			return fmt.Errorf("read conformation response: %w", r.err)
		}
		return json.Unmarshal(r.line, out)
	case <-time.After(timeout):
		return fmt.Errorf("conformation timeout")
	}
}

func (c *Conformation) Probe() ConformProbe {
	c.mu.Lock()
	defer c.mu.Unlock()
	var pr ConformProbe
	if err := c.roundtrip(map[string]interface{}{"cmd": "probe"}, &pr, 30*time.Second); err != nil {
		return ConformProbe{OK: false, Detail: err.Error(), Error: err.Error()}
	}
	return pr
}

// Conform roda a análise de conformação sobre uma carcaça recortada (fundo preto).
func (c *Conformation) Conform(image, outDir, prefix string) ConformResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	var cr ConformResult
	cmd := map[string]interface{}{
		"cmd":    "conform",
		"image":  filepath.Clean(image),
		"outDir": filepath.Clean(outDir),
		"prefix": prefix,
	}
	if err := c.roundtrip(cmd, &cr, 60*time.Second); err != nil {
		return ConformResult{OK: false, Error: err.Error()}
	}
	return cr
}

func (c *Conformation) Shutdown() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.started {
		return
	}
	var out map[string]interface{}
	_ = c.roundtrip(map[string]interface{}{"cmd": "shutdown"}, &out, 3*time.Second)
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
	c.started = false
}
