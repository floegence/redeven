package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

const (
	providerEnrollmentExchangePath = "/api/rcpp/v3/runtime-management/enrollment/exchange"
	providerHeartbeatPathPrefix    = "/api/rcpp/v3/runtime-management/bindings/"
	providerHeartbeatInterval      = 30 * time.Second
)

type EnrollmentCodeScope struct {
	ChallengeID              string
	ControlBindingGeneration int64
	ProofNonce               string
}

type ProviderEnrollmentOptions struct {
	AccessPointOrigin string
	EnvironmentID     string
	EnrollmentCode    string
	GatewayVersion    string
	BindingStore      *BindingStore
	Controller        RuntimeValidationRefresher
	TargetCoordinator TargetMutationCoordinator
	HTTPClient        *http.Client
}

type RuntimeValidationRefresher interface {
	RefreshRuntimeValidation(context.Context) (RuntimeValidation, error)
}

type TargetMutationCoordinator interface {
	BeginTargetMutation(string) (func(), error)
}

type providerEnrollmentExchangeRequest struct {
	ProtocolVersion          string   `json:"protocol_version"`
	EnvPublicID              string   `json:"env_public_id"`
	ChallengeID              string   `json:"challenge_id"`
	EnrollmentCode           string   `json:"enrollment_code"`
	ProofNonce               string   `json:"proof_nonce"`
	ControlBindingGeneration int64    `json:"control_binding_generation"`
	LifecycleTargetID        string   `json:"lifecycle_target_id"`
	TargetGeneration         int64    `json:"target_generation"`
	SupervisorInstanceID     string   `json:"supervisor_instance_id"`
	SupervisorPublicKey      string   `json:"supervisor_public_key"`
	InstallationRootDigest   string   `json:"installation_root_digest"`
	SupervisorProofSignature string   `json:"supervisor_proof_signature"`
	GatewayVersion           string   `json:"gateway_version"`
	GatewayProtocol          string   `json:"gateway_protocol"`
	RuntimeBinaryVersion     string   `json:"runtime_binary_version"`
	RuntimeServiceProtocol   string   `json:"runtime_service_protocol"`
	CompatibilityEpoch       int      `json:"compatibility_epoch"`
	Capabilities             []string `json:"capabilities"`
	RuntimeArtifactSHA256    string   `json:"runtime_artifact_sha256"`
}

type providerEnrollmentBinding struct {
	BindingID              string                `json:"binding_id"`
	ProviderOrigin         string                `json:"provider_origin"`
	AccessPointID          string                `json:"access_point_id"`
	AccessPointOrigin      string                `json:"access_point_origin"`
	EnvPublicID            string                `json:"env_public_id"`
	LifecycleTargetID      string                `json:"lifecycle_target_id"`
	TargetGeneration       int64                 `json:"target_generation"`
	SupervisorInstanceID   string                `json:"supervisor_instance_id"`
	InstallationRootDigest string                `json:"installation_root_digest"`
	GatewayVersion         string                `json:"gateway_version"`
	GatewayProtocol        string                `json:"gateway_protocol"`
	RuntimeBinaryVersion   string                `json:"runtime_binary_version"`
	RuntimeServiceProtocol string                `json:"runtime_service_protocol"`
	CompatibilityEpoch     int                   `json:"compatibility_epoch"`
	Capabilities           []string              `json:"capabilities"`
	RuntimeArtifactSHA256  string                `json:"runtime_artifact_sha256"`
	PermitVerificationKey  PermitVerificationKey `json:"permit_verification_key"`
	LastSeenAtUnixMS       int64                 `json:"last_seen_at_unix_ms"`
}

type providerEnrollmentExchangeResponse struct {
	ProtocolVersion string                    `json:"protocol_version"`
	Binding         providerEnrollmentBinding `json:"binding"`
}

type providerHeartbeatRequest struct {
	ProtocolVersion        string   `json:"protocol_version"`
	EnvPublicID            string   `json:"env_public_id"`
	BindingID              string   `json:"binding_id"`
	LifecycleTargetID      string   `json:"lifecycle_target_id"`
	TargetGeneration       int64    `json:"target_generation"`
	SupervisorInstanceID   string   `json:"supervisor_instance_id"`
	GatewayVersion         string   `json:"gateway_version"`
	GatewayProtocol        string   `json:"gateway_protocol"`
	RuntimeBinaryVersion   string   `json:"runtime_binary_version"`
	RuntimeServiceProtocol string   `json:"runtime_service_protocol"`
	CompatibilityEpoch     int      `json:"compatibility_epoch"`
	Capabilities           []string `json:"capabilities"`
	RuntimeArtifactSHA256  string   `json:"runtime_artifact_sha256"`
	Nonce                  string   `json:"nonce"`
	TimestampUnixMS        int64    `json:"timestamp_unix_ms"`
	Signature              string   `json:"signature"`
}

