package localui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
)

type nativeBrowserFixtureBackend struct {
	localUITestBackend
	binding appserver.NativeCodeSpaceBinding
}

func (b nativeBrowserFixtureBackend) BindRunningCodeSpace(_ context.Context, id string) (appserver.NativeCodeSpaceBinding, error) {
	if id != b.binding.CodeSpaceID {
		return appserver.NativeCodeSpaceBinding{}, fmt.Errorf("unknown fixture codespace")
	}
	return b.binding, nil
}

// This opt-in fixture exposes the real private bridge and managed editor to an
// independently launched browser. Only the harness owns its state and processes.
func TestNativeCodeSpaceBrowserEditorFixture(t *testing.T) {
	root := os.Getenv("REDEVEN_NATIVE_BROWSER_FIXTURE_STATE")
	if root == "" {
		t.Skip("requires an isolated browser acceptance harness")
	}
	workspace := filepath.Join(root, "workspace with spaces (2)")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "native-smoke.txt"), []byte("native editor smoke\n"), 0600); err != nil {
		t.Fatal(err)
	}
	// Use a fixture-owned terminal profile so user shell startup hooks cannot
	// consume test keystrokes or launch unrelated programs.
	userDir := filepath.Join(root, "runtime", "apps", "code", "spaces", "native-smoke", "codeserver", "user-data", "User")
	if err := os.MkdirAll(userDir, 0700); err != nil {
		t.Fatal(err)
	}
	settings := []byte(`{"editor.accessibilitySupport":"on","terminal.integrated.shellIntegration.enabled":false,"terminal.integrated.profiles.osx":{"Smoke":{"path":"/bin/sh","args":["-i"]}},"terminal.integrated.profiles.linux":{"Smoke":{"path":"/bin/sh","args":["-i"]}},"terminal.integrated.defaultProfile.osx":"Smoke","terminal.integrated.defaultProfile.linux":"Smoke","terminal.integrated.env.osx":{"ENV":null,"PS1":"redeven-smoke$ "},"terminal.integrated.env.linux":{"ENV":null,"PS1":"redeven-smoke$ "}}`)
	if err := os.WriteFile(filepath.Join(userDir, "settings.json"), settings, 0600); err != nil {
		t.Fatal(err)
	}
	runner := codeserver.NewRunner(codeserver.RunnerOptions{StateDir: filepath.Join(root, "runtime"), StateRoot: filepath.Join(root, "runtime"), PortMin: 43000, PortMax: 49000})
	instance, err := runner.EnsureRunning("native-smoke", workspace, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := runner.StopAll(); err != nil {
			t.Errorf("stop fixture editor: %v", err)
		}
	}()
	binding := appserver.NativeCodeSpaceBinding{CodeSpaceID: "native-smoke", InstanceID: instance.InstanceID, Port: instance.Port, WorkspacePath: workspace, Context: instance.Lifetime(), AdmitConnection: instance.AdmitNativeConnection}
	cfg := writeTestConfig(t)
	s := newTestServerWithAppServer(t, nil, newTestAppServerWithBackend(t, cfg, nativeBrowserFixtureBackend{binding: binding}), cfg)
	s.localUIBridgeToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	server := httptest.NewServer(s.HandlerForDesktopBridge())
	defer server.Close()
	ready, _ := json.Marshal(map[string]any{"bridge_url": server.URL, "workspace": workspace, "editor_pid": instance.PID, "editor_port": instance.Port, "state": root})
	fmt.Println("NATIVE_BROWSER_READY " + string(ready))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
}
