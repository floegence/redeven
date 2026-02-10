package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvePathInWorkspace(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	inside := filepath.Join(root, "sub", "dir")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatalf("mkdir inside: %v", err)
	}

	r := &run{fsRoot: root}

	t.Run("virtual root slash", func(t *testing.T) {
		t.Parallel()
		realPath, virtualPath, err := r.resolvePathInWorkspace("/")
		if err != nil {
			t.Fatalf("resolvePathInWorkspace: %v", err)
		}
		if filepath.Clean(realPath) != filepath.Clean(root) {
			t.Fatalf("real_path=%q, want %q", realPath, root)
		}
		if virtualPath != "/" {
			t.Fatalf("virtual_path=%q, want /", virtualPath)
		}
	})

	t.Run("relative path mapped to virtual", func(t *testing.T) {
		t.Parallel()
		realPath, virtualPath, err := r.resolvePathInWorkspace("sub/dir")
		if err != nil {
			t.Fatalf("resolvePathInWorkspace: %v", err)
		}
		if filepath.Clean(realPath) != filepath.Clean(inside) {
			t.Fatalf("real_path=%q, want %q", realPath, inside)
		}
		if virtualPath != "/sub/dir" {
			t.Fatalf("virtual_path=%q, want /sub/dir", virtualPath)
		}
	})

	t.Run("host absolute path inside root", func(t *testing.T) {
		t.Parallel()
		realPath, virtualPath, err := r.resolvePathInWorkspace(inside)
		if err != nil {
			t.Fatalf("resolvePathInWorkspace: %v", err)
		}
		if filepath.Clean(realPath) != filepath.Clean(inside) {
			t.Fatalf("real_path=%q, want %q", realPath, inside)
		}
		if virtualPath != "/sub/dir" {
			t.Fatalf("virtual_path=%q, want /sub/dir", virtualPath)
		}
	})
}

func TestToolFSListDir_UsesVirtualRootModel(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	r := &run{fsRoot: root}

	out, err := r.toolFSListDir("/")
	if err != nil {
		t.Fatalf("toolFSListDir: %v", err)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type: %T", out)
	}
	entries, _ := m["entries"].([]map[string]any)
	if len(entries) == 0 {
		// []any in JSON-like maps is common; fallback decode.
		listAny, _ := m["entries"].([]any)
		if len(listAny) == 0 {
			t.Fatalf("expected at least one entry under virtual root")
		}
	}
}

func TestToolTerminalExec_CwdRules(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	r := &run{fsRoot: root, shell: "bash"}

	t.Run("empty cwd falls back to workspace root", func(t *testing.T) {
		t.Parallel()
		out, err := r.toolTerminalExec(context.Background(), "pwd", "", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		stdout := strings.TrimSpace(anyToString(m["stdout"]))
		if filepath.Clean(stdout) != filepath.Clean(root) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, root)
		}
	})

	t.Run("virtual slash cwd maps to workspace root", func(t *testing.T) {
		t.Parallel()
		out, err := r.toolTerminalExec(context.Background(), "pwd", "/", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		stdout := strings.TrimSpace(anyToString(m["stdout"]))
		if filepath.Clean(stdout) != filepath.Clean(root) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, root)
		}
	})
}
