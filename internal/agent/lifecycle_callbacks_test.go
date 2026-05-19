package agent

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

func TestRunCallsControlDisabledCallback(t *testing.T) {
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	called := make(chan struct{}, 1)
	a, err := New(Options{
		Config: &config.Config{
			AgentHomeDir:     t.TempDir(),
			PermissionPolicy: policy,
		},
		ConfigPath:            t.TempDir() + "/config.json",
		LocalUIEnabled:        true,
		ControlChannelEnabled: false,
		Version:               "test",
		OnControlDisabled:     func() { called <- struct{}{} },
		OnControlConnecting:   func() { t.Fatalf("OnControlConnecting should not run when control channel is disabled") },
		OnControlRetry:        func(error, time.Duration) { t.Fatalf("OnControlRetry should not run when control channel is disabled") },
		OnControlConnected:    func() { t.Fatalf("OnControlConnected should not run when control channel is disabled") },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- a.Run(ctx)
	}()

	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatalf("OnControlDisabled was not called")
	}
	cancel()
	if err := <-errCh; !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context.Canceled", err)
	}
}
