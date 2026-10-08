package protocol

const (
	MemberConnectionStream = "redeven.gateway.member.https.v5"
	MemberAccessStream     = "redeven.gateway.access.https.v5"
	MaxMembers             = 1024
	MaxMemberConnections   = 32
	MaxGatewayConnections  = 1024
)

type CloudPermission string

const (
	CloudInherit CloudPermission = "inherit"
	CloudAllow   CloudPermission = "allow"
	CloudDeny    CloudPermission = "deny"
)

type PublicationMode string

const (
	PublicationManual    PublicationMode = "manual"
	PublicationAutomatic PublicationMode = "automatic"
)

type GatewayEndpointScope string

const (
	GatewayEndpointLAN     GatewayEndpointScope = "lan"
	GatewayEndpointOverlay GatewayEndpointScope = "overlay"
	GatewayEndpointPublic  GatewayEndpointScope = "public"
)

// GatewayEndpoint is an administrator-confirmed Runtime connection option.
// It is deliberately independent from the Gateway listener address and Cloud
// origin; the Gateway signs the complete set before a Runtime can use it.
type GatewayEndpoint struct {
	EndpointID string               `json:"endpoint_id"`
	Address    string               `json:"address"`
	Scope      GatewayEndpointScope `json:"scope"`
	Priority   int                  `json:"priority"`
}

type MemberConnectRequest struct {
	ProtocolVersion string          `json:"protocol_version"`
	Endpoint        GatewayEndpoint `json:"endpoint"`
}

// MemberInvitation is a Gateway-admin-authorized one-time capability. It has
// no Runtime destination, Cloud credential, or Namespace enrollment token.
type MemberInvitation struct {
	ProtocolVersion   string            `json:"protocol_version"`
	InvitationID      string            `json:"invitation_id"`
	GatewayID         string            `json:"gateway_id"`
	GatewayName       string            `json:"gateway_name"`
	Endpoints         []GatewayEndpoint `json:"endpoints"`
	GatewayPublicKey  string            `json:"gateway_public_key"`
	GatewayTLSRootPEM string            `json:"gateway_tls_root_pem"`
	Token             string            `json:"token"`
	IssuedAtUnixMS    int64             `json:"issued_at_unix_ms"`
	ExpiresAtUnixMS   int64             `json:"expires_at_unix_ms"`
	Signature         string            `json:"signature"`
}

func (MemberInvitation) String() string   { return "Gateway.MemberInvitation" }
func (MemberInvitation) GoString() string { return "Gateway.MemberInvitation" }

// MemberDelegation is signed by the Runtime at local confirmation. The signed
// Gateway identity scopes future local access and Cloud publication. Cloud
// still requires its own challenge-bound proof and Namespace approval.
type MemberDelegation struct {
	ProtocolVersion        string `json:"protocol_version"`
	GatewayID              string `json:"gateway_id"`
	MemberID               string `json:"member_id"`
	RuntimePublicID        string `json:"runtime_public_id"`
	PublicKeyB64u          string `json:"public_key_b64u"`
	InvitationID           string `json:"invitation_id"`
	ConsentedAtUnixMS      int64  `json:"consented_at_unix_ms"`
	ManageAccess           bool   `json:"manage_access"`
	ManageCloudPublication bool   `json:"manage_cloud_publication"`
	Signature              string `json:"signature"`
}

// MemberService describes the Runtime's fixed HTTPS application entry. Trust
// is scoped to this member and is never installed in a system-wide trust store.
type MemberService struct {
	Revision          int64  `json:"revision"`
	Origin            string `json:"origin"`
	CertificatePEM    string `json:"certificate_pem"`
	CertificateSHA256 string `json:"certificate_sha256"`
	ExpiresAtUnixMS   int64  `json:"expires_at_unix_ms"`
	Signature         string `json:"signature"`
}

type MemberMetadata struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

type MemberJoinRequest struct {
	ProtocolVersion string           `json:"protocol_version"`
	InvitationID    string           `json:"invitation_id"`
	Token           string           `json:"token"`
	DeliveryID      string           `json:"delivery_id"`
	Delegation      MemberDelegation `json:"delegation"`
	ClientCSRPEM    string           `json:"client_csr_pem"`
	Service         MemberService    `json:"service"`
	Metadata        MemberMetadata   `json:"metadata"`
	Signature       string           `json:"signature"`
}

func (MemberJoinRequest) String() string   { return "Gateway.MemberJoinRequest" }
func (MemberJoinRequest) GoString() string { return "Gateway.MemberJoinRequest" }

