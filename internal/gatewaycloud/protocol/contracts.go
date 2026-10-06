package gatewaycloud

import "encoding/json"

const MaxGatewayMembers = 1024
const ClosurePageSize = 50

type SignedRequest struct {
	Proof   Proof           `json:"proof"`
	Payload json.RawMessage `json:"payload"`
}

type ChallengeRequest struct {
	Purpose         Purpose `json:"purpose"`
	GatewayPublicID string  `json:"gateway_public_id"`
	RuntimePublicID string  `json:"runtime_public_id,omitempty"`
	BindingPublicID string  `json:"binding_public_id,omitempty"`
}

type ChallengeResponse struct {
	Proof Proof `json:"proof"`
}

type GatewayRegistration struct {
	PublicKeyB64u string `json:"public_key_b64u"`
	ListenerURL   string `json:"listener_url"`
	TLSRootPEM    string `json:"tls_root_pem"`
	Version       string `json:"version"`
}

type GatewayApproval struct {
	GatewayPublicID   string `json:"gateway_public_id"`
	NamespacePublicID string `json:"namespace_public_id"`
	Region            string `json:"region"`
	Name              string `json:"name"`
	PublicKeySHA256   string `json:"public_key_sha256"`
}

type Gateway struct {
	DirectorySyncedAtUnixMS int64  `json:"directory_synced_at_unix_ms"`
	IdentityExpiresAtUnixMS int64  `json:"identity_expires_at_unix_ms"`
	PublicID                string `json:"public_id"`
	NamespacePublicID       string `json:"namespace_public_id"`
	Region                  string `json:"region"`
	Name                    string `json:"name"`
	State                   string `json:"state"`
	PublicKeySHA256         string `json:"public_key_sha256"`
	ListenerURL             string `json:"listener_url"`
	TLSRootPEM              string `json:"tls_root_pem"`
	Version                 string `json:"version"`
	DirectoryRevision       int64  `json:"directory_revision"`
	LastSeenAtUnixMS        int64  `json:"last_seen_at_unix_ms"`
}

type JoinMaterial struct {
	ProtocolVersion        int    `json:"protocol_version"`
	CloudOrigin            string `json:"cloud_origin"`
	RegionOrigin           string `json:"region_origin"`
	NamespacePublicID      string `json:"namespace_public_id"`
	GatewayPublicID        string `json:"gateway_public_id"`
	RequestPublicID        string `json:"request_public_id"`
	GatewayURL             string `json:"gateway_url"`
	GatewayTLSRootPEM      string `json:"gateway_tls_root_pem"`
	JoinToken              string `json:"join_token"`
	GatewayEnrollmentToken string `json:"gateway_enrollment_token"`
	ExpiresAtUnixMS        int64  `json:"expires_at_unix_ms"`
}

type RuntimeJoin struct {
	NewEnvironment          bool            `json:"new_environment"`
	RequestPublicID         string          `json:"request_public_id"`
	JoinToken               string          `json:"join_token"`
	RuntimePublicID         string          `json:"runtime_public_id"`
	PublicKeyB64u           string          `json:"public_key_b64u"`
	ClientCertificateSHA256 string          `json:"client_certificate_sha256"`
	LocalConsent            bool            `json:"local_consent"`
	Metadata                RuntimeMetadata `json:"metadata"`
}

type RuntimeMetadata struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

type DirectorySync struct {
	ListenerURL  string            `json:"listener_url,omitempty"`
	BaseRevision int64             `json:"base_revision"`
	Revision     int64             `json:"revision"`
	Full         bool              `json:"full"`
	Members      []DirectoryMember `json:"members"`
}

type DirectoryMember struct {
	RequestPublicID         string `json:"request_public_id"`
	RuntimePublicID         string `json:"runtime_public_id"`
	ClientCertificateSHA256 string `json:"client_certificate_sha256"`
	Reachable               bool   `json:"reachable"`
}

type Candidate struct {
	AuthorizationExpiresAtUnixMS int64                `json:"authorization_expires_at_unix_ms"`
	NewEnvironment               bool                 `json:"new_environment"`
	Reauthorization              bool                 `json:"reauthorization,omitempty"`
	UserMigrationSource          *UserMigrationSource `json:"user_migration_source,omitempty"`
	MigrationSource              *BindingFence        `json:"migration_source,omitempty"`
	EnvironmentName              string               `json:"environment_name,omitempty"`
	RequestPublicID              string               `json:"request_public_id"`
	RuntimePublicID              string               `json:"runtime_public_id"`
	State                        string               `json:"state"`
	Proven                       bool                 `json:"proven"`
	Reachable                    bool                 `json:"reachable"`
	Binding                      *Binding             `json:"binding,omitempty"`
	Metadata                     RuntimeMetadata      `json:"metadata"`
}

type PublishItem struct {
	RequestPublicID string `json:"request_public_id"`
	Name            string `json:"name"`
}

type PublishRequest struct {
	Items []PublishItem `json:"items"`
}

type PublishResult struct {
	RequestPublicID string   `json:"request_public_id"`
	Binding         *Binding `json:"binding,omitempty"`
	ErrorCode       string   `json:"error_code,omitempty"`
}