type providerHeartbeatResponse struct {
	ProtocolVersion  string `json:"protocol_version"`
	AcceptedAtUnixMS int64  `json:"accepted_at_unix_ms"`
}

type providerErrorEnvelope struct {
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func ParseEnrollmentCode(value string) (EnrollmentCodeScope, error) {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) != 4 || !strings.HasPrefix(parts[0], "rec_") || !strings.HasPrefix(parts[2], "rpn_") || !strings.HasPrefix(parts[3], "ren_") {
		return EnrollmentCodeScope{}, errors.New("Runtime enrollment code is invalid")
	}
	generation, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || generation < 0 {
		return EnrollmentCodeScope{}, errors.New("Runtime enrollment code is invalid")
	}
	return EnrollmentCodeScope{ChallengeID: parts[0], ControlBindingGeneration: generation, ProofNonce: parts[2]}, nil
}

func EnrollProvider(ctx context.Context, options ProviderEnrollmentOptions) (TargetBinding, error) {
	if options.BindingStore == nil || options.Controller == nil {
		return TargetBinding{}, errors.New("Runtime enrollment supervisor is unavailable")
	}
	environmentID := strings.TrimSpace(options.EnvironmentID)
	gatewayVersion := strings.TrimSpace(options.GatewayVersion)
	code := strings.TrimSpace(options.EnrollmentCode)
	if environmentID == "" || gatewayVersion == "" || code == "" {
		return TargetBinding{}, errors.New("Runtime enrollment scope is incomplete")
	}
	codeScope, err := ParseEnrollmentCode(code)
	if err != nil {
		return TargetBinding{}, err
	}
	accessPointOrigin, err := normalizeProviderAccessPointOrigin(options.AccessPointOrigin)
	if err != nil {
		return TargetBinding{}, err
	}
	validation, err := options.Controller.RefreshRuntimeValidation(ctx)
	if err != nil {
		return TargetBinding{}, fmt.Errorf("validate current Runtime before enrollment: %w", err)
	}
	binding := options.BindingStore.Binding()
	if options.TargetCoordinator != nil {
		releaseTargetMutation, err := options.TargetCoordinator.BeginTargetMutation(binding.LifecycleTargetID)
		if err != nil {
			return TargetBinding{}, fmt.Errorf("reserve Runtime target for enrollment: %w", err)
		}
		defer releaseTargetMutation()
		if err := options.BindingStore.Reload(); err != nil {
			return TargetBinding{}, err
		}
		binding = options.BindingStore.Binding()
	}
	targetGeneration := providerEnrollmentTargetGeneration(binding)
	proofRequest := EnrollmentProofRequest{
		ProtocolVersion: EnrollmentProtocolVersion, ChallengeID: codeScope.ChallengeID, ProofNonce: codeScope.ProofNonce,
		EnvironmentPublicID: environmentID, ControlBindingGeneration: codeScope.ControlBindingGeneration,
		LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: targetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, SupervisorPublicKey: binding.SupervisorPublicKey,
		InstallationRootDigest: binding.InstallationRootDigest,
	}
	localProof, err := options.BindingStore.SignEnrollmentProof(environmentID, proofRequest)
	if err != nil {
		return TargetBinding{}, err
	}

	var proofServer *EnrollmentProofServer
	var proofResult chan error
	if codeScope.ControlBindingGeneration > 0 {
		proofServer, err = OpenEnrollmentProofServer(options.BindingStore, environmentID)
		if err != nil {
			return TargetBinding{}, fmt.Errorf("open Runtime enrollment proof socket: %w", err)
		}
		defer proofServer.Close()
		proofResult = make(chan error, 1)
		go func() { proofResult <- proofServer.ServeOnce(ctx) }()
	}

	exchangeRequest := providerEnrollmentExchangeRequest{
		ProtocolVersion: EnrollmentProtocolVersion, EnvPublicID: environmentID,
		ChallengeID: codeScope.ChallengeID, EnrollmentCode: code, ProofNonce: codeScope.ProofNonce,
		ControlBindingGeneration: codeScope.ControlBindingGeneration,
		LifecycleTargetID:        binding.LifecycleTargetID, TargetGeneration: targetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, SupervisorPublicKey: binding.SupervisorPublicKey,
		InstallationRootDigest: binding.InstallationRootDigest, SupervisorProofSignature: localProof.Signature,
		GatewayVersion: gatewayVersion, GatewayProtocol: gatewayprotocol.Version,
		RuntimeBinaryVersion: validation.RuntimeBinaryVersion, RuntimeServiceProtocol: validation.ServiceProtocol,
		CompatibilityEpoch: validation.CompatibilityEpoch, Capabilities: providerSupervisorCapabilities(),
		RuntimeArtifactSHA256: validation.ArtifactSHA256,
	}
	var exchangeResponse providerEnrollmentExchangeResponse
	if err := providerPostJSON(ctx, options.HTTPClient, accessPointOrigin, providerEnrollmentExchangePath, exchangeRequest, &exchangeResponse); err != nil {
		return TargetBinding{}, err
	}
	if proofResult != nil {
		if err := <-proofResult; err != nil {
			return TargetBinding{}, fmt.Errorf("complete Runtime control enrollment proof: %w", err)
		}
	}
	result := exchangeResponse.Binding
	if exchangeResponse.ProtocolVersion != EnrollmentProtocolVersion || result.BindingID == "" || result.ProviderOrigin == "" ||
		result.AccessPointID == "" || result.AccessPointOrigin != accessPointOrigin || result.EnvPublicID != environmentID ||
		result.LifecycleTargetID != binding.LifecycleTargetID || result.TargetGeneration != targetGeneration ||
		result.SupervisorInstanceID != binding.SupervisorInstanceID || result.InstallationRootDigest != binding.InstallationRootDigest ||
		result.GatewayVersion != gatewayVersion || result.GatewayProtocol != gatewayprotocol.Version ||
		result.RuntimeBinaryVersion != validation.RuntimeBinaryVersion || result.RuntimeServiceProtocol != validation.ServiceProtocol ||
		result.CompatibilityEpoch != validation.CompatibilityEpoch || result.RuntimeArtifactSHA256 != validation.ArtifactSHA256 ||
		result.PermitVerificationKey.KeyID == "" || result.PermitVerificationKey.Algorithm != "EdDSA" || result.PermitVerificationKey.PublicKey == "" {
		return TargetBinding{}, errors.New("Provider Runtime enrollment response is invalid")
	}
	if err := options.BindingStore.ConfigureProvider(
		result.BindingID, result.ProviderOrigin, result.AccessPointID, result.AccessPointOrigin,
		result.EnvPublicID, result.PermitVerificationKey, targetGeneration,
	); err != nil {
		return TargetBinding{}, fmt.Errorf("persist Provider Runtime binding: %w", err)
	}
	if err := SendProviderHeartbeat(ctx, options.HTTPClient, options.BindingStore, gatewayVersion, validation); err != nil {
		return TargetBinding{}, fmt.Errorf("confirm Provider Runtime binding readiness: %w", err)
	}
	return options.BindingStore.Binding(), nil
}

