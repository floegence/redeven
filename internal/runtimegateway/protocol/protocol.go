package protocol

import (
	"errors"
	"strings"
)

const Version = "redeven-gateway-v5"

type IdentityRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	Nonce           string `json:"nonce"`
}
type IdentityResponse struct {
	BindingAudience string `json:"binding_audience"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
	GatewayID       string `json:"gateway_id"`
	Nonce           string `json:"nonce"`
	ProtocolVersion string `json:"protocol_version"`
	Signature       string `json:"signature"`
}

// Permissions are distinct grants. Existing paired clients retain access only;
// retired profile-write grants never become member or Cloud management grants.
type GatewayPermissions struct {
	Access         bool `json:"access"`
	ManageMembers  bool `json:"manage_members"`
	ConfigureCloud bool `json:"configure_cloud"`
}

type GatewayMetadata struct {
	GatewayID                   string             `json:"gateway_id"`
	DisplayName                 string             `json:"display_name"`
	GatewayPublicKeyFingerprint string             `json:"gateway_public_key_fingerprint"`
	ListenerAddress             string             `json:"listener_address"`
	ListenerAddresses           []string           `json:"listener_addresses"`
	ListenerRunning             bool               `json:"listener_running"`
	EndpointLastUsedAt          map[string]int64   `json:"endpoint_last_used_at"`
	MemberEndpoints             []GatewayEndpoint  `json:"member_endpoints"`
	MemberTLSRootPEM            string             `json:"member_tls_root_pem"`
	Permissions                 GatewayPermissions `json:"permissions"`
}

type CatalogRequest struct {
	ProtocolVersion string `json:"protocol_version"`
}
type CatalogResponse struct {
	ProtocolVersion string                    `json:"protocol_version"`
	Gateway         GatewayMetadata           `json:"gateway"`
	Members         []Member                  `json:"members"`
	Policy          GatewayPolicy             `json:"policy"`
	Revision        int64                     `json:"revision"`
	RebuildRequired bool                      `json:"rebuild_required"`
	HookStatus      map[HookAction]HookStatus `json:"hook_status"`
}

type OpenSessionRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	MemberID        string `json:"member_id"`
}

// MemberServiceRequest refreshes signed TLS identity without issuing an access
// ticket or changing the lifetime of established application streams.
type MemberServiceRequest struct {
	ProtocolVersion       string `json:"protocol_version"`
	MemberID              string `json:"member_id"`
	ExpectedMemberVersion int64  `json:"expected_member_version"`
}
type MemberServiceResponse struct {
	ProtocolVersion string           `json:"protocol_version"`
	MemberID        string           `json:"member_id"`
	MemberVersion   int64            `json:"member_version"`
	Service         MemberService    `json:"service"`
	Delegation      MemberDelegation `json:"delegation"`
}

type InvitationRequest struct {
	ProtocolVersion string `json:"protocol_version"`
}

type EndpointUpdateRequest struct {
	ProtocolVersion string            `json:"protocol_version"`
	Endpoints       []GatewayEndpoint `json:"endpoints"`
}

type EndpointUpdateResponse struct {
	ProtocolVersion string            `json:"protocol_version"`
	Endpoints       []GatewayEndpoint `json:"endpoints"`
}
type RemoveMemberRequest struct {
	ProtocolVersion       string `json:"protocol_version"`
	MemberID              string `json:"member_id"`
	ExpectedMemberVersion int64  `json:"expected_member_version"`
}

type UpdatePolicyRequest struct {
	ProtocolVersion  string        `json:"protocol_version"`
	ExpectedRevision int64         `json:"expected_revision"`
	Policy           GatewayPolicy `json:"policy"`
}

type UpdateMembersRequest struct {
	ProtocolVersion string               `json:"protocol_version"`
	Items           []MemberPolicyUpdate `json:"items"`
}

type PairingChallengeRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	ClientNonce     string `json:"client_nonce"`
	ClientPublicKey string `json:"client_public_key"`
	BindingAudience string `json:"binding_audience"`
	PairingCode     string `json:"pairing_code,omitempty"`
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
	ProtocolVersion string             `json:"protocol_version"`
	ClientNonce     string             `json:"client_nonce"`
	GatewayNonce    string             `json:"gateway_nonce"`
	GatewayID       string             `json:"gateway_id"`
	BindingAudience string             `json:"binding_audience"`
	ClientKeyID     string             `json:"client_key_id"`
	Permissions     GatewayPermissions `json:"permissions"`
	Proof           string             `json:"proof"`
}

type PairingCompleteResponse struct {
	ProtocolVersion string             `json:"protocol_version"`
	GatewayID       string             `json:"gateway_id"`
	ClientKeyID     string             `json:"client_key_id"`
	PairedAtUnixMS  int64              `json:"paired_at_unix_ms"`
	Permissions     GatewayPermissions `json:"permissions"`
	Proof           string             `json:"proof"`
}

var (
	ErrUnsupportedProtocolVersion = errors.New("unsupported protocol_version")
	ErrInvalidPermissions         = errors.New("invalid Gateway permissions")
)

func ValidateProtocolVersion(version string) error {
	if version != Version {
		return ErrUnsupportedProtocolVersion
	}
	return nil
}
func NormalizePairingCompleteRequest(req PairingCompleteRequest) PairingCompleteRequest {
	req.ProtocolVersion = strings.TrimSpace(req.ProtocolVersion)
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.GatewayNonce = strings.TrimSpace(req.GatewayNonce)
	req.GatewayID = strings.TrimSpace(req.GatewayID)
	req.BindingAudience = strings.TrimSpace(req.BindingAudience)
	req.ClientKeyID = strings.TrimSpace(req.ClientKeyID)
	req.Proof = strings.TrimSpace(req.Proof)
	return req
}
func ValidatePairingCompleteRequest(req PairingCompleteRequest) error {
	if err := ValidateProtocolVersion(req.ProtocolVersion); err != nil {
		return err
	}
	if !req.Permissions.Access && !req.Permissions.ManageMembers && !req.Permissions.ConfigureCloud {
		return ErrInvalidPermissions
	}
	return nil
}