type Binding struct {
	PublicID          string `json:"public_id"`
	NamespacePublicID string `json:"namespace_public_id"`
	GatewayPublicID   string `json:"gateway_public_id"`
	RuntimePublicID   string `json:"runtime_public_id"`
	EnvPublicID       string `json:"env_public_id"`
	Region            string `json:"region"`
	Generation        int64  `json:"generation"`
	State             string `json:"state"`
}

type BindingFence struct {
	ProtocolVersion   int    `json:"protocol_version"`
	PublicID          string `json:"public_id"`
	NamespacePublicID string `json:"namespace_public_id"`
	GatewayPublicID   string `json:"gateway_public_id"`
	RuntimePublicID   string `json:"runtime_public_id"`
	Generation        int64  `json:"generation"`
}

func (b BindingFence) Valid() bool {
	return b.ProtocolVersion == ProtocolVersion && b.PublicID != "" && b.NamespacePublicID != "" && b.GatewayPublicID != "" && b.RuntimePublicID != "" && b.Generation > 0
}

type RecoverRequest struct {
	Binding           BindingFence `json:"binding"`
	DeliveryRequestID string       `json:"delivery_request_id"`
}

type ValidateBindingRequest struct {
	Binding     BindingFence `json:"binding"`
	EnvPublicID string       `json:"env_public_id"`
}

type MigrationConsent struct {
	Reauthorize           bool         `json:"reauthorize"`
	Current               BindingFence `json:"current"`
	TargetRequestPublicID string       `json:"target_request_public_id"`
}

type RevokeRequest struct {
	Reason string `json:"reason"`
}

type Closure struct {
	Reason          string `json:"reason"`
	PublicID        string `json:"public_id"`
	BindingPublicID string `json:"binding_public_id"`
	GatewayPublicID string `json:"gateway_public_id"`
	RuntimePublicID string `json:"runtime_public_id"`
	Generation      int64  `json:"generation"`
	RuntimeClosed   bool   `json:"runtime_closed"`
	GatewayClosed   bool   `json:"gateway_closed"`
}

type ClosureAck struct {
	ClosurePublicID string `json:"closure_public_id"`
	Generation      int64  `json:"generation"`
	Side            string `json:"side"`
}

type RotateIdentity struct {
	NewPublicKeyB64u string `json:"new_public_key_b64u"`
	NewKeyProofB64u  string `json:"new_key_proof_b64u"`
}

type GatewayStatusRequest struct {
	ClosureAfter string `json:"closure_after,omitempty"`
}

type JoinPermit struct {
	RequestPublicID string `json:"request_public_id"`
	TokenSHA256     string `json:"token_sha256"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
}

type EgressMember struct {
	RequestPublicID         string   `json:"request_public_id"`
	RuntimePublicID         string   `json:"runtime_public_id"`
	ClientCertificateSHA256 string   `json:"client_certificate_sha256"`
	Generation              int64    `json:"generation"`
	Destinations            []string `json:"destinations"`
}

type GatewayStatus struct {
	PendingClosureCount    int64          `json:"pending_closure_count"`
	NextClosureCursor      string         `json:"next_closure_cursor,omitempty"`
	ManagementMembers      []EgressMember `json:"management_members"`
	Gateway                Gateway        `json:"gateway"`
	RegionOrigin           string         `json:"region_origin"`
	JoinPermits            []JoinPermit   `json:"join_permits"`
	EnrollmentDestinations []string       `json:"enrollment_destinations"`
	Members                []EgressMember `json:"members"`
	Closures               []Closure      `json:"closures"`
}

type RuntimeStatusRequest struct {
	ClosureAfter    string `json:"closure_after,omitempty"`
	RequestPublicID string `json:"request_public_id"`
}

type RuntimeStatus struct {
	NextClosureCursor string    `json:"next_closure_cursor,omitempty"`
	Candidate         Candidate `json:"candidate"`
	Closures          []Closure `json:"closures"`
}

type GatewayList struct {
	NextCursor string    `json:"next_cursor,omitempty"`
	Items      []Gateway `json:"items"`
}
type CandidateList struct {
	NextCursor string      `json:"next_cursor,omitempty"`
	Items      []Candidate `json:"items"`
}
type ClosureList struct {
	NextCursor string    `json:"next_cursor,omitempty"`
	Items      []Closure `json:"items"`
}
type PublishResponse struct {
	Items []PublishResult `json:"items"`
}
type EmptyRequest struct{}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Response[T any] struct {
	Success bool   `json:"success"`
	Data    T      `json:"data"`
	Error   *Error `json:"error,omitempty"`
}

type LocalEnrollment struct {
	RequestPublicID string `json:"request_public_id"`
	EnrollmentToken string `json:"enrollment_token"`
	RuntimePublicID string `json:"runtime_public_id"`
	CSRPEM          string `json:"csr_pem"`
}

type LocalEnrollmentResponse struct {
	ClientCertificatePEM string `json:"client_certificate_pem"`
	ExpiresAtUnixMS      int64  `json:"expires_at_unix_ms"`
}

type MigrationApproval struct {
	Reauthorize           bool         `json:"reauthorize"`
	Current               BindingFence `json:"current"`
	TargetRequestPublicID string       `json:"target_request_public_id"`
}

type GenerationRenewal struct {
	Current BindingFence `json:"current"`
}
