package terminal

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
)

func TestSameSizeReattachRedrawsFullscreenAppAfterHistoryEviction(t *testing.T) {
	root := t.TempDir()
	shellPath := filepath.Join(root, "fullscreen-shell.sh")
	script := `#!/bin/sh
trap 'printf "\033[?1049h\033[2J\033[HFLOETERM_TOP_REDRAW\n"' WINCH
printf "\033[?1049h\033[2J\033[HFLOETERM_TOP_INITIAL\n"
i=1
while [ "$i" -le 8 ]; do
  sleep 0.03
  printf "\033[%s;1HFLOETERM_TOP_DELTA_%s\n" "$i" "$i"
  i=$((i + 1))
done
printf "FLOETERM_TOP_READY\n"
while :; do read -r line; done
`
	if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile(%q): %v", shellPath, err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
	manager := NewManager(shellPath, root, logger)
	manager.term.Cleanup()
	config := newTerminalGoManagerConfig(shellPath, logger)
	config.HistoryBufferSize = 3
	config.HistoryBufferMaxChunks = 3
	config.HistoryBufferMaxBytes = 64 * 1024
	manager.term = termgo.NewManager(config)
	manager.activateSessionFunc = manager.term.ActivateSessionContext
	t.Cleanup(manager.Cleanup)

	session, err := manager.term.CreateSession("fullscreen-refresh", root)
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	initialOutput := make(chan termgo.TerminalOutputEvent, 32)
	initialAttachment, err := session.AttachLiveConnection("view", 1, 100, 30, termgo.LiveSubscriber{
		OnOutput: func(event termgo.TerminalOutputEvent) bool {
			initialOutput <- event
			return true
		},
	})
	if err != nil {
		t.Fatalf("AttachLiveConnection(initial) error = %v", err)
	}
	defer initialAttachment.Detach()
	if err := manager.activateSessionFunc(context.Background(), session.ID, 100, 30); err != nil {
		t.Fatalf("ActivateSessionContext() error = %v", err)
	}
	if _, err := session.ApplyConnectionSize("view", 100, 30); err != nil {
		t.Fatalf("ApplyConnectionSize(initial) error = %v", err)
	}
	waitForTerminalOutputMarker(t, initialOutput, "FLOETERM_TOP_READY")

	page, err := session.GetHistoryPage(termgo.HistoryPageOptions{StartSeq: 1})
	if err != nil {
		t.Fatalf("GetHistoryPage() error = %v", err)
	}
	if !page.HistoryTruncated || page.FirstRetainedSequence <= 1 {
		t.Fatalf("expected the fullscreen bootstrap to be evicted, got %+v", page)
	}
	var retained strings.Builder
	for _, chunk := range page.Chunks {
		retained.Write(chunk.Data)
	}
	if strings.Contains(retained.String(), "FLOETERM_TOP_INITIAL") ||
		strings.Contains(retained.String(), "FLOETERM_TOP_REDRAW") {
		t.Fatalf("retained history still contains a complete fullscreen frame: %q", retained.String())
	}

	refreshedOutput := make(chan termgo.TerminalOutputEvent, 8)
	refreshedAttachment, err := session.AttachLiveConnection("view", 2, 100, 30, termgo.LiveSubscriber{
		OnOutput: func(event termgo.TerminalOutputEvent) bool {
			refreshedOutput <- event
			return true
		},
	})
	if err != nil {
		t.Fatalf("AttachLiveConnection(refresh) error = %v", err)
	}
	defer refreshedAttachment.Detach()
	if err := manager.activateSessionFunc(context.Background(), session.ID, 100, 30); err != nil {
		t.Fatalf("ActivateSessionContext(refresh) error = %v", err)
	}
	if _, err := session.ApplyConnectionSize("view", 100, 30); err != nil {
		t.Fatalf("ApplyConnectionSize(refresh) error = %v", err)
	}

	event := waitForTerminalOutputMarker(t, refreshedOutput, "FLOETERM_TOP_REDRAW")
	if event.Sequence <= refreshedAttachment.HistoryBoundarySequence {
		t.Fatalf(
			"redraw sequence=%d must follow attach history boundary=%d",
			event.Sequence,
			refreshedAttachment.HistoryBoundarySequence,
		)
	}
}

func waitForTerminalOutputMarker(
	t *testing.T,
	events <-chan termgo.TerminalOutputEvent,
	marker string,
) termgo.TerminalOutputEvent {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case event := <-events:
			if strings.Contains(string(event.Data), marker) {
				return event
			}
		case <-deadline.C:
			t.Fatalf("timeout waiting for terminal output marker %q", marker)
		}
	}
}
