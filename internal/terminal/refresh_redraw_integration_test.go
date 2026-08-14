//go:build floeterm_native

package terminal

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
)

func TestSameSizeReattachBootstrapsLatestAtomicFullscreenPresentation(t *testing.T) {
	root := t.TempDir()
	shellPath := filepath.Join(root, "fullscreen-shell.sh")
	if err := os.WriteFile(shellPath, []byte("#!/bin/sh\nprintf '\\033[?1049h\\033[2J\\033[HFLOETERM_FULLSCREEN_READY\\n'\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n"), 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	manager := NewManager(shellPath, root, nil)
	t.Cleanup(manager.Cleanup)
	session, err := manager.term.CreateSession("fullscreen-refresh", manager.agentHomeAbs)
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	attachSemanticTestView := func(generation uint64) termgo.LiveConnectionAttachment {
		t.Helper()
		if err := session.AttachSemanticView("view", "local", generation); err != nil {
			t.Fatalf("AttachSemanticView(%d) error = %v", generation, err)
		}
		session.EnsureSemanticController("view", "local", generation)
		attachment, err := session.AttachSemanticLiveConnection("view", generation, 100, 30, termgo.LiveSubscriber{})
		if err != nil {
			t.Fatalf("AttachSemanticLiveConnection(%d) error = %v", generation, err)
		}
		if err := manager.activateSessionFunc(context.Background(), session.ID, 100, 30); err != nil {
			t.Fatalf("ActivateSessionContext(%d) error = %v", generation, err)
		}
		if _, err := session.ApplySemanticControllerSize("view", 100, 30, true); err != nil {
			t.Fatalf("ApplySemanticControllerSize(%d) error = %v", generation, err)
		}
		return attachment
	}

	first := attachSemanticTestView(1)
	waitForSemanticPresentationText(t, session, "FLOETERM_FULLSCREEN_READY", 3*time.Second)
	first.Detach()
	session.LogicalDetachSemanticView("view", 1)

	second := attachSemanticTestView(2)
	t.Cleanup(func() {
		second.Detach()
		session.LogicalDetachSemanticView("view", 2)
	})
	if got := semanticFrameText(second.Presentation.Frame); !strings.Contains(got, "FLOETERM_FULLSCREEN_READY") {
		t.Fatalf("reattach bootstrap lost fullscreen presentation: %q", got)
	}
}

func waitForSemanticPresentationText(t *testing.T, session *termgo.Session, marker string, timeout time.Duration) termgo.SemanticPresentation {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if presentation, ok := session.LatestPresentation(); ok && strings.Contains(semanticFrameText(presentation.Frame), marker) {
			return presentation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for semantic presentation marker %q", marker)
	return termgo.SemanticPresentation{}
}

func semanticFrameText(frame termgo.SemanticFrame) string {
	var output strings.Builder
	for _, row := range frame.Rows {
		for _, cell := range row.Cells {
			output.WriteString(cell.Text)
		}
		output.WriteByte('\n')
	}
	return output.String()
}
