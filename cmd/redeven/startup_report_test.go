package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteStartupReport(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "startup", "report.json")
	err := writeStartupReport(reportPath, startupReport{
		LocalUIURL:       "http://127.0.0.1:43210/",
		LocalUIURLs:      []string{"http://127.0.0.1:43210/", "", "http://127.0.0.1:43210/"},
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
		DesktopManaged:   true,
	})
	if err != nil {
		t.Fatalf("writeStartupReport() error = %v", err)
	}

	body, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var report startupReport
	if err := json.Unmarshal(body, &report); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if report.LocalUIURL != "http://127.0.0.1:43210/" {
		t.Fatalf("LocalUIURL = %q", report.LocalUIURL)
	}
	if len(report.LocalUIURLs) != 1 || report.LocalUIURLs[0] != report.LocalUIURL {
		t.Fatalf("LocalUIURLs = %#v", report.LocalUIURLs)
	}
	if !report.RemoteEnabled || !report.DesktopManaged || report.EffectiveRunMode != "hybrid" {
		t.Fatalf("unexpected report: %#v", report)
	}
}

func TestWriteStartupReport_RejectsMissingLocalURL(t *testing.T) {
	err := writeStartupReport(filepath.Join(t.TempDir(), "report.json"), startupReport{})
	if err == nil {
		t.Fatalf("expected missing local_ui_url error")
	}
}
