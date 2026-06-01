package protocol

import (
	"errors"
	"strings"
)

const Version = "redeven-runtime-gateway-v1"

type GatewayCapability string

const (
	GatewayCapabilityEnvCatalog     GatewayCapability = "env_catalog"
	GatewayCapabilityEnvOpenSession GatewayCapability = "env_open_session"
	GatewayCapabilityEnvLifecycle   GatewayCapability = "env_lifecycle"
	GatewayCapabilityTerminal       GatewayCapability = "terminal"
	GatewayCapabilityFiles          GatewayCapability = "files"
	GatewayCapabilityWebService     GatewayCapability = "web_service"
	GatewayCapabilityPortForward    GatewayCapability = "port_forward"
)

type EnvironmentKind string

const (
	EnvironmentKindManagedLocalEnv EnvironmentKind = "managed_local_env"
	EnvironmentKindReachableEnv    EnvironmentKind = "reachable_env"
)

type EnvironmentState string

const (
	EnvironmentStateUnknown   EnvironmentState = "unknown"
	EnvironmentStateAvailable EnvironmentState = "available"
	EnvironmentStateStarting  EnvironmentState = "starting"
	EnvironmentStateStopped   EnvironmentState = "stopped"
	EnvironmentStateArchived  EnvironmentState = "archived"
)

type EnvironmentCapability string

const (
	EnvironmentCapabilityOpen          EnvironmentCapability = "open"
	EnvironmentCapabilityStart         EnvironmentCapability = "start"
	EnvironmentCapabilityStop          EnvironmentCapability = "stop"
	EnvironmentCapabilityUpdateRuntime EnvironmentCapability = "update_runtime"
	EnvironmentCapabilityTerminal      EnvironmentCapability = "terminal"
	EnvironmentCapabilityFiles         EnvironmentCapability = "files"
	EnvironmentCapabilityWebService    EnvironmentCapability = "web_service"
	EnvironmentCapabilityPortForward   EnvironmentCapability = "port_forward"
)

type EnvironmentOriginKind string

const (
	EnvironmentOriginKindGatewayHost   EnvironmentOriginKind = "gateway_host"
	EnvironmentOriginKindSSHTarget     EnvironmentOriginKind = "ssh_target"
	EnvironmentOriginKindContainer     EnvironmentOriginKind = "container"
	EnvironmentOriginKindNetworkTarget EnvironmentOriginKind = "network_target"
)

type RequestedCapability string

const (
	RequestedCapabilityEnvApp      RequestedCapability = "env_app"
	RequestedCapabilityTerminal    RequestedCapability = "terminal"
	RequestedCapabilityFiles       RequestedCapability = "files"
	RequestedCapabilityWebService  RequestedCapability = "web_service"
	RequestedCapabilityPortForward RequestedCapability = "port_forward"
)

type ConnectArtifactKind string

const (
	ConnectArtifactKindLocalDirect   ConnectArtifactKind = "local_direct_artifact"
	ConnectArtifactKindDesktopBridge ConnectArtifactKind = "desktop_bridge_artifact"
)

type GatewayErrorCode string

const (
	GatewayErrorCodeInvalidRequest        GatewayErrorCode = "INVALID_REQUEST"
	GatewayErrorCodeUnauthorized          GatewayErrorCode = "UNAUTHORIZED"
	GatewayErrorCodeTrustChanged          GatewayErrorCode = "TRUST_CHANGED"
	GatewayErrorCodeNotFound              GatewayErrorCode = "NOT_FOUND"
	GatewayErrorCodeCapabilityUnsupported GatewayErrorCode = "CAPABILITY_UNSUPPORTED"
	GatewayErrorCodeUnavailable           GatewayErrorCode = "UNAVAILABLE"
	GatewayErrorCodeNotImplemented        GatewayErrorCode = "NOT_IMPLEMENTED"
)

type GatewayStatus string

const (
	GatewayStatusOnline          GatewayStatus = "online"
	GatewayStatusPairingRequired GatewayStatus = "pairing_required"
	GatewayStatusTrustChanged    GatewayStatus = "trust_changed"
	GatewayStatusError           GatewayStatus = "error"
	GatewayStatusUnknown         GatewayStatus = "unknown"
)

type CatalogRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
}

type CatalogResponse struct {
	ProtocolVersion string          `json:"protocol_version"`
	Gateway         GatewayMetadata `json:"gateway"`
	Environments    []Environment   `json:"environments"`
}

type GatewayMetadata struct {
	GatewayID                   string              `json:"gateway_id"`
	DisplayName                 string              `json:"display_name"`
	Status                      GatewayStatus       `json:"status"`
	Capabilities                []GatewayCapability `json:"capabilities"`
	GatewayPublicKeyFingerprint string              `json:"gateway_public_key_fingerprint,omitempty"`
}

