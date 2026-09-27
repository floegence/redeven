package ai

import (
	"encoding/json"
	"github.com/floegence/redeven/internal/browserbridge"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestChromeMissingResourcesHaveActionableDiagnostics(t *testing.T) {
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed"}); err != nil {
		t.Fatal(err)
	}
	host := NewComputerUseRuntime(registry, nil, t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	_, err := host.setupComputerExtension(t.Context(), "unknown")
	if err == nil || err.Error() != "browser_resources_missing" {
		t.Fatalf("missing resources must identify the repairable prerequisite: %v", err)
	}
	raw, err := json.Marshal(host.extensionStatus())
	if err != nil {
		t.Fatal(err)
	}
	var status struct {
		Diagnostic struct{ Stage, Reason string }
		Hostname   string
	}
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if status.Diagnostic.Stage != "prepare" || status.Diagnostic.Reason != "browser_resources_missing" || status.Hostname == "" {
		t.Fatalf("status must explain the same failure before setup: %s", raw)
	}
}

func TestChromeDesktopPrerequisitesDoNotConfuseInstallationAndSession(t *testing.T) {
	for _, tc := range []struct {
		installed                bool
		display, wayland, reason string
	}{
		{false, "", "", "browser_not_installed"}, {true, "", "", "desktop_session_unavailable"}, {true, ":0", "", ""}, {true, "", "wayland-0", ""},
	} {
		err := checkComputerExtensionOpen("linux", "extensions", browserbridge.Installation{Installed: tc.installed}, func(key string) string {
			if key == "DISPLAY" {
				return tc.display
			}
			if key == "WAYLAND_DISPLAY" {
				return tc.wayland
			}
			return ""
		}, func(string) (string, error) {
			if !tc.installed {
				return "", os.ErrNotExist
			}
			return "/usr/bin/google-chrome", nil
		})
		if tc.reason == "" {
			if err != nil {
				t.Fatal(err)
			}
		} else if err == nil || err.Error() != tc.reason {
			t.Fatalf("prerequisite: %v want %s", err, tc.reason)
		}
	}
}

func TestChromeLaunchRetainsEarlyAndLateExitFailure(t *testing.T) {
	for _, delay := range []string{"", "sleep 0.5; "} {
		failure := make(chan error, 1)
		err := startComputerExtensionCommand(exec.Command("/bin/sh", "-c", delay+"exit 23"), "chrome_start_failed", func(err error) { failure <- err })
		if delay == "" && (err == nil || err.Error() != "chrome_start_failed") {
			t.Fatalf("early exit: %v", err)
		}
		select {
		case err := <-failure:
			diagnostic := ComputerExtensionDiagnosticForError(err, "open")
			if diagnostic.Reason != "chrome_start_failed" || diagnostic.DiagnosticID == "" {
				t.Fatalf("missing launch evidence: %+v", diagnostic)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("launch failure was discarded")
		}
	}
}