func providerBindingConfigured(binding TargetBinding) bool {
	return strings.TrimSpace(binding.ProviderOrigin) != "" || strings.TrimSpace(binding.AccessPointID) != "" ||
		strings.TrimSpace(binding.AccessPointOrigin) != "" || strings.TrimSpace(binding.EnvironmentPublicID) != ""
}

func providerEnrollmentTargetGeneration(binding TargetBinding) int64 {
	if providerBindingConfigured(binding) {
		return binding.TargetGeneration + 1
	}
	return binding.TargetGeneration
}

func MaintainProviderHeartbeat(ctx context.Context, store *BindingStore, controller RuntimeValidationRefresher, gatewayVersion string) {
	if store == nil || controller == nil || strings.TrimSpace(gatewayVersion) == "" {
		return
	}
	ticker := time.NewTicker(providerHeartbeatInterval)
	defer ticker.Stop()
	for {
		_ = store.Reload()
		binding := store.Binding()
		if binding.AccessPointOrigin != "" && binding.EnvironmentPublicID != "" {
			heartbeatCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			validation, err := controller.RefreshRuntimeValidation(heartbeatCtx)
			if err == nil {
				err = SendProviderHeartbeat(heartbeatCtx, nil, store, gatewayVersion, validation)
			}
			_ = err
			cancel()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func SendProviderHeartbeat(ctx context.Context, client *http.Client, store *BindingStore, gatewayVersion string, validation RuntimeValidation) error {
	if store == nil {
		return errors.New("Runtime target binding is unavailable")
	}
	binding := store.Binding()
	if binding.BindingID == "" || binding.ProviderOrigin == "" || binding.AccessPointID == "" ||
		binding.AccessPointOrigin == "" || binding.EnvironmentPublicID == "" {
		return errors.New("Provider Runtime binding is unavailable")
	}
	nonce, err := randomID("rhb_")
	if err != nil {
		return err
	}
	request := providerHeartbeatRequest{
		ProtocolVersion: EnrollmentProtocolVersion, EnvPublicID: binding.EnvironmentPublicID, BindingID: binding.BindingID,
		LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, GatewayVersion: strings.TrimSpace(gatewayVersion),
		GatewayProtocol: gatewayprotocol.Version, RuntimeBinaryVersion: validation.RuntimeBinaryVersion,
		RuntimeServiceProtocol: validation.ServiceProtocol, CompatibilityEpoch: validation.CompatibilityEpoch,
		Capabilities: providerSupervisorCapabilities(), RuntimeArtifactSHA256: validation.ArtifactSHA256,
		Nonce: nonce, TimestampUnixMS: time.Now().UnixMilli(),
	}
	payload, err := canonicalProviderHeartbeatPayload(request)
	if err != nil {
		return err
	}
	request.Signature, err = security.SignPayload(binding.SupervisorPrivateKey, payload)
	if err != nil {
		return err
	}
	var response providerHeartbeatResponse
	path := providerHeartbeatPathPrefix + url.PathEscape(binding.BindingID) + "/heartbeat"
	if err := providerPostJSON(ctx, client, binding.AccessPointOrigin, path, request, &response); err != nil {
		return err
	}
	if response.ProtocolVersion != EnrollmentProtocolVersion || response.AcceptedAtUnixMS <= 0 {
		return errors.New("Provider Runtime heartbeat response is invalid")
	}
	return nil
}

func canonicalProviderHeartbeatPayload(request providerHeartbeatRequest) (string, error) {
	return security.CanonicalJSON(map[string]any{
		"binding_id": request.BindingID, "capabilities": compactSorted(request.Capabilities),
		"compatibility_epoch": request.CompatibilityEpoch, "env_public_id": request.EnvPublicID,
		"gateway_protocol": request.GatewayProtocol, "gateway_version": request.GatewayVersion,
		"lifecycle_target_id": request.LifecycleTargetID, "nonce": request.Nonce,
		"protocol_version": request.ProtocolVersion, "runtime_artifact_sha256": request.RuntimeArtifactSHA256,
		"runtime_binary_version": request.RuntimeBinaryVersion, "runtime_service_protocol": request.RuntimeServiceProtocol,
		"supervisor_instance_id": request.SupervisorInstanceID, "target_generation": request.TargetGeneration,
		"timestamp_unix_ms": request.TimestampUnixMS,
	})
}

func providerSupervisorCapabilities() []string {
	return []string{"manual_recovery_v1", "runtime_operations_v2", "signed_artifact_policy_v1"}
}

func normalizeProviderAccessPointOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed == nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.Hostname() == "" {
		return "", errors.New("Provider access-point origin is invalid")
	}
	secure := parsed.Scheme == "https"
	loopbackHTTP := parsed.Scheme == "http" && (strings.EqualFold(parsed.Hostname(), "localhost") || net.ParseIP(parsed.Hostname()).IsLoopback())
	if !secure && !loopbackHTTP {
		return "", errors.New("Provider access-point origin must use HTTPS")
	}
	parsed.Path = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func providerPostJSON(ctx context.Context, client *http.Client, origin string, path string, input any, output any) error {
	origin, err := normalizeProviderAccessPointOrigin(origin)
	if err != nil {
		return err
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("Provider Runtime request redirect is not allowed")
		}}
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var envelope providerErrorEnvelope
		_ = json.Unmarshal(raw, &envelope)
		if envelope.Error != nil && strings.TrimSpace(envelope.Error.Code) != "" {
			return fmt.Errorf("Provider Runtime request rejected (%s): %s", strings.TrimSpace(envelope.Error.Code), strings.TrimSpace(envelope.Error.Message))
		}
		return fmt.Errorf("Provider Runtime request returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode Provider Runtime response: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("Provider Runtime response contains trailing data")
	}
	return nil
}
