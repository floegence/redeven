package browserinstall

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestComputerHelperArchiveVerifiesContentsAndRepairsCorruption(t *testing.T) {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	files := map[string][]byte{"node": []byte("#!/bin/sh\n"), "redevenComputerHost.mjs": []byte("host"), "redevenManagedBrowser.mjs": []byte("browser"), "node_modules/playwright/package.json": []byte(`{"version":"1.60.0"}`)}
	entries := []map[string]any{}
	archive := filepath.Join(t.TempDir(), "computer.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(f)
	for name, data := range files {
		mode := os.FileMode(0644)
		if name == "node" {
			mode = 0755
		}
		header := &zip.FileHeader{Name: name}
		header.SetMode(mode)
		item, _ := writer.CreateHeader(header)
		_, _ = item.Write(data)
		entries = append(entries, map[string]any{"path": name, "sha256": fmt.Sprintf("%x", sha256.Sum256(data)), "size_bytes": len(data), "executable": name == "node"})
	}
	manifest, _ := json.Marshal(map[string]any{"schema_version": 1, "platform": runtime.GOOS, "architecture": arch, "files": entries})
	item, _ := writer.Create("manifest.json")
	_, _ = item.Write(manifest)
	_ = writer.Close()
	_ = f.Close()
	state := t.TempDir()
	helper, err := PrepareComputerHelpers(archive, state)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := os.Stat(helper)
	if second, err := PrepareComputerHelpers(archive, state); err != nil || second != helper {
		t.Fatalf("reuse: %s %v", second, err)
	}
	second, _ := os.Stat(helper)
	if !os.SameFile(first, second) {
		t.Fatal("valid helpers unnecessarily rewritten")
	}
	if err = os.WriteFile(helper, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = PrepareComputerHelpers(archive, state); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(helper)
	if string(data) != "host" {
		t.Fatal("invalid helpers reused")
	}
}

func TestPackagedComputerHelpersRunWithoutSource(t *testing.T) {
	archive := os.Getenv("REDEVEN_COMPUTER_ARCHIVE")
	if archive == "" {
		t.Skip("requires a staged native helper archive")
	}
	helper, err := PrepareComputerHelpers(archive, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(filepath.Dir(helper), "node")
	output, err := exec.CommandContext(t.Context(), node, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("node: %s %v", output, err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(helper), "chromium")); !os.IsNotExist(err) {
		t.Fatal("browser unexpectedly bundled")
	}
	t.Logf("thin helper archive verified: %s", output)
}
