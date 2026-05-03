package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestHandleDesktopLockConflictWritesAttachedReportWhenRuntimeIsAvailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/local/runtime/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"status":"online","password_required":true,"runtime_service":{"protocol_version":"redeven-runtime-v1","service_owner":"desktop","desktop_managed":true,"compatibility":"compatible","open_readiness":{"state":"openable"},"active_workload":{}}}}`))
	}))
	defer server.Close()

	cfgPath := filepath.Join(t.TempDir(), "config.json")
	reportPath := filepath.Join(t.TempDir(), "startup-report.json")
	runtimePath := localuiruntime.RuntimeStatePath(cfgPath)
	if err := writeRuntimeStateForTest(runtimePath, server.URL+"/"); err != nil {
		t.Fatalf("writeRuntimeStateForTest() error = %v", err)
	}

	handled, exitCode, err := handleDesktopLockConflict(reportPath, filepath.Join(filepath.Dir(cfgPath), "agent.lock"), cfgPath)
	if err != nil {
		t.Fatalf("handleDesktopLockConflict() error = %v", err)
	}
	if !handled || exitCode != 0 {
		t.Fatalf("handled=%v exitCode=%d", handled, exitCode)
	}

	report := readDesktopLaunchReportForTest(t, reportPath)
	if report.Status != desktopLaunchStatusAttached {
		t.Fatalf("Status = %q", report.Status)
	}
	if report.LocalUIURL != server.URL+"/" {
		t.Fatalf("LocalUIURL = %q", report.LocalUIURL)
	}
	if !report.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if report.StateDir != filepath.Dir(cfgPath) || !report.DiagnosticsEnabled {
		t.Fatalf("unexpected diagnostics report: %#v", report)
	}
	if report.RuntimeService.OpenReadiness.State != "openable" {
		t.Fatalf("OpenReadiness.State = %q", report.RuntimeService.OpenReadiness.State)
	}
}

func TestHandleDesktopLockConflictWritesBlockedReportWhenRuntimeIsUnavailable(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	reportPath := filepath.Join(t.TempDir(), "startup-report.json")
	lockPath := filepath.Join(filepath.Dir(cfgPath), "agent.lock")

	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		t.Fatalf("Acquire() error = %v", err)
	}
	defer func() {
		_ = lk.Release()
	}()
	if err := writeAgentLockMetadata(lk, newAgentLockMetadata(
		"remote",
		false,
		false,
		config.StateLayout{
			ConfigPath:       cfgPath,
			RuntimeStatePath: localuiruntime.RuntimeStatePath(cfgPath),
		},
	)); err != nil {
		t.Fatalf("writeAgentLockMetadata() error = %v", err)
	}

	handled, exitCode, err := handleDesktopLockConflict(reportPath, lockPath, cfgPath)
	if err != nil {
		t.Fatalf("handleDesktopLockConflict() error = %v", err)
	}
	if !handled || exitCode != 1 {
		t.Fatalf("handled=%v exitCode=%d", handled, exitCode)
	}

	report := readDesktopLaunchReportForTest(t, reportPath)
	if report.Status != desktopLaunchStatusBlocked || report.Code != desktopLaunchCodeStateDirLocked {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.LockOwner == nil || report.LockOwner.Mode != "remote" || report.LockOwner.LocalUIEnabled {
		t.Fatalf("unexpected lock owner: %#v", report.LockOwner)
	}
}

func writeRuntimeStateForTest(path string, localUIURL string) error {
	body, err := json.MarshalIndent(map[string]any{
		"local_ui_url":        localUIURL,
		"local_ui_urls":       []string{localUIURL},
		"password_required":   true,
		"effective_run_mode":  "hybrid",
		"remote_enabled":      true,
		"desktop_managed":     true,
		"state_dir":           filepath.Dir(filepath.Dir(path)),
		"diagnostics_enabled": true,
	}, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}

func readDesktopLaunchReportForTest(t *testing.T, path string) desktopLaunchReport {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var report desktopLaunchReport
	if err := json.Unmarshal(body, &report); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	return report
}
