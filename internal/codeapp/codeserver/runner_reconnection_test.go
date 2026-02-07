package codeserver

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveReconnectionGraceDefault(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want 30s", got)
	}
}

func TestResolveReconnectionGraceFromEnv(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "45s")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 45*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want 45s", got)
	}
}

func TestResolveReconnectionGraceInvalidEnvFallsBack(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "bad-value")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want fallback 30s", got)
	}
}

func TestResolveReconnectionGraceNonPositiveEnvFallsBack(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "0s")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want fallback 30s", got)
	}
}

func TestFormatReconnectionGraceMilliseconds(t *testing.T) {
	if got := formatReconnectionGraceMilliseconds(1500 * time.Millisecond); got != "1500ms" {
		t.Fatalf("formatReconnectionGraceMilliseconds() = %q, want %q", got, "1500ms")
	}
	if got := formatReconnectionGraceMilliseconds(0); got != "" {
		t.Fatalf("formatReconnectionGraceMilliseconds() = %q, want empty", got)
	}
}

func TestCleanupWorkspaceStorageLocks(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	wsRoot := filepath.Join(root, "User", "workspaceStorage")
	if err := os.MkdirAll(filepath.Join(wsRoot, "a"), 0o700); err != nil {
		t.Fatalf("mkdir a: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(wsRoot, "b"), 0o700); err != nil {
		t.Fatalf("mkdir b: %v", err)
	}
	if err := os.WriteFile(filepath.Join(wsRoot, "a", "vscode.lock"), []byte("x"), 0o600); err != nil {
		t.Fatalf("write lock: %v", err)
	}

	removed, err := cleanupWorkspaceStorageLocks(wsRoot)
	if err != nil {
		t.Fatalf("cleanupWorkspaceStorageLocks() error = %v", err)
	}
	if removed != 1 {
		t.Fatalf("cleanupWorkspaceStorageLocks() removed = %d, want 1", removed)
	}
	if _, err := os.Stat(filepath.Join(wsRoot, "a", "vscode.lock")); !os.IsNotExist(err) {
		t.Fatalf("lock should be removed, stat err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(wsRoot, "b")); err != nil {
		t.Fatalf("workspace folder should be kept, err = %v", err)
	}
	if removed, err := cleanupWorkspaceStorageLocks(filepath.Join(root, "not-exist")); err != nil || removed != 0 {
		t.Fatalf("cleanup missing dir = (%d, %v), want (0, nil)", removed, err)
	}
}