type Environment struct {
	GatewayEnvID     string                  `json:"gateway_env_id"`
	DisplayName      string                  `json:"display_name"`
	EnvKind          EnvironmentKind         `json:"env_kind"`
	State            EnvironmentState        `json:"state"`
	Capabilities     []EnvironmentCapability `json:"capabilities"`
	Origin           EnvironmentOrigin       `json:"origin"`
	LastSeenAtUnixMS int64                   `json:"last_seen_at_unix_ms,omitempty"`
}

type EnvironmentOrigin struct {
	Kind  EnvironmentOriginKind `json:"kind"`
	Label string                `json:"label"`
}

type OpenSessionRequest struct {
	ProtocolVersion     string              `json:"protocol_version,omitempty"`
	GatewayEnvID        string              `json:"gateway_env_id"`
	RequestedCapability RequestedCapability `json:"requested_capability"`
	ClientNonce         string              `json:"client_nonce"`
	BridgeSessionID     string              `json:"bridge_session_id,omitempty"`
	RouteID             string              `json:"route_id,omitempty"`
}

type OpenSessionResponse struct {
	ProtocolVersion  string                 `json:"protocol_version"`
	GatewaySessionID string                 `json:"gateway_session_id"`
	GatewayEnvID     string                 `json:"gateway_env_id"`
	ConnectArtifact  GatewayConnectArtifact `json:"connect_artifact"`
	DiagnosticsHint  *DiagnosticsHint       `json:"diagnostics_hint,omitempty"`
}

type GatewayConnectArtifact struct {
	Kind            ConnectArtifactKind `json:"kind"`
	URL             string              `json:"url,omitempty"`
	BridgeSessionID string              `json:"bridge_session_id,omitempty"`
	RouteID         string              `json:"route_id,omitempty"`
	ExpiresAtUnixMS int64               `json:"expires_at_unix_ms"`
	ArtifactNonce   string              `json:"artifact_nonce"`
	Proof           string              `json:"proof"`
}

type DiagnosticsHint struct {
	GatewayEnvID   string `json:"gateway_env_id"`
	ConnectionKind string `json:"connection_kind"`
}

type PairingChallengeRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
	ClientNonce     string `json:"client_nonce"`
	ClientPublicKey string `json:"client_public_key"`
	BindingAudience string `json:"binding_audience"`
}

type PairingChallengeResponse struct {
	ProtocolVersion             string `json:"protocol_version"`
	GatewayID                   string `json:"gateway_id"`
	GatewayPublicKey            string `json:"gateway_public_key"`
	GatewayPublicKeyFingerprint string `json:"gateway_public_key_fingerprint"`
	GatewayNonce                string `json:"gateway_nonce"`
	PairingCode                 string `json:"pairing_code,omitempty"`
	ExpiresAtUnixMS             int64  `json:"expires_at_unix_ms"`
	Signature                   string `json:"signature"`
}

type PairingCompleteRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
	ClientNonce     string `json:"client_nonce"`
	GatewayNonce    string `json:"gateway_nonce"`
	GatewayID       string `json:"gateway_id"`
	BindingAudience string `json:"binding_audience"`
	ClientKeyID     string `json:"client_key_id"`
	Proof           string `json:"proof"`
}

type PairingCompleteResponse struct {
	ProtocolVersion string `json:"protocol_version"`
	GatewayID       string `json:"gateway_id"`
	ClientKeyID     string `json:"client_key_id"`
	PairedAtUnixMS  int64  `json:"paired_at_unix_ms"`
	Proof           string `json:"proof"`
}

type ErrorEnvelope struct {
	Code           GatewayErrorCode `json:"code"`
	Message        string           `json:"message"`
	Retryable      bool             `json:"retryable,omitempty"`
	RedactedDetail string           `json:"redacted_detail,omitempty"`
}

var (
	ErrUnsupportedProtocolVersion = errors.New("unsupported protocol_version")
	ErrMissingGatewayEnvID        = errors.New("gateway_env_id is required")
	ErrMissingRequestedCapability = errors.New("requested_capability is required")
	ErrMissingClientNonce         = errors.New("client_nonce is required")
)

func ValidateProtocolVersion(version string) error {
	if version == Version {
		return nil
	}
	return ErrUnsupportedProtocolVersion
}

func NewCatalogResponse(gateway GatewayMetadata, environments []Environment) CatalogResponse {
	if environments == nil {
		environments = []Environment{}
	}
	return CatalogResponse{
		ProtocolVersion: Version,
		Gateway:         NormalizeGatewayMetadata(gateway),
		Environments:    NormalizeEnvironments(environments),
	}
}

