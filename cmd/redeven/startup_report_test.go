package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestWriteDesktopLaunchReportReady(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "startup", "report.json")
	err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:           desktopLaunchStatusReady,
		LocalUIURL:       "http://127.0.0.1:43210/",
		LocalUIURLs:      []string{"http://127.0.0.1:43210/", "", "http://127.0.0.1:43210/"},
		PasswordRequired: true,
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
		DesktopManaged:   true,
		DesktopOwnerID:   "desktop-owner-report",
		RuntimeService: runtimeservice.Snapshot{
			RuntimeVersion:   "v1.2.3",
			ProtocolVersion:  runtimeservice.ProtocolVersion,
			ServiceOwner:     runtimeservice.OwnerDesktop,
			DesktopManaged:   true,
			EffectiveRunMode: "hybrid",
			RemoteEnabled:    true,
			Compatibility:    runtimeservice.CompatibilityCompatible,
			ActiveWorkload: runtimeservice.Workload{
				TerminalCount: 1,
			},
		},
	})
	if err != nil {
		t.Fatalf("writeDesktopLaunchReport() error = %v", err)
	}

	body, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var report desktopLaunchReport
	if err := json.Unmarshal(body, &report); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if report.Status != desktopLaunchStatusReady {
		t.Fatalf("Status = %q", report.Status)
	}
	if report.LocalUIURL != "http://127.0.0.1:43210/" {
		t.Fatalf("LocalUIURL = %q", report.LocalUIURL)
	}
	if len(report.LocalUIURLs) != 1 || report.LocalUIURLs[0] != report.LocalUIURL {
		t.Fatalf("LocalUIURLs = %#v", report.LocalUIURLs)
	}
	if !report.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if !report.RemoteEnabled || !report.DesktopManaged || report.DesktopOwnerID != "desktop-owner-report" || report.EffectiveRunMode != "hybrid" {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.RuntimeService.RuntimeVersion != "v1.2.3" || report.RuntimeService.ActiveWorkload.TerminalCount != 1 {
		t.Fatalf("unexpected runtime service report: %#v", report.RuntimeService)
	}
	if report.RuntimeService.OpenReadiness.State != runtimeservice.OpenReadinessOpenable {
		t.Fatalf("OpenReadiness.State = %q", report.RuntimeService.OpenReadiness.State)
	}
}

func TestWriteDesktopLaunchReportBlocked(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "startup", "blocked.json")
	err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:  desktopLaunchStatusBlocked,
		Code:    desktopLaunchCodeStateDirLocked,
		Message: "Another Redeven runtime instance is already using this state directory.",
		LockOwner: &desktopLaunchLockOwner{
			PID:            42,
			Mode:           "remote",
			LocalUIEnabled: false,
		},
	})
	if err != nil {
		t.Fatalf("writeDesktopLaunchReport() error = %v", err)
	}

	body, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var report desktopLaunchReport
	if err := json.Unmarshal(body, &report); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if report.Status != desktopLaunchStatusBlocked || report.Code != desktopLaunchCodeStateDirLocked {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.LockOwner == nil || report.LockOwner.Mode != "remote" {
		t.Fatalf("unexpected lock owner: %#v", report.LockOwner)
	}
}

func TestWriteDesktopLaunchReportRejectsMissingLocalURL(t *testing.T) {
	err := writeDesktopLaunchReport(filepath.Join(t.TempDir(), "report.json"), desktopLaunchReport{
		Status: desktopLaunchStatusReady,
	})
	if err == nil {
		t.Fatalf("expected missing local_ui_url error")
	}
}

func TestWriteDesktopLaunchReportRejectsMissingBlockedCode(t *testing.T) {
	err := writeDesktopLaunchReport(filepath.Join(t.TempDir(), "report.json"), desktopLaunchReport{
		Status:  desktopLaunchStatusBlocked,
		Message: "blocked",
	})
	if err == nil {
		t.Fatalf("expected missing blocked code error")
	}
}
