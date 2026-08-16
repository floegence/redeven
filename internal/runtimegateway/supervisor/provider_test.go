package supervisor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/security"
)

type staticRuntimeValidationRefresher struct {
	validation RuntimeValidation
}

func (refresher staticRuntimeValidationRefresher) RefreshRuntimeValidation(context.Context) (RuntimeValidation, error) {
	return refresher.validation, nil
}

func TestParseEnrollmentCodeExtractsPublicProofScope(t *testing.T) {
	scope, err := ParseEnrollmentCode("rec_demo.7.rpn_demo.ren_secret")
	if err != nil {
		t.Fatal(err)
	}
	if scope.ChallengeID != "rec_demo" || scope.ControlBindingGeneration != 7 || scope.ProofNonce != "rpn_demo" {
		t.Fatalf("enrollment code scope = %#v", scope)
	}
	for _, invalid := range []string{"", "ren_secret", "rec_demo.-1.rpn_demo.ren_secret", "rec_demo.7.bad.ren_secret"} {
		if _, err := ParseEnrollmentCode(invalid); err == nil {
			t.Fatalf("ParseEnrollmentCode(%q) succeeded", invalid)
		}
	}
}

func TestProviderHeartbeatAllowsIndependentCompatibleComponentVersions(t *testing.T) {
	store, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), filepath.Join(t.TempDir(), "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	binding := store.Binding()
	var received providerHeartbeatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != providerHeartbeatPathPrefix+"binding_demo/heartbeat" {
			t.Errorf("heartbeat path = %q", request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Error(err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		payload, err := canonicalProviderHeartbeatPayload(received)
		if err != nil || !security.VerifySignature(binding.SupervisorPublicKey, payload, received.Signature) {
			t.Errorf("heartbeat signature is invalid: %v", err)
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(providerHeartbeatResponse{ProtocolVersion: EnrollmentProtocolVersion, AcceptedAtUnixMS: 1000})
	}))
	defer server.Close()
	if err := store.ConfigureProvider(
		"binding_demo", server.URL, "access_point_demo", server.URL, "env_demo",
		PermitVerificationKey{KeyID: "permit_demo", Algorithm: "EdDSA", PublicKey: binding.SupervisorPublicKey},
		binding.TargetGeneration,
	); err != nil {
		t.Fatal(err)
	}
	validation := RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	if err := SendProviderHeartbeat(t.Context(), server.Client(), store, "gateway-12.0", validation); err != nil {
		t.Fatal(err)
	}
	if received.GatewayVersion != "gateway-12.0" || received.RuntimeBinaryVersion != "runtime-11.0" {
		t.Fatalf("component versions = Gateway %q Runtime %q", received.GatewayVersion, received.RuntimeBinaryVersion)
	}
}

func TestEnrollProviderExchangesOneTimeCodeAndPersistsBinding(t *testing.T) {
	store, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), filepath.Join(t.TempDir(), "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	binding := store.Binding()
	validation := RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	requests := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case providerEnrollmentExchangePath:
			var exchange providerEnrollmentExchangeRequest
			if err := json.NewDecoder(request.Body).Decode(&exchange); err != nil {
				t.Error(err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			proof := EnrollmentProofRequest{
				ProtocolVersion: exchange.ProtocolVersion, ChallengeID: exchange.ChallengeID, ProofNonce: exchange.ProofNonce,
				EnvironmentPublicID: exchange.EnvPublicID, ControlBindingGeneration: exchange.ControlBindingGeneration,
				LifecycleTargetID: exchange.LifecycleTargetID, TargetGeneration: exchange.TargetGeneration,
				SupervisorInstanceID: exchange.SupervisorInstanceID, SupervisorPublicKey: exchange.SupervisorPublicKey,
				InstallationRootDigest: exchange.InstallationRootDigest,
			}
			payload, err := CanonicalEnrollmentProofPayload(proof)
			if err != nil || !security.VerifySignature(binding.SupervisorPublicKey, payload, exchange.SupervisorProofSignature) {
				t.Errorf("exchange supervisor proof is invalid: %v", err)
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(writer).Encode(providerEnrollmentExchangeResponse{
				ProtocolVersion: EnrollmentProtocolVersion,
				Binding: providerEnrollmentBinding{
					BindingID: "binding_demo", ProviderOrigin: server.URL, AccessPointID: "access_point_demo", AccessPointOrigin: server.URL,
					EnvPublicID: exchange.EnvPublicID, LifecycleTargetID: exchange.LifecycleTargetID,
					TargetGeneration: exchange.TargetGeneration, SupervisorInstanceID: exchange.SupervisorInstanceID,
					InstallationRootDigest: exchange.InstallationRootDigest, GatewayVersion: exchange.GatewayVersion,
					GatewayProtocol: exchange.GatewayProtocol, RuntimeBinaryVersion: exchange.RuntimeBinaryVersion,
					RuntimeServiceProtocol: exchange.RuntimeServiceProtocol, CompatibilityEpoch: exchange.CompatibilityEpoch,
					Capabilities: exchange.Capabilities, RuntimeArtifactSHA256: exchange.RuntimeArtifactSHA256,
					PermitVerificationKey: PermitVerificationKey{KeyID: "permit_demo", Algorithm: "EdDSA", PublicKey: binding.SupervisorPublicKey},
				},
			})
		case providerHeartbeatPathPrefix + "binding_demo/heartbeat":
			var heartbeat providerHeartbeatRequest
			if err := json.NewDecoder(request.Body).Decode(&heartbeat); err != nil {
				t.Error(err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			payload, err := canonicalProviderHeartbeatPayload(heartbeat)
			if err != nil || !security.VerifySignature(binding.SupervisorPublicKey, payload, heartbeat.Signature) {
				t.Errorf("initial heartbeat proof is invalid: %v", err)
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(writer).Encode(providerHeartbeatResponse{ProtocolVersion: EnrollmentProtocolVersion, AcceptedAtUnixMS: 1000})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	result, err := EnrollProvider(t.Context(), ProviderEnrollmentOptions{
		AccessPointOrigin: server.URL, EnvironmentID: "env_demo",
		EnrollmentCode: "rec_demo.0.rpn_demo.ren_secret", GatewayVersion: "gateway-12.0",
		BindingStore: store, Controller: staticRuntimeValidationRefresher{validation: validation}, HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("Provider requests = %d, want exchange and initial heartbeat", requests)
	}
	if result.BindingID != "binding_demo" || result.AccessPointOrigin != server.URL || result.EnvironmentPublicID != "env_demo" {
		t.Fatalf("persisted Provider binding = %#v", result)
	}
}

func TestEnrollProviderRebindAdvancesTargetGeneration(t *testing.T) {
	store, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), filepath.Join(t.TempDir(), "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	initial := store.Binding()
	validation := RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: strings.Repeat("a", 64),
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case providerEnrollmentExchangePath:
			var exchange providerEnrollmentExchangeRequest
			if err := json.NewDecoder(request.Body).Decode(&exchange); err != nil {
				t.Error(err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(writer).Encode(providerEnrollmentExchangeResponse{
				ProtocolVersion: EnrollmentProtocolVersion,
				Binding: providerEnrollmentBinding{
					BindingID: "binding_demo", ProviderOrigin: server.URL, AccessPointID: "access_point_demo", AccessPointOrigin: server.URL,
					EnvPublicID: exchange.EnvPublicID, LifecycleTargetID: exchange.LifecycleTargetID,
					TargetGeneration: exchange.TargetGeneration, SupervisorInstanceID: exchange.SupervisorInstanceID,
					InstallationRootDigest: exchange.InstallationRootDigest, GatewayVersion: exchange.GatewayVersion,
					GatewayProtocol: exchange.GatewayProtocol, RuntimeBinaryVersion: exchange.RuntimeBinaryVersion,
					RuntimeServiceProtocol: exchange.RuntimeServiceProtocol, CompatibilityEpoch: exchange.CompatibilityEpoch,
					Capabilities: exchange.Capabilities, RuntimeArtifactSHA256: exchange.RuntimeArtifactSHA256,
					PermitVerificationKey: PermitVerificationKey{KeyID: "permit_demo", Algorithm: "EdDSA", PublicKey: initial.SupervisorPublicKey},
				},
			})
		case providerHeartbeatPathPrefix + "binding_demo/heartbeat":
			_ = json.NewEncoder(writer).Encode(providerHeartbeatResponse{ProtocolVersion: EnrollmentProtocolVersion, AcceptedAtUnixMS: 1000})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	options := ProviderEnrollmentOptions{
		AccessPointOrigin: server.URL, EnvironmentID: "env_demo", GatewayVersion: "gateway-12.0",
		BindingStore: store, Controller: staticRuntimeValidationRefresher{validation: validation}, HTTPClient: server.Client(),
	}
	options.EnrollmentCode = "rec_first.0.rpn_first.ren_first"
	first, err := EnrollProvider(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	options.EnrollmentCode = "rec_second.0.rpn_second.ren_second"
	second, err := EnrollProvider(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	if second.LifecycleTargetID != first.LifecycleTargetID || second.TargetGeneration != first.TargetGeneration+1 {
		t.Fatalf("rebind target = %s generation %d, want same target and generation %d", second.LifecycleTargetID, second.TargetGeneration, first.TargetGeneration+1)
	}
}

func TestBindingReloadPreservesProviderConfigurationAcrossRuntimeValidation(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "gateway")
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	runningStore, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	configurationStore, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	binding := configurationStore.Binding()
	if err := configurationStore.ConfigureProvider(
		"binding_demo", "https://provider.example", "access_point_demo", "https://region.example", "env_demo",
		PermitVerificationKey{KeyID: "permit_demo", Algorithm: "EdDSA", PublicKey: binding.SupervisorPublicKey},
		binding.TargetGeneration,
	); err != nil {
		t.Fatal(err)
	}
	if err := runningStore.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime_demo", RuntimeBinaryVersion: "runtime-11.0", ServiceProtocol: "redeven-runtime-v2",
		CompatibilityEpoch: 9, Capabilities: []string{"lifecycle_fence_v1"},
		ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}); err != nil {
		t.Fatal(err)
	}
	got := runningStore.Binding()
	if got.BindingID != "binding_demo" || got.AccessPointOrigin != "https://region.example" || got.ValidatedRuntime == nil {
		t.Fatalf("reloaded binding lost state: %#v", got)
	}
}
