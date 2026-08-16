package agent

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	gatewaysupervisor "github.com/floegence/redeven/internal/runtimegateway/supervisor"
)

func TestRuntimeEnrollmentProofUsesCurrentControlBindingAndLocalSupervisor(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	store, err := gatewaysupervisor.OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway-state"), runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	server, err := gatewaysupervisor.OpenEnrollmentProofServer(store, "env_demo")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- server.ServeOnce(ctx) }()

	binding := store.Binding()
	request := gatewaysupervisor.EnrollmentProofRequest{
		ProtocolVersion: gatewaysupervisor.EnrollmentProtocolVersion, ChallengeID: "challenge_demo", ProofNonce: "nonce_demo",
		EnvironmentPublicID: "env_demo", ControlBindingGeneration: 7,
		LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, SupervisorPublicKey: binding.SupervisorPublicKey,
		InstallationRootDigest: binding.InstallationRootDigest,
	}
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		cfg:      &config.Config{EnvironmentID: "env_demo", BindingGeneration: 7},
		stateDir: filepath.Join(runtimeRoot, "local-environment"),
	}
	result, rpcErr := agent.handleRuntimeEnrollmentProof(ctx, payload)
	if rpcErr != nil {
		t.Fatalf("handleRuntimeEnrollmentProof() RPC error = %#v", rpcErr)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
	response, ok := result.(gatewaysupervisor.EnrollmentProofResponse)
	if !ok {
		t.Fatalf("proof response type = %T", result)
	}
	canonical, err := gatewaysupervisor.CanonicalEnrollmentProofPayload(request)
	if err != nil {
		t.Fatal(err)
	}
	if !security.VerifySignature(binding.SupervisorPublicKey, canonical, response.Signature) {
		t.Fatal("Runtime relayed an invalid supervisor enrollment proof")
	}
}

func TestRuntimeEnrollmentProofRejectsStaleControlGenerationBeforeLocalIPC(t *testing.T) {
	request := gatewaysupervisor.EnrollmentProofRequest{
		ProtocolVersion:     gatewaysupervisor.EnrollmentProtocolVersion,
		EnvironmentPublicID: "env_demo", ControlBindingGeneration: 6,
	}
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		cfg:      &config.Config{EnvironmentID: "env_demo", BindingGeneration: 7},
		stateDir: filepath.Join(t.TempDir(), "local-environment"),
	}
	if _, rpcErr := agent.handleRuntimeEnrollmentProof(context.Background(), payload); rpcErr == nil || rpcErr.Code != 409 {
		t.Fatalf("stale control generation RPC error = %#v", rpcErr)
	}
}
