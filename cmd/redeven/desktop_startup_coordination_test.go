package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestHandleDesktopLockConflictWritesAttachedReportWhenRuntimeIsAvailable(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-startup-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	cfgPath := layout.ConfigPath
	reportPath := filepath.Join(t.TempDir(), "startup-report.json")
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:       layout.StateDir,
				PID:            os.Getpid(),
				DesktopManaged: true,
				DesktopOwnerID: "desktop-owner-health",
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:       "http://127.0.0.1:23998/",
				LocalUIURLs:      []string{"http://127.0.0.1:23998/"},
				PasswordRequired: true,
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				ServiceOwner:     runtimeservice.OwnerDesktop,
				DesktopManaged:   true,
				EffectiveRunMode: "hybrid",
				RemoteEnabled:    true,
				OpenReadiness: runtimeservice.OpenReadiness{
					State: runtimeservice.OpenReadinessOpenable,
				},
			}),
			Diagnostics: runtimemanagement.RuntimeAttachDiagnostics{
				ControlSocketPath: layout.RuntimeControlSocketPath,
			},
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

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
	if report.LocalUIURL != "http://127.0.0.1:23998/" {
		t.Fatalf("LocalUIURL = %q", report.LocalUIURL)
	}
	if !report.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if report.StateDir != filepath.Dir(cfgPath) {
		t.Fatalf("unexpected diagnostics report: %#v", report)
	}
	if report.DesktopOwnerID != "desktop-owner-health" {
		t.Fatalf("DesktopOwnerID = %q", report.DesktopOwnerID)
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
		"rt_conflict",
		false,
		"",
		false,
		config.StateLayout{
			ConfigPath:               cfgPath,
			StateRoot:                filepath.Dir(filepath.Dir(cfgPath)),
			RuntimeControlSocketPath: config.RuntimeControlSocketPathFromConfigPath(cfgPath),
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
	if report.Status != desktopLaunchStatusBlocked || report.Code != string(runtimemanagement.AttachStateLiveProcessWithoutSocket) {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.LockOwner == nil || report.LockOwner.Mode != "remote" || report.LockOwner.LocalUIEnabled {
		t.Fatalf("unexpected lock owner: %#v", report.LockOwner)
	}
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