type MemberJoinResponse struct {
	ProtocolVersion       string `json:"protocol_version"`
	GatewayID             string `json:"gateway_id"`
	MemberID              string `json:"member_id"`
	MemberVersion         int64  `json:"member_version"`
	DeliveryID            string `json:"delivery_id"`
	ClientCertificatePEM  string `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS int64  `json:"client_expires_at_unix_ms"`
}

type MemberRotateRequest struct {
	ProtocolVersion string        `json:"protocol_version"`
	GatewayID       string        `json:"gateway_id"`
	MemberID        string        `json:"member_id"`
	MemberVersion   int64         `json:"member_version"`
	DeliveryID      string        `json:"delivery_id"`
	ClientCSRPEM    string        `json:"client_csr_pem"`
	Service         MemberService `json:"service"`
	Signature       string        `json:"signature"`
}

type MemberRotateResponse struct {
	ProtocolVersion       string `json:"protocol_version"`
	MemberID              string `json:"member_id"`
	MemberVersion         int64  `json:"member_version"`
	DeliveryID            string `json:"delivery_id"`
	ClientCertificatePEM  string `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS int64  `json:"client_expires_at_unix_ms"`
}

type Member struct {
	MemberID               string          `json:"member_id"`
	RuntimePublicID        string          `json:"runtime_public_id"`
	MemberVersion          int64           `json:"member_version"`
	DisplayName            string          `json:"display_name"`
	State                  string          `json:"state"`
	Connected              bool            `json:"connected"`
	LastSeenAtUnixMS       int64           `json:"last_seen_at_unix_ms"`
	CloudPermission        CloudPermission `json:"cloud_permission"`
	EffectiveCloudAllowed  bool            `json:"effective_cloud_allowed"`
	CloudState             string          `json:"cloud_state"`
	CloudRevocationPending bool            `json:"cloud_revocation_pending"`
	Metadata               MemberMetadata  `json:"metadata"`
}

type GatewayPolicy struct {
	Revision            int64           `json:"revision"`
	DefaultCloudAllowed bool            `json:"default_cloud_allowed"`
	PublicationMode     PublicationMode `json:"publication_mode"`
}

type MemberPolicyUpdate struct {
	MemberID              string          `json:"member_id"`
	ExpectedMemberVersion int64           `json:"expected_member_version"`
	CloudPermission       CloudPermission `json:"cloud_permission"`
}

type MemberOperationResult struct {
	MemberID  string  `json:"member_id"`
	Member    *Member `json:"member,omitempty"`
	ErrorCode string  `json:"error_code,omitempty"`
}

type HookAction string

type HookStatus string

const (
	HookNotConfigured HookStatus = "not_configured"
	HookConfigured    HookStatus = "configured"
	HookInvalid       HookStatus = "invalid"
)

const (
	HookMemberAdmit  HookAction = "member.admit"
	HookAccessOpen   HookAction = "access.open"
	HookCloudPublish HookAction = "cloud.publish"
)

type HookInput struct {
	Version           int        `json:"version"`
	Action            HookAction `json:"action"`
	GatewayID         string     `json:"gateway_id"`
	MemberID          string     `json:"member_id"`
	RuntimePublicID   string     `json:"runtime_public_id"`
	DesktopKeyID      string     `json:"desktop_key_id,omitempty"`
	NamespacePublicID string     `json:"namespace_public_id,omitempty"`
	PolicyRevision    int64      `json:"policy_revision"`
}

type HookResult struct {
	Version    int    `json:"version"`
	Allowed    bool   `json:"allowed"`
	ReasonCode string `json:"reason_code"`
}

// MemberCloudContext is a Gateway observation, never a Runtime Cloud credential.
// The Runtime proves its identity independently to Cloud before receiving a binding.
type MemberCloudContext struct {
	ProtocolVersion   string `json:"protocol_version"`
	GatewayID         string `json:"gateway_id"`
	MemberID          string `json:"member_id"`
	MemberVersion     int64  `json:"member_version"`
	CloudOrigin       string `json:"cloud_origin,omitempty"`
	RegionOrigin      string `json:"region_origin,omitempty"`
	NamespacePublicID string `json:"namespace_public_id,omitempty"`
	GatewayPublicID   string `json:"gateway_public_id,omitempty"`
	PolicyRevision    int64  `json:"policy_revision"`
	Allowed           bool   `json:"allowed"`
	State             string `json:"state"`
}

type ConfigureCloudRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	CloudOrigin     string `json:"cloud_origin"`
	Reauthorize     bool   `json:"reauthorize"`
}
