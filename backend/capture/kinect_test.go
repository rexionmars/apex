package capture

import (
	"os/exec"
	"path/filepath"
	"testing"
)

// Testa o ciclo Go<->Python: spawn do sidecar, probe e capture sem hardware.
// Sem numpy/freenect o probe deve responder available=false e capture deve
// devolver erro claro — o app nunca deve travar por falta de Kinect.
func TestSidecarRoundtrip(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 indisponível")
	}
	script, err := filepath.Abs("../../sidecar/kinect_capture.py")
	if err != nil {
		t.Fatal(err)
	}
	k := NewKinect("python3", script)
	if !k.ScriptExists() {
		t.Fatalf("sidecar não encontrado em %s", script)
	}
	defer k.Shutdown()

	pr := k.Probe()
	if !pr.OK {
		t.Fatalf("probe falhou: %s", pr.Error)
	}
	// Sem SDK instalado, esperamos indisponível — mas o protocolo funcionou.
	t.Logf("backend=%s available=%v detail=%s", pr.Backend, pr.Available, pr.Detail)

	if !pr.Available {
		cr := k.Capture(t.TempDir(), "test")
		if cr.OK {
			t.Fatal("capture não deveria ter sucesso sem Kinect")
		}
		if cr.Error == "" {
			t.Fatal("capture deveria devolver mensagem de erro")
		}
	}
}
