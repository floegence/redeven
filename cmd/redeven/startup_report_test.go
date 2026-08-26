package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const testLocalUIBridgeToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func TestWriteDesktopLaunchReportReady(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "startup", "report.json")
	err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:             desktopLaunchStatusReady,
		LocalUIURL:         "http://127.0.0.1:43210/",
		LocalUIURLs:        []string{"http://127.0.0.1:43210/", "", "http://127.0.0.1:43210/"},
		LocalUIBridgeURL:   "http://127.0.0.1:43211/",
		LocalUIBridgeToken: testLocalUIBridgeToken,
		PasswordRequired:   true,
		Exposure:           runtimemanagement.NewLocalUIExposure(false, true),
		EffectiveRunMode:   "hybrid",
		RemoteEnabled:      true,
		StartedAtUnixMS:    1778751234567,
		RuntimeService: runtimeservice.Snapshot{
			RuntimeVersion:   "v1.2.3",
			ProtocolVersion:  runtimeservice.ProtocolVersion,
			EffectiveRunMode: "hybrid",
			RemoteEnabled:    true,
			Compatibility:    runtimeservice.CompatibilityCompatible,
			AIReadiness: runtimeservice.AIReadiness{
				State: "degraded", ReasonCode: "host_thread_settings_missing", IssueCount: 2,
			},
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
	if report.LocalUIBridgeURL != "http://127.0.0.1:43211/" {
		t.Fatalf("LocalUIBridgeURL = %q", report.LocalUIBridgeURL)
	}
	if report.LocalUIBridgeToken != testLocalUIBridgeToken {
		t.Fatalf("LocalUIBridgeToken was not preserved in the private report")
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("report mode = %o, want 600", info.Mode().Perm())
	}
	if !report.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if !report.RemoteEnabled || report.EffectiveRunMode != "hybrid" {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.StartedAtUnixMS != 1778751234567 {
		t.Fatalf("StartedAtUnixMS = %d", report.StartedAtUnixMS)
	}
	if report.RuntimeService.RuntimeVersion != "v1.2.3" || report.RuntimeService.ActiveWorkload.TerminalCount != 1 {
		t.Fatalf("unexpected runtime service report: %#v", report.RuntimeService)
	}
	if report.RuntimeService.OpenReadiness.State != runtimeservice.OpenReadinessOpenable {
		t.Fatalf("OpenReadiness.State = %q", report.RuntimeService.OpenReadiness.State)
	}
	if report.RuntimeService.AIReadiness.State != "degraded" || report.RuntimeService.AIReadiness.ReasonCode != "host_thread_settings_missing" || report.RuntimeService.AIReadiness.IssueCount != 2 {
		t.Fatalf("AIReadiness = %#v, want degraded maintenance finding", report.RuntimeService.AIReadiness)
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

func TestWriteDesktopLaunchReportRejectsMissingLocalEndpoints(t *testing.T) {
	err := writeDesktopLaunchReport(filepath.Join(t.TempDir(), "report.json"), desktopLaunchReport{
		Status: desktopLaunchStatusReady,
	})
	if err == nil {
		t.Fatalf("expected missing private Local UI bridge error")
	}
}

func TestWriteDesktopLaunchReportAcceptsPrivateBridgeWithoutPublicURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.json")
	err := writeDesktopLaunchReport(path, desktopLaunchReport{
		Status:             desktopLaunchStatusReady,
		LocalUIBridgeURL:   "http://127.0.0.1:43124/",
		LocalUIBridgeToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		Exposure:           runtimemanagement.NewLocalUIExposure(false, false),
	})
	if err != nil {
		t.Fatalf("writeDesktopLaunchReport() error = %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var report desktopLaunchReport
	if err := json.Unmarshal(body, &report); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if report.LocalUIURL != "" || len(report.LocalUIURLs) != 0 {
		t.Fatalf("private-only report published public URLs: %#v", report)
	}
}

func TestWriteDesktopLaunchReportRejectsInvalidLocalUIBridgeURL(t *testing.T) {
	for _, raw := range []string{
		"",
		"https://127.0.0.1:43123/",
		"http://localhost:43123/",
		"http://100.126.191.114:43123/",
		"http://127.0.0.1/",
		"http://127.0.0.1:43123/env",
		"http://user:pass@127.0.0.1:43123/",
		"http://127.0.0.1:43123/?token=secret",
		"http://127.0.0.1:43123/#fragment",
	} {
		t.Run(raw, func(t *testing.T) {
			err := writeDesktopLaunchReport(filepath.Join(t.TempDir(), "report.json"), desktopLaunchReport{
				Status:             desktopLaunchStatusReady,
				LocalUIURL:         "http://127.0.0.1:43122/",
				LocalUIBridgeURL:   raw,
				LocalUIBridgeToken: testLocalUIBridgeToken,
				Exposure:           runtimemanagement.NewLocalUIExposure(true, false),
			})
			if err == nil {
				t.Fatalf("writeDesktopLaunchReport() accepted bridge URL %q", raw)
			}
		})
	}
}

func TestWriteDesktopLaunchReportRejectsInvalidLocalUIBridgeToken(t *testing.T) {
	for _, raw := range []string{"", "too-short", testLocalUIBridgeToken + "A", testLocalUIBridgeToken[:42] + "B"} {
		t.Run(raw, func(t *testing.T) {
			err := writeDesktopLaunchReport(filepath.Join(t.TempDir(), "report.json"), desktopLaunchReport{
				Status:             desktopLaunchStatusReady,
				LocalUIURL:         "http://127.0.0.1:43122/",
				LocalUIBridgeURL:   "http://127.0.0.1:43123/",
				LocalUIBridgeToken: raw,
				Exposure:           runtimemanagement.NewLocalUIExposure(true, false),
			})
			if err == nil {
				t.Fatalf("writeDesktopLaunchReport() accepted bridge token %q", raw)
			}
		})
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
