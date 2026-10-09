package agent

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestControlChannelAcceptsPlatformTrustRoots(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	cfg := cloudLinkRemoteConfig(t, configPath)
	// Exhaustion terminates acquisition without making any network request.
	cfg.ControlArtifactPool.Entries = nil
	if err := cfg.ValidateRemoteStrict(); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	a := &Agent{
		cfg: cfg, configPath: configPath, stateDir: t.TempDir(),
		log:           slog.New(slog.NewTextHandler(&logs, nil)),
		controlCancel: func() {},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	a.runControlLoop(ctx)
	if !strings.Contains(logs.String(), "control channel failed") || strings.Contains(logs.String(), "control channel not started") {
		t.Fatalf("control channel did not reach artifact acquisition with platform trust: %s", logs.String())
	}
}

func TestStartControlChannelWaitsForPreviousOwner(t *testing.T) {
	previousDone := make(chan struct{})
	previousCanceled := make(chan struct{})
	a := &Agent{
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		controlCancel: func() {
			close(previousCanceled)
		},
		controlLoopDone: previousDone,
	}

	started := make(chan struct{})
	go func() {
		a.startControlChannel(context.Background())
		close(started)
	}()

	select {
	case <-previousCanceled:
	case <-time.After(time.Second):
		t.Fatal("previous control owner was not canceled")
	}
	select {
	case <-started:
		t.Fatal("replacement control owner started before the previous owner exited")
	case <-time.After(25 * time.Millisecond):
	}

	close(previousDone)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("replacement control owner did not start after the previous owner exited")
	}
	a.stopControlChannel()
}
