package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCreateTarCheckpoint_SkipsUnreadableEntries(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("permission semantics differ on Windows")
	}

	root := t.TempDir()
	stateDir := t.TempDir()

	if err := os.WriteFile(filepath.Join(root, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("write keep.txt: %v", err)
	}

	blockedDir := filepath.Join(root, "blocked")
	if err := os.MkdirAll(blockedDir, 0o755); err != nil {
		t.Fatalf("mkdir blocked: %v", err)
	}
	if err := os.WriteFile(filepath.Join(blockedDir, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatalf("write secret.txt: %v", err)
	}
	if err := os.Chmod(blockedDir, 0); err != nil {
		t.Fatalf("chmod blocked: %v", err)
	}
	defer func() {
		_ = os.Chmod(blockedDir, 0o755)
	}()

	if _, err := os.ReadDir(blockedDir); err == nil {
		t.Skip("filesystem did not surface permission denial for unreadable directory")
	}

	cp, err := createTarCheckpoint(context.Background(), stateDir, "cp_test_unreadable", root, 1)
	if err != nil {
		t.Fatalf("createTarCheckpoint: %v", err)
	}
	if cp.Tar == nil {
		t.Fatalf("Tar metadata should not be nil")
	}
	if len(cp.Tar.Skipped) == 0 {
		t.Fatalf("expected skipped metadata for unreadable entries")
	}

	foundBlocked := false
	for _, item := range cp.Tar.Skipped {
		if strings.HasPrefix(item.Path, "blocked") {
			foundBlocked = true
			break
		}
	}
	if !foundBlocked {
		t.Fatalf("skipped=%v, want blocked path entry", cp.Tar.Skipped)
	}

	manifestRaw, err := os.ReadFile(cp.Tar.ManifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest tarCheckpointManifest
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	if manifest.Version != 2 {
		t.Fatalf("manifest.Version=%d, want 2", manifest.Version)
	}
	if len(manifest.Files) != 1 || manifest.Files[0] != "keep.txt" {
		t.Fatalf("manifest.Files=%v, want [keep.txt]", manifest.Files)
	}
	if len(manifest.Skipped) == 0 {
		t.Fatalf("manifest.Skipped should not be empty")
	}
}
