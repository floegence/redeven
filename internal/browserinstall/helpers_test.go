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
	files := map[string][]byte{
		"node": []byte("#!/bin/sh\n"), "redevenComputerHost.mjs": []byte("host"), "redevenManagedBrowser.mjs": []byte("browser"),
		"computerBrowserSource.mjs": []byte("source"),
		"redevenBrowserHost.mjs":    []byte("host"), "computerExtensionTransport.mjs": []byte("extension transport"), "computerBrowserHost.mjs": []byte("shared source host"), "computerManagedDownloads.mjs": []byte("native downloads"), "computerBrowserLineage.mjs": []byte("source lineage"),
		"node_modules/playwright/package.json":                                                             []byte(`{"version":"1.63.0"}`),
		"node_modules/@floegence/floebrowser/package.json":                                                 []byte(`{"version":"0.1.2"}`),
		"node_modules/@floegence/floebrowser/dist/host/index.js":                                           []byte("sdk"),
		"node_modules/@floegence/floebrowser/dist/bin/manifest.json":                                       []byte(`{}`),
		"node_modules/@floegence/floebrowser/dist/bin/" + runtime.GOOS + "-" + arch + "/floebrowser-media": []byte("media"),
		"extension/manifest.json":                                                                          []byte(`{}`), "extension/background.mjs": []byte("background"), "extension/computerBrowserLineage.mjs": []byte("lineage"), "extension/popup.html": []byte("popup"), "extension/popup.mjs": []byte("popup script"),
	}
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
	if err := os.Remove(filepath.Join(filepath.Dir(helper), "extension", "popup.mjs")); err != nil {
		t.Fatal(err)
	}
	// An internally consistent manifest must still include every required
	// browser connection entrypoint.
	retained := make([]map[string]any, 0, len(entries)-1)
	for _, entry := range entries {
		if entry["path"] != "extension/popup.mjs" {
			retained = append(retained, entry)
		}
	}
	incompleteManifest, _ := json.Marshal(map[string]any{"schema_version": 1, "platform": runtime.GOOS, "architecture": arch, "files": retained})
	if err := os.WriteFile(filepath.Join(filepath.Dir(helper), "manifest.json"), incompleteManifest, 0644); err != nil {
		t.Fatal(err)
	}
	if err := validateHelpers(filepath.Dir(helper)); err == nil {
		t.Fatal("missing extension entrypoint was admitted")
	}
	if _, err := PrepareComputerHelpers(archive, state); err != nil {
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
