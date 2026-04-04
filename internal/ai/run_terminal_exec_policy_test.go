package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

func TestResolveTerminalExecTimeoutDecision(t *testing.T) {
	t.Parallel()

	defaultDecision := resolveTerminalExecTimeoutDecision(nil, 0)
	if defaultDecision.EffectiveMS != 120_000 {
		t.Fatalf("default effective_ms=%d, want 120000", defaultDecision.EffectiveMS)
	}
	if defaultDecision.Source != terminalExecTimeoutSourceDefault {
		t.Fatalf("default source=%q, want %q", defaultDecision.Source, terminalExecTimeoutSourceDefault)
	}

	requestedDecision := resolveTerminalExecTimeoutDecision(nil, 45_000)
	if requestedDecision.EffectiveMS != 45_000 {
		t.Fatalf("requested effective_ms=%d, want 45000", requestedDecision.EffectiveMS)
	}
	if requestedDecision.Source != terminalExecTimeoutSourceRequested {
		t.Fatalf("requested source=%q, want %q", requestedDecision.Source, terminalExecTimeoutSourceRequested)
	}

	cappedDecision := resolveTerminalExecTimeoutDecision(nil, 700_000)
	if cappedDecision.EffectiveMS != 600_000 {
		t.Fatalf("capped effective_ms=%d, want 600000", cappedDecision.EffectiveMS)
	}
	if cappedDecision.Source != terminalExecTimeoutSourceCapped {
		t.Fatalf("capped source=%q, want %q", cappedDecision.Source, terminalExecTimeoutSourceCapped)
	}

	customCfg := &config.AIConfig{
		TerminalExecPolicy: &config.AITerminalExecPolicy{
			DefaultTimeoutMS: intPtr(30_000),
			MaxTimeoutMS:     intPtr(90_000),
		},
	}
	customDecision := resolveTerminalExecTimeoutDecision(customCfg, 0)
	if customDecision.EffectiveMS != 30_000 {
		t.Fatalf("custom effective_ms=%d, want 30000", customDecision.EffectiveMS)
	}
	if customDecision.MaxMS != 90_000 {
		t.Fatalf("custom max_ms=%d, want 90000", customDecision.MaxMS)
	}
}

func TestToolTerminalExec_IncludesEffectiveTimeoutMetadata(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	resolvedWorkspace, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		resolvedWorkspace = workspace
	}
	r := &run{
		agentHomeDir: workspace,
		workingDir:   workspace,
		shell:        "bash",
		cfg: &config.AIConfig{
			TerminalExecPolicy: &config.AITerminalExecPolicy{
				MaxTimeoutMS: intPtr(30_000),
			},
		},
		terminalExecRunner: func(ctx context.Context, inv terminalExecInvocation) (terminalExecOutcome, error) {
			if strings.TrimSpace(inv.WorkingDirAbs) != resolvedWorkspace {
				t.Fatalf("working_dir_abs=%q, want %q", inv.WorkingDirAbs, resolvedWorkspace)
			}
			return terminalExecOutcome{Stdout: "ok", ExitCode: 0, DurationMS: 5}, nil
		},
	}

	got, err := r.toolTerminalExec(context.Background(), "printf ok", "", "", 0)
	if err != nil {
		t.Fatalf("toolTerminalExec: %v", err)
	}
	result, _ := got.(map[string]any)
	if result == nil {
		t.Fatalf("result must be a map")
	}
	if timeoutMS := readInt64Field(result, "timeout_ms", "timeoutMs"); timeoutMS != 30_000 {
		t.Fatalf("timeout_ms=%d, want 30000", timeoutMS)
	}
	if requestedTimeoutMS := readInt64Field(result, "requested_timeout_ms", "requestedTimeoutMs"); requestedTimeoutMS != 0 {
		t.Fatalf("requested_timeout_ms=%d, want 0", requestedTimeoutMS)
	}
	if source := strings.TrimSpace(anyToString(result["timeout_source"])); source != terminalExecTimeoutSourceDefault {
		t.Fatalf("timeout_source=%q, want %q", source, terminalExecTimeoutSourceDefault)
	}
}

func TestDefaultTerminalExecRunner_TimeoutKillsChildProcessTree(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("process-group timeout regression is only asserted on Unix in this test")
	}

	workspace := t.TempDir()
	markerPath := filepath.Join(workspace, "child-survived.txt")
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()

	command := "(sleep 0.2; printf child > " + shellSingleQuote(markerPath) + ") & wait"
	outcome, err := defaultTerminalExecRunner(ctx, terminalExecInvocation{
		Shell:         "/bin/bash",
		Command:       command,
		WorkingDirAbs: workspace,
		Env:           os.Environ(),
	})
	if err != nil {
		t.Fatalf("defaultTerminalExecRunner: %v", err)
	}
	if !outcome.TimedOut {
		t.Fatalf("TimedOut=%v, want true", outcome.TimedOut)
	}
	if outcome.ExitCode != 124 {
		t.Fatalf("ExitCode=%d, want 124", outcome.ExitCode)
	}

	time.Sleep(300 * time.Millisecond)
	if _, statErr := os.Stat(markerPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected child marker file to stay absent, stat err=%v", statErr)
	}
}

func shellSingleQuote(raw string) string {
	return "'" + strings.ReplaceAll(raw, "'", `'"'"'`) + "'"
}

func intPtr(v int) *int {
	return &v
}
