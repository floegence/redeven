package protocol

const (
	MemberConnectionStream   = "redeven.gateway.member.https.v6"
	MemberAccessStream       = "redeven.gateway.access.https.v6"
	MaxAttachments           = 1024
	MaxAttachmentConnections = 32
	MaxGatewayConnections    = 1024
)

type EgressPermission string

const (
	EgressInherit EgressPermission = "inherit"
	EgressAllow   EgressPermission = "allow"
	EgressDeny    EgressPermission = "deny"
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

// EnrollmentDescriptor is exchanged only inside the authenticated invitation
// channel. It never enters Desktop, Cloud command results, or user files.
type EnrollmentDescriptor struct {
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

func (EnrollmentDescriptor) String() string   { return "Gateway.EnrollmentDescriptor" }
func (EnrollmentDescriptor) GoString() string { return "Gateway.EnrollmentDescriptor" }

// MemberDelegation is signed by the Runtime at local confirmation. The signed
// Gateway identity scopes independent local access only. Cloud
// enrollment and authorization remain independent Runtime responsibilities.
type MemberDelegation struct {
	ProtocolVersion   string `json:"protocol_version"`
	GatewayID         string `json:"gateway_id"`
	AttachmentID      string `json:"attachment_id"`
	RuntimePublicID   string `json:"runtime_public_id"`
	PublicKeyB64u     string `json:"public_key_b64u"`
	InvitationID      string `json:"invitation_id"`
	ConsentedAtUnixMS int64  `json:"consented_at_unix_ms"`
	ManageAccess      bool   `json:"manage_access"`
	Signature         string `json:"signature"`
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
	AttachmentID          string `json:"attachment_id"`
	AttachmentVersion     int64  `json:"attachment_version"`
	DeliveryID            string `json:"delivery_id"`
	ClientCertificatePEM  string `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS int64  `json:"client_expires_at_unix_ms"`
}

type MemberEndpointUpdateRequest struct {
	ProtocolVersion   string `json:"protocol_version"`
	GatewayID         string `json:"gateway_id"`
	InvitationID      string `json:"invitation_id"`
	Token             string `json:"token"`
	AttachmentID      string `json:"attachment_id"`
	AttachmentVersion int64  `json:"attachment_version"`
	DeliveryID        string `json:"delivery_id"`
	Signature         string `json:"signature"`
}

func (MemberEndpointUpdateRequest) String() string   { return "Gateway.MemberEndpointUpdateRequest" }
func (MemberEndpointUpdateRequest) GoString() string { return "Gateway.MemberEndpointUpdateRequest" }

type MemberEndpointUpdateResponse struct {
	ProtocolVersion   string `json:"protocol_version"`
	GatewayID         string `json:"gateway_id"`
	AttachmentID      string `json:"attachment_id"`
	AttachmentVersion int64  `json:"attachment_version"`
	DeliveryID        string `json:"delivery_id"`
}

type MemberRotateRequest struct {
	ProtocolVersion   string        `json:"protocol_version"`
	GatewayID         string        `json:"gateway_id"`
	AttachmentID      string        `json:"attachment_id"`
	AttachmentVersion int64         `json:"attachment_version"`
	DeliveryID        string        `json:"delivery_id"`
	ClientCSRPEM      string        `json:"client_csr_pem"`
	Service           MemberService `json:"service"`
	Signature         string        `json:"signature"`
}

type MemberRotateResponse struct {
	ProtocolVersion       string `json:"protocol_version"`
	AttachmentID          string `json:"attachment_id"`
	AttachmentVersion     int64  `json:"attachment_version"`
	DeliveryID            string `json:"delivery_id"`
	ClientCertificatePEM  string `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS int64  `json:"client_expires_at_unix_ms"`
}

type RuntimeAttachment struct {
	AttachmentID           string           `json:"attachment_id"`
	RuntimePublicID        string           `json:"runtime_public_id"`
	AttachmentVersion      int64            `json:"attachment_version"`
	DisplayName            string           `json:"display_name"`
	State                  string           `json:"state"`
	Connected              bool             `json:"connected"`
	LastSeenAtUnixMS       int64            `json:"last_seen_at_unix_ms"`
	EgressPermission       EgressPermission `json:"egress_permission"`
	EffectiveEgressAllowed bool             `json:"effective_egress_allowed"`
	Metadata               MemberMetadata   `json:"metadata"`
}

type GatewayPolicy struct {
	Revision             int64    `json:"revision"`
	DefaultEgressAllowed bool     `json:"default_egress_allowed"`
	Destinations         []string `json:"destinations"`
}

type MemberPolicyUpdate struct {
	AttachmentID              string           `json:"attachment_id"`
	ExpectedAttachmentVersion int64            `json:"expected_attachment_version"`
	EgressPermission          EgressPermission `json:"egress_permission"`
}

type MemberOperationResult struct {
	AttachmentID string             `json:"attachment_id"`
	Member       *RuntimeAttachment `json:"member,omitempty"`
	ErrorCode    string             `json:"error_code,omitempty"`
}

type HookAction string

type HookStatus string

const (
	HookNotConfigured HookStatus = "not_configured"
	HookConfigured    HookStatus = "configured"
	HookInvalid       HookStatus = "invalid"
)

const (
	HookAttachmentAdmit HookAction = "attachment.admit"
	HookAccessOpen      HookAction = "access.open"
	HookEgressOpen      HookAction = "egress.open"
)

type HookInput struct {
	Version         int        `json:"version"`
	Action          HookAction `json:"action"`
	GatewayID       string     `json:"gateway_id"`
	AttachmentID    string     `json:"attachment_id"`
	RuntimePublicID string     `json:"runtime_public_id"`
	DesktopKeyID    string     `json:"desktop_key_id,omitempty"`
	PolicyRevision  int64      `json:"policy_revision"`
}

type HookResult struct {
	Version    int    `json:"version"`
	Allowed    bool   `json:"allowed"`
	ReasonCode string `json:"reason_code"`
}
