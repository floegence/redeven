package agent

import (
	"bytes"
	"context"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
)

func TestControlChannelAcceptsPlatformTrustRoots(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	cfg := cloudLinkRemoteConfig(t, configPath)
	// A local untrusted endpoint exercises platform trust without external DNS
	// or credentials. Its TLS failure remains under the controller retry owner.
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("untrusted platform TLS connection reached HTTP")
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	cfg.CloudOrigin, cfg.CloudAssociation.CloudOrigin = server.URL, server.URL
	cfg.ControlArtifactPool.Entries = nil
	if err := config.Save(configPath, cfg); err != nil {
		t.Fatal(err)
	}
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
	a.onControlRetry = func(flowersec.ConnectionDiagnostic, time.Duration) { cancel() }
	a.runControlLoop(ctx)
	if !strings.Contains(logs.String(), "Flowersec is retrying") || strings.Contains(logs.String(), "control channel not started") {
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
