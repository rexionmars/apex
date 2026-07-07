// Package capture gerencia fontes de captura. A webcam é tratada no frontend
// (getUserMedia); aqui fica o Kinect, que precisa de depth e roda por um sidecar
// Python (libfreenect2/freenect) — cada linguagem faz o que faz bem.
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

// ProbeResult é o retorno do "probe" do sidecar.
type ProbeResult struct {
	OK        bool   `json:"ok"`
	Backend   string `json:"backend"`   // kinect_v2 | kinect_v1 | none
	Available bool   `json:"available"`
	Detail    string `json:"detail"`
	Error     string `json:"error,omitempty"`
}

// CaptureResult é o retorno do "capture".
type CaptureResult struct {
	OK        bool   `json:"ok"`
	RGBPath   string `json:"rgbPath"`
	DepthPath string `json:"depthPath"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Error     string `json:"error,omitempty"`
}

// Kinect encapsula o processo sidecar Python.
type Kinect struct {
	mu         sync.Mutex
	pythonBin  string
	scriptPath string
	cmd        *exec.Cmd
	stdin      *bufio.Writer
	stdout     *bufio.Reader
	started    bool
}

// NewKinect cria o gerenciador. scriptPath aponta para sidecar/kinect_capture.py.
func NewKinect(pythonBin, scriptPath string) *Kinect {
	if pythonBin == "" {
		pythonBin = "python3"
	}
	return &Kinect{pythonBin: pythonBin, scriptPath: scriptPath}
}

// ScriptExists indica se o script do sidecar está no lugar esperado.
func (k *Kinect) ScriptExists() bool {
	_, err := os.Stat(k.scriptPath)
	return err == nil
}

func (k *Kinect) ensureStarted() error {
	if k.started {
		return nil
	}
	if !k.ScriptExists() {
		return fmt.Errorf("sidecar not found at %s", k.scriptPath)
	}
	cmd := exec.Command(k.pythonBin, k.scriptPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr // logs do Python vão para o stderr do app
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start sidecar (%s installed?): %w", k.pythonBin, err)
	}
	k.cmd = cmd
	k.stdin = bufio.NewWriter(stdin)
	k.stdout = bufio.NewReader(stdout)
	k.started = true
	return nil
}

// roundtrip envia um comando e lê UMA resposta JSON, com timeout.
func (k *Kinect) roundtrip(cmd map[string]interface{}, out interface{}) error {
	if err := k.ensureStarted(); err != nil {
		return err
	}
	payload, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	if _, err := k.stdin.Write(append(payload, '\n')); err != nil {
		return err
	}
	if err := k.stdin.Flush(); err != nil {
		return err
	}

	// leitura com timeout (a captura do Kinect pode levar ~1s).
	type res struct {
		line []byte
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		line, err := k.stdout.ReadBytes('\n')
		ch <- res{line, err}
	}()

	select {
	case r := <-ch:
		if r.err != nil {
			return fmt.Errorf("read sidecar response: %w", r.err)
		}
		return json.Unmarshal(r.line, out)
	case <-time.After(30 * time.Second):
		return fmt.Errorf("timeout waiting for the Kinect sidecar")
	}
}

// Probe pergunta ao sidecar qual backend está disponível.
func (k *Kinect) Probe() ProbeResult {
	k.mu.Lock()
	defer k.mu.Unlock()
	var pr ProbeResult
	if err := k.roundtrip(map[string]interface{}{"cmd": "probe"}, &pr); err != nil {
		return ProbeResult{OK: false, Backend: "none", Available: false, Detail: err.Error(), Error: err.Error()}
	}
	return pr
}

// Capture dispara uma captura RGB+depth, salvando em outDir com o prefixo dado.
func (k *Kinect) Capture(outDir, prefix string) CaptureResult {
	k.mu.Lock()
	defer k.mu.Unlock()
	var cr CaptureResult
	cmd := map[string]interface{}{
		"cmd":    "capture",
		"outDir": filepath.Clean(outDir),
		"prefix": prefix,
	}
	if err := k.roundtrip(cmd, &cr); err != nil {
		return CaptureResult{OK: false, Error: err.Error()}
	}
	return cr
}

// Shutdown encerra o sidecar de forma limpa.
func (k *Kinect) Shutdown() {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.started {
		return
	}
	var out map[string]interface{}
	_ = k.roundtrip(map[string]interface{}{"cmd": "shutdown"}, &out)
	if k.cmd != nil && k.cmd.Process != nil {
		_ = k.cmd.Process.Kill()
	}
	k.started = false
}