func NormalizeGatewayMetadata(gateway GatewayMetadata) GatewayMetadata {
	gateway.GatewayID = strings.TrimSpace(gateway.GatewayID)
	gateway.DisplayName = strings.TrimSpace(gateway.DisplayName)
	gateway.GatewayPublicKeyFingerprint = strings.TrimSpace(gateway.GatewayPublicKeyFingerprint)
	switch gateway.Status {
	case GatewayStatusOnline, GatewayStatusPairingRequired, GatewayStatusTrustChanged, GatewayStatusError:
	default:
		gateway.Status = GatewayStatusUnknown
	}
	gateway.Capabilities = normalizeGatewayCapabilities(gateway.Capabilities)
	if gateway.Capabilities == nil {
		gateway.Capabilities = []GatewayCapability{}
	}
	return gateway
}

func NormalizeEnvironments(environments []Environment) []Environment {
	out := make([]Environment, 0, len(environments))
	for _, environment := range environments {
		environment.GatewayEnvID = strings.TrimSpace(environment.GatewayEnvID)
		environment.DisplayName = strings.TrimSpace(environment.DisplayName)
		switch environment.State {
		case EnvironmentStateAvailable, EnvironmentStateStarting, EnvironmentStateStopped, EnvironmentStateArchived:
		default:
			environment.State = EnvironmentStateUnknown
		}
		switch environment.EnvKind {
		case EnvironmentKindManagedLocalEnv, EnvironmentKindReachableEnv:
		default:
			environment.EnvKind = EnvironmentKindReachableEnv
		}
		environment.Capabilities = normalizeEnvironmentCapabilities(environment.Capabilities)
		environment.Origin.Kind = normalizeEnvironmentOriginKind(environment.Origin.Kind)
		environment.Origin.Label = strings.TrimSpace(environment.Origin.Label)
		if environment.GatewayEnvID == "" {
			continue
		}
		if environment.DisplayName == "" {
			environment.DisplayName = environment.GatewayEnvID
		}
		out = append(out, environment)
	}
	return out
}

func NormalizeOpenSessionRequest(req OpenSessionRequest) OpenSessionRequest {
	req.GatewayEnvID = strings.TrimSpace(req.GatewayEnvID)
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.BridgeSessionID = strings.TrimSpace(req.BridgeSessionID)
	req.RouteID = strings.TrimSpace(req.RouteID)
	req.RequestedCapability = normalizeRequestedCapability(req.RequestedCapability)
	return req
}

func ValidateOpenSessionRequest(req OpenSessionRequest) error {
	req = NormalizeOpenSessionRequest(req)
	if req.GatewayEnvID == "" {
		return ErrMissingGatewayEnvID
	}
	if req.RequestedCapability == "" {
		return ErrMissingRequestedCapability
	}
	if req.ClientNonce == "" {
		return ErrMissingClientNonce
	}
	return nil
}

func normalizeGatewayCapabilities(capabilities []GatewayCapability) []GatewayCapability {
	out := make([]GatewayCapability, 0, len(capabilities))
	seen := make(map[GatewayCapability]struct{}, len(capabilities))
	for _, capability := range capabilities {
		switch capability {
		case GatewayCapabilityEnvCatalog, GatewayCapabilityEnvOpenSession, GatewayCapabilityEnvLifecycle,
			GatewayCapabilityTerminal, GatewayCapabilityFiles, GatewayCapabilityWebService, GatewayCapabilityPortForward:
		default:
			continue
		}
		if _, ok := seen[capability]; ok {
			continue
		}
		seen[capability] = struct{}{}
		out = append(out, capability)
	}
	return out
}

func normalizeEnvironmentCapabilities(capabilities []EnvironmentCapability) []EnvironmentCapability {
	out := make([]EnvironmentCapability, 0, len(capabilities))
	seen := make(map[EnvironmentCapability]struct{}, len(capabilities))
	for _, capability := range capabilities {
		switch capability {
		case EnvironmentCapabilityOpen, EnvironmentCapabilityStart, EnvironmentCapabilityStop,
			EnvironmentCapabilityUpdateRuntime, EnvironmentCapabilityTerminal, EnvironmentCapabilityFiles,
			EnvironmentCapabilityWebService, EnvironmentCapabilityPortForward:
		default:
			continue
		}
		if _, ok := seen[capability]; ok {
			continue
		}
		seen[capability] = struct{}{}
		out = append(out, capability)
	}
	if out == nil {
		return []EnvironmentCapability{}
	}
	return out
}

func normalizeEnvironmentOriginKind(kind EnvironmentOriginKind) EnvironmentOriginKind {
	switch kind {
	case EnvironmentOriginKindGatewayHost, EnvironmentOriginKindSSHTarget, EnvironmentOriginKindContainer, EnvironmentOriginKindNetworkTarget:
		return kind
	default:
		return EnvironmentOriginKindNetworkTarget
	}
}

func normalizeRequestedCapability(capability RequestedCapability) RequestedCapability {
	switch capability {
	case RequestedCapabilityEnvApp, RequestedCapabilityTerminal, RequestedCapabilityFiles,
		RequestedCapabilityWebService, RequestedCapabilityPortForward:
		return capability
	default:
		return ""
	}
}
