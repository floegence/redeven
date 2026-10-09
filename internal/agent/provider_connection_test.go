package agent

import (
	"context"
	"encoding/json"
	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"path/filepath"
	"testing"
	"time"
)

func TestProviderConnectionDoesNotInferOnlineFromSavedBinding(t *testing.T) {
	cfg := cloudLinkRemoteConfig(t, filepath.Join(t.TempDir(), "config.json"))
	for i := range cfg.ControlArtifactPool.Entries {
		cfg.ControlArtifactPool.Entries[i].ExpiresAtUnixS = time.Now().Add(-72 * time.Hour).Unix()
	}
	a := &Agent{cfg: cfg, remoteEnabled: true, controlChannelEnabled: true, effectiveRunMode: "hybrid"}
	encoded, err := json.Marshal(a.CloudLinkBinding())
	if err != nil {
		t.Fatal(err)
	}
	var binding map[string]any
	if err := json.Unmarshal(encoded, &binding); err != nil {
		t.Fatal(err)
	}
	if binding["state"] != "linked" {
		t.Fatalf("saved binding was lost: %s", encoded)
	}
	if binding["connection_state"] != "authorization_required" || binding["last_error_code"] != "CONTROL_CREDENTIALS_EXPIRED" {
		t.Fatalf("expired credentials need explicit recovery, not inferred online: %s", encoded)
	}
}

func TestProviderRefreshRejectsStaleMatchingBinding(t *testing.T) {
	cfg := cloudLinkRemoteConfig(t, filepath.Join(t.TempDir(), "config.json"))
	a := &Agent{cfg: cfg}
	err := a.cloudLinkCanReplaceCurrentLocked(CloudLinkRequest{
		CloudOrigin: cfg.CloudOrigin, CloudID: cfg.CloudID,
		EnvPublicID:         cfg.EnvironmentID,
		ExpectedCloudOrigin: cfg.CloudOrigin, ExpectedCloudID: cfg.CloudID,
		ExpectedEnvPublicID: cfg.EnvironmentID, ExpectedAccessPointOrigin: cfg.AccessPointOrigin,
		ExpectedGeneration: cfg.BindingGeneration + 1,
	})
	if err == nil {
		t.Fatal("stale refresh must not change a newer saved binding")
	}
}

func TestProviderConnectionRecoveryBoundaries(t *testing.T) {
	cfg := cloudLinkRemoteConfig(t, filepath.Join(t.TempDir(), "config.json"))
	for i := range cfg.ControlArtifactPool.Entries {
		cfg.ControlArtifactPool.Entries[i].Spent = true
	}
	cases := []struct {
		name       string
		setup      func(*Agent)
		want, code string
	}{
		{"live session with empty reserve", func(a *Agent) { a.controlRegistered = true; a.controlRPC = &providerDisconnectFakeRPC{} }, "connected", ""},
		{"disabled preserves local work", func(a *Agent) { a.remoteEnabled = false }, "disabled", ""},
		{"terminal transport failure is not credential expiry", func(a *Agent) { a.controlFailure = &flowersec.ConnectionDiagnostic{State: flowersec.ConnectionFailed} }, "error", "CONTROL_CONNECTION_FAILED"},
		{"exhaustion can renew", func(a *Agent) {
			a.controlFailure = &flowersec.ConnectionDiagnostic{State: flowersec.ConnectionFailed}
			a.controlCredentialsUnavailable = true
		}, "authorization_required", "CONTROL_CREDENTIALS_EXHAUSTED"},
		{"rejected registration requires review", func(a *Agent) { a.controlBusinessRejected = true }, "authorization_required", "CONTROL_RELINK_REQUIRED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := &Agent{cfg: cfg, remoteEnabled: true, controlChannelEnabled: true}
			tc.setup(a)
			state, code, _ := a.providerConnectionLocked()
			if state != tc.want || code != tc.code {
				t.Fatalf("got %s/%s, want %s/%s", state, code, tc.want, tc.code)
			}
		})
	}
}

type waitingProviderArtifactSource struct{ entered chan struct{} }

func (source waitingProviderArtifactSource) Acquire(ctx context.Context) (flowersec.ArtifactLease, *flowersec.ArtifactSourceError) {
	close(source.entered)
	<-ctx.Done()
	return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(ctx.Err())
}

func TestProviderConnectionDoesNotRenewDuringLastArtifactAttempt(t *testing.T) {
	cfg := cloudLinkRemoteConfig(t, filepath.Join(t.TempDir(), "config.json"))
	for i := range cfg.ControlArtifactPool.Entries {
		cfg.ControlArtifactPool.Entries[i].Spent = true
	}
	source := waitingProviderArtifactSource{entered: make(chan struct{})}
	controller, err := flowersec.NewConnectionController(source, flowersec.ConnectionControllerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	controller.Start(ctx)
	defer func() { _ = controller.Close(context.Background()) }()
	select {
	case <-source.entered:
	case <-ctx.Done():
		t.Fatal("controller did not start")
	}
	a := &Agent{cfg: cfg, remoteEnabled: true, controlChannelEnabled: true, controlController: controller}
	state, code, _ := a.providerConnectionLocked()
	if state != "connecting" || code != "" {
		t.Fatalf("in-flight artifact must retain transport ownership: %s/%s", state, code)
	}
}
