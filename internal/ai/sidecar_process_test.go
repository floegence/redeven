package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFakeNodeBinary(t *testing.T, path string, version string) {
	t.Helper()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"-v\" ]; then\n" +
		"  echo \"" + version + "\"\n" +
		"  exit 0\n" +
		"fi\n" +
		"exit 0\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for fake node: %v", err)
	}
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake node: %v", err)
	}
}

func TestResolveAISidecarNodeBinPrefersEnvOverride(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	binDir := t.TempDir()
	overrideNode := filepath.Join(binDir, "node-override")
	pathNode := filepath.Join(binDir, "node")
	writeFakeNodeBinary(t, overrideNode, "v20.20.0")
	writeFakeNodeBinary(t, pathNode, "v22.0.0")

	t.Setenv("PATH", binDir)
	t.Setenv(aiSidecarNodeEnvVar, overrideNode)

	got, err := resolveAISidecarNodeBin(t.TempDir())
	if err != nil {
		t.Fatalf("resolveAISidecarNodeBin() error = %v", err)
	}
	if got != overrideNode {
		t.Fatalf("resolveAISidecarNodeBin() = %q, want %q", got, overrideNode)
	}
}

func TestResolveAISidecarNodeBinFallsBackToStaticRuntime(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv(aiSidecarNodeEnvVar, "")

	binDir := t.TempDir()
	pathNode := filepath.Join(binDir, "node")
	writeFakeNodeBinary(t, pathNode, "v18.20.0")
	t.Setenv("PATH", binDir)

	stateDir := t.TempDir()
	staticNode := filepath.Join(stateDir, "runtime", "node", "current", "bin", "node")
	writeFakeNodeBinary(t, staticNode, "v20.20.0")

	got, err := resolveAISidecarNodeBin(stateDir)
	if err != nil {
		t.Fatalf("resolveAISidecarNodeBin() error = %v", err)
	}
	if got != staticNode {
		t.Fatalf("resolveAISidecarNodeBin() = %q, want %q", got, staticNode)
	}
}

func TestResolveAISidecarNodeBinReturnsErrorWhenNoQualifiedNode(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv(aiSidecarNodeEnvVar, "")

	binDir := t.TempDir()
	pathNode := filepath.Join(binDir, "node")
	writeFakeNodeBinary(t, pathNode, "v18.20.0")
	t.Setenv("PATH", binDir)

	_, err := resolveAISidecarNodeBin(t.TempDir())
	if err == nil {
		t.Fatal("resolveAISidecarNodeBin() expected error, got nil")
	}
	if !strings.Contains(err.Error(), "node >= 20") {
		t.Fatalf("resolveAISidecarNodeBin() error = %q, want contains %q", err.Error(), "node >= 20")
	}
}

func TestParseNodeMajor(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		version string
		want    int
		ok      bool
	}{
		{name: "with v prefix", version: "v20.20.0", want: 20, ok: true},
		{name: "without v prefix", version: "22.1.0", want: 22, ok: true},
		{name: "empty", version: "", want: 0, ok: false},
		{name: "invalid", version: "node", want: 0, ok: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseNodeMajor(tt.version)
			if ok != tt.ok {
				t.Fatalf("parseNodeMajor(%q) ok = %v, want %v", tt.version, ok, tt.ok)
			}
			if got != tt.want {
				t.Fatalf("parseNodeMajor(%q) = %d, want %d", tt.version, got, tt.want)
			}
		})
	}
}

func TestParseRunIDFromSidecarLog(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		line string
		want string
	}{
		{
			name: "missing run id",
			line: "[ai-sidecar] event=ai.sidecar.run.start model=openai/gpt-5-mini",
			want: "",
		},
		{
			name: "plain value",
			line: "[ai-sidecar] event=ai.sidecar.run.start run_id=run_123 model=openai/gpt-5-mini",
			want: "run_123",
		},
		{
			name: "comma terminated",
			line: "[ai-sidecar] event=ai.sidecar.run.end run_id=run_123, delta_count=2",
			want: "run_123",
		},
		{
			name: "right bracket terminated",
			line: "[ai-sidecar] event=ai.sidecar.tool.result.recv [run_id=run_abc]",
			want: "run_abc",
		},
		{
			name: "empty value",
			line: "[ai-sidecar] event=ai.sidecar.run.end run_id=",
			want: "",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseRunIDFromSidecarLog(tt.line)
			if got != tt.want {
				t.Fatalf("parseRunIDFromSidecarLog(%q)=%q, want %q", tt.line, got, tt.want)
			}
		})
	}
}
