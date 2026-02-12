package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func canonicalPath(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil && strings.TrimSpace(resolved) != "" {
		return filepath.Clean(resolved)
	}
	return path
}

func TestResolveToolPath(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	target := filepath.Join(root, "sub", "dir")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}

	t.Run("accepts absolute path", func(t *testing.T) {
		t.Parallel()
		resolved, err := resolveToolPath(target, root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		if filepath.Clean(resolved) != filepath.Clean(target) {
			t.Fatalf("resolved=%q, want=%q", resolved, target)
		}
	})

	t.Run("resolves relative path against working_dir_abs", func(t *testing.T) {
		t.Parallel()
		resolved, err := resolveToolPath("sub/dir", root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		want := filepath.Join(root, "sub", "dir")
		if filepath.Clean(resolved) != filepath.Clean(want) {
			t.Fatalf("resolved=%q, want=%q", resolved, want)
		}
	})

	t.Run("expands tilde to home directory", func(t *testing.T) {
		t.Parallel()
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatalf("UserHomeDir: %v", err)
		}
		resolved, err := resolveToolPath("~/", root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		if filepath.Clean(resolved) != filepath.Clean(home) {
			t.Fatalf("resolved=%q, want home=%q", resolved, home)
		}
	})
}

func TestToolTerminalExec_CwdRules(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	r := &run{fsRoot: workingDir, shell: "bash"}

	t.Run("empty cwd falls back to working_dir_abs", func(t *testing.T) {
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
		if canonicalPath(stdout) != canonicalPath(workingDir) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, workingDir)
		}
	})

	t.Run("relative cwd resolves against working_dir_abs", func(t *testing.T) {
		t.Parallel()
		subdir := filepath.Join(workingDir, "subdir")
		if err := os.MkdirAll(subdir, 0o755); err != nil {
			t.Fatalf("mkdir subdir: %v", err)
		}
		out, err := r.toolTerminalExec(context.Background(), "pwd", "subdir", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		stdout := strings.TrimSpace(anyToString(m["stdout"]))
		if canonicalPath(stdout) != canonicalPath(subdir) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, subdir)
		}
	})
}

func TestToolApplyPatch_CreatesFile(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	r := &run{fsRoot: workingDir}
	patch := strings.Join([]string{
		"diff --git a/note.txt b/note.txt",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/note.txt",
		"@@ -0,0 +1 @@",
		"+hello patch",
	}, "\n")
	out, err := r.toolApplyPatch(context.Background(), patch)
	if err != nil {
		t.Fatalf("toolApplyPatch: %v", err)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type: %T", out)
	}
	if got := int(m["files_changed"].(int)); got != 1 {
		t.Fatalf("files_changed=%d, want 1", got)
	}
	got, err := os.ReadFile(filepath.Join(workingDir, "note.txt"))
	if err != nil {
		t.Fatalf("read patched file: %v", err)
	}
	if strings.TrimSpace(string(got)) != "hello patch" {
		t.Fatalf("content=%q, want %q", string(got), "hello patch")
	}
}

func TestPrependRedevenBinToEnv_AddsPath(t *testing.T) {
	t.Parallel()

	home := filepath.Join(t.TempDir(), "home")
	env := prependRedevenBinToEnv([]string{
		"HOME=" + home,
		"PATH=/usr/local/bin:/usr/bin",
	})
	pathVal := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			pathVal = strings.TrimPrefix(kv, "PATH=")
			break
		}
	}
	if pathVal == "" {
		t.Fatalf("PATH missing from env output")
	}
	wantPrefix := filepath.Join(home, ".redeven", "bin")
	if !strings.HasPrefix(pathVal, wantPrefix+string(os.PathListSeparator)) {
		t.Fatalf("PATH=%q, want prefix %q", pathVal, wantPrefix)
	}
}
