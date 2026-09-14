package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type virtualDesktopRecordingExecutor struct{ calls []TargetToolCall }

func (e *virtualDesktopRecordingExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.calls = append(e.calls, call)
	return TargetToolResult{TargetID: call.TargetID}, nil
}

func TestXvfbTargetExecutorRequiresStartedDisplay(t *testing.T) {
	inner := &virtualDesktopRecordingExecutor{}
	e := &XvfbTargetExecutor{Inner: inner}
	_, err := e.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "xvfb.desktop", ToolName: "computer.screenshot"})
	if err == nil || !strings.Contains(err.Error(), "not started") {
		t.Fatalf("err=%v", err)
	}
}

func TestXvfbTargetExecutorStartsWithAbsoluteDisplayAndReapsProcess(t *testing.T) {
	bin := t.TempDir()
	xvfb := filepath.Join(bin, "Xvfb")
	if err := os.WriteFile(xvfb, []byte("#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	e := &XvfbTargetExecutor{Display: ":123", Inner: &virtualDesktopRecordingExecutor{}}
	if err := e.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := e.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "xvfb.desktop", ToolName: "computer.screenshot"}); err != nil {
		t.Fatal(err)
	}
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	if e.process != nil || e.process != nil && e.process.ProcessState == nil {
		t.Fatal("Xvfb process was not reaped")
	}
}
