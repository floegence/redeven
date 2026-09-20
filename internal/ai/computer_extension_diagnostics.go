package ai

import (
	"crypto/rand"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Only these product facts cross the UI boundary. Platform errors stay in logs.
type ComputerExtensionDiagnostic struct {
	Stage        string `json:"stage"`
	Reason       string `json:"reason"`
	DiagnosticID string `json:"diagnostic_id,omitempty"`
}

type computerExtensionFailure struct {
	diagnostic ComputerExtensionDiagnostic
	cause      error
}

func (e *computerExtensionFailure) Error() string { return e.diagnostic.Reason }
func (e *computerExtensionFailure) Unwrap() error { return e.cause }

func extensionFailure(stage, reason string, cause error) error {
	var existing *computerExtensionFailure
	if errors.As(cause, &existing) {
		return cause
	}
	return &computerExtensionFailure{diagnostic: ComputerExtensionDiagnostic{Stage: stage, Reason: reason, DiagnosticID: rand.Text()}, cause: cause}
}

// ComputerExtensionDiagnosticForError keeps native causes out of API responses.
func ComputerExtensionDiagnosticForError(err error, stage string) ComputerExtensionDiagnostic {
	var failure *computerExtensionFailure
	if errors.As(err, &failure) {
		return failure.diagnostic
	}
	return ComputerExtensionDiagnostic{Stage: stage, Reason: "extension_" + stage + "_failed"}
}

func (r *ComputerUseRuntime) extensionResources() (*PlaywrightTargetExecutor, error) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return nil, extensionFailure("prepare", "extension_platform_unsupported", nil)
	}
	r.mu.RLock()
	managed, ok := r.executors["browser-main"].(*PlaywrightTargetExecutor)
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return nil, extensionFailure("prepare", "extension_runtime_unavailable", nil)
	}
	if !ok {
		return nil, extensionFailure("prepare", "browser_resources_missing", nil)
	}
	if err := managed.CheckComputerSetup(); err != nil {
		return nil, extensionFailure("prepare", "browser_resources_missing", err)
	}
	info, err := os.Stat(filepath.Join(filepath.Dir(managed.HelperPath), "extension", "manifest.json"))
	if err != nil || !info.Mode().IsRegular() {
		return nil, extensionFailure("prepare", "browser_extension_missing", err)
	}
	return managed, nil
}

func chromeExecutableAvailable() bool { _, err := exec.LookPath("google-chrome"); return err == nil }

// This observes the Runtime's launch context; it never borrows another user's
// graphical session. A manually opened Chrome can still complete the handshake.
func checkComputerExtensionOpen(platform, action string, getenv func(string) string, lookPath func(string) (string, error)) error {
	if platform != "linux" {
		return nil
	}
	name := "google-chrome"
	if action == "folder" {
		name = "xdg-open"
	}
	if _, err := lookPath(name); err != nil {
		reason := "chrome_not_installed"
		if action == "folder" {
			reason = "folder_opener_missing"
		}
		return extensionFailure("open", reason, err)
	}
	if strings.TrimSpace(getenv("DISPLAY")) == "" && strings.TrimSpace(getenv("WAYLAND_DISPLAY")) == "" {
		return extensionFailure("open", "desktop_session_unavailable", nil)
	}
	return nil
}
