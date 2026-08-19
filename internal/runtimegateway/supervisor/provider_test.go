package supervisor

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

type staticRuntimeValidationRefresher struct {
	validation RuntimeValidation
}

type providerTransportExecutorFunc func(context.Context, gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest) gatewayprotocol.ProviderRuntimeManagementTunnelResponse

func (f providerTransportExecutorFunc) ExecuteProviderRuntimeManagement(ctx context.Context, request gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest) gatewayprotocol.ProviderRuntimeManagementTunnelResponse {
	return f(ctx, request)
}

func TestProviderRuntimeManagementTransportUsesBoundSupervisorWithoutRuntimeAgent(t *testing.T) {
	store, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), filepath.Join(t.TempDir(), "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	binding := store.Binding()
	wantForward := gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest{
		ProviderRuntimeManagementTunnelRequest: gatewayprotocol.ProviderRuntimeManagementTunnelRequest{
			ProtocolVersion: gatewayprotocol.ProviderRuntimeManagementProtocolVersion,
			EnvPublicID:     "env_demo", LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
			ClientKeyID: "gck_demo", Method: http.MethodPost, Route: "/gateway/v2/runtime-operations/list",
		},
		RuntimeGrants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	}
	wantResponse := gatewayprotocol.ProviderRuntimeManagementTunnelResponse{
		ProtocolVersion: gatewayprotocol.ProviderRuntimeManagementProtocolVersion,
		StatusCode:      http.StatusOK, ContentType: "application/json", BodyB64u: "e30",
	}
	completed := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case providerTransportPathPrefix + "binding_demo/transport/poll":
			var poll gatewayprotocol.ProviderRuntimeManagementTransportPollRequest
			if err := json.NewDecoder(request.Body).Decode(&poll); err != nil {
				t.Error(err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			payload, err := gatewayprotocol.CanonicalProviderRuntimeManagementTransportPollPayload(poll)
			if err != nil || !security.VerifySignature(binding.SupervisorPublicKey, string(payload), poll.Signature) {
				t.Errorf("transport poll signature is invalid: %v", err)
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(writer).Encode(gatewayprotocol.ProviderRuntimeManagementTransportPollResponse{
				ProtocolVersion: gatewayprotocol.ProviderRuntimeManagementProtocolVersion,
				RequestID:       "rmr_demo", Request: wantForward,
			})
		case providerTransportPathPrefix + "binding_demo/transport/respond":
			var response gatewayprotocol.ProviderRuntimeManagementTransportResponseRequest
			if err := json.NewDecoder(request.Body).Decode(&response); err != nil {
				t.Error(err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			payload, err := gatewayprotocol.CanonicalProviderRuntimeManagementTransportResponsePayload(response)
			body, decodeErr := base64.RawURLEncoding.DecodeString(response.ResponseB64u)
			digest := sha256.Sum256(body)
			if err != nil || decodeErr != nil || response.RequestID != "rmr_demo" || response.ResponseSHA256 != hex.EncodeToString(digest[:]) ||
				!security.VerifySignature(binding.SupervisorPublicKey, string(payload), response.Signature) {
				t.Errorf("transport response signature is invalid: %v / %v", err, decodeErr)
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			var got gatewayprotocol.ProviderRuntimeManagementTunnelResponse
			if err := json.Unmarshal(body, &got); err != nil || got != wantResponse {
				t.Errorf("transport response = %#v, error %v", got, err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			completed <- struct{}{}
			_ = json.NewEncoder(writer).Encode(gatewayprotocol.ProviderRuntimeManagementTransportResponse{
				ProtocolVersion: gatewayprotocol.ProviderRuntimeManagementProtocolVersion, AcceptedAtUnixMS: time.Now().UnixMilli(),
			})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	if err := store.ConfigureProvider(
		"binding_demo", server.URL, "access_point_demo", server.URL, "env_demo",
		PermitVerificationKey{KeyID: "permit_demo", Algorithm: "EdDSA", PublicKey: binding.SupervisorPublicKey},
		binding.TargetGeneration,
	); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	executed := make(chan gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest, 1)
	go MaintainProviderRuntimeManagementTransport(ctx, server.Client(), store, providerTransportExecutorFunc(func(_ context.Context, request gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest) gatewayprotocol.ProviderRuntimeManagementTunnelResponse {
		executed <- request
		return wantResponse
	}))
	select {
	case got := <-executed:
		if got.RuntimeGrants[0] != gatewayprotocol.RuntimeGrantManage || got.EnvPublicID != wantForward.EnvPublicID {
			t.Fatalf("executed request = %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Gateway did not execute the relayed Runtime management request")
	}
	select {
	case <-completed:
	case <-time.After(2 * time.Second):
		t.Fatal("Gateway did not return the signed Runtime management response")
	}
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
	validation := completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
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
	validation := completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
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
					RuntimePlatform: exchange.RuntimePlatform, RuntimeArchitecture: exchange.RuntimeArchitecture,
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
	validation := completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime_instance_demo", RuntimeBinaryVersion: "runtime-11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: strings.Repeat("a", 64),
	})
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
					RuntimePlatform: exchange.RuntimePlatform, RuntimeArchitecture: exchange.RuntimeArchitecture,
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
	if err := runningStore.RecordRuntimeValidation(completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime_demo", RuntimeBinaryVersion: "runtime-11.0", ServiceProtocol: "redeven-runtime-v2",
		Platform: "linux", Architecture: "amd64",
		CompatibilityEpoch: 9, Capabilities: []string{"lifecycle_fence_v1"},
		ArtifactSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})); err != nil {
		t.Fatal(err)
	}
	got := runningStore.Binding()
	if got.BindingID != "binding_demo" || got.AccessPointOrigin != "https://region.example" || got.ValidatedRuntime == nil {
		t.Fatalf("reloaded binding lost state: %#v", got)
	}
}
