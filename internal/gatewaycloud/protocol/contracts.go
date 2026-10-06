package gatewaycloud

import "encoding/json"

const MaxGatewayMembers = 1024
const ClosurePageSize = 50

// SignedRequest preserves the original payload bytes for signature verification.
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
	Identity      GatewayMachineIdentity `json:"identity"`
	PublicKeyB64u string                 `json:"public_key_b64u"`
	ListenerURL   string                 `json:"listener_url"`
	TLSRootPEM    string                 `json:"tls_root_pem"`
	Version       string                 `json:"version"`
}

type GatewayApproval struct {
	GatewayPublicID   string `json:"gateway_public_id"`
	NamespacePublicID string `json:"namespace_public_id"`
	Region            string `json:"region"`
	Name              string `json:"name"`
	PublicKeySHA256   string `json:"public_key_sha256"`
}

type Gateway struct {
	GatewayID                      string        `json:"gateway_id"`
	Policy                         GatewayPolicy `json:"policy"`
	AutomaticPublicationAuthorized bool          `json:"automatic_publication_authorized"`
	AuthorizationRevision          int64         `json:"authorization_revision"`
	DirectorySyncedAtUnixMS        int64         `json:"directory_synced_at_unix_ms"`
	IdentityExpiresAtUnixMS        int64         `json:"identity_expires_at_unix_ms"`
	PublicID                       string        `json:"public_id"`
	NamespacePublicID              string        `json:"namespace_public_id"`
	Region                         string        `json:"region"`
	Name                           string        `json:"name"`
	State                          string        `json:"state"`
	PublicKeySHA256                string        `json:"public_key_sha256"`
	ListenerURL                    string        `json:"listener_url"`
	TLSRootPEM                     string        `json:"tls_root_pem"`
	Version                        string        `json:"version"`
	DirectoryRevision              int64         `json:"directory_revision"`
	LastSeenAtUnixMS               int64         `json:"last_seen_at_unix_ms"`
}

// RuntimeJoin requires both member delegation and an independent Runtime Cloud key.
type RuntimeJoin struct {
	NewEnvironment      bool             `json:"new_environment"`
	MemberVersion       int64            `json:"member_version"`
	Delegation          MemberDelegation `json:"delegation"`
	PublicKeyB64u       string           `json:"public_key_b64u"`
	MemberAuthorization string           `json:"member_authorization"`
	Metadata            RuntimeMetadata  `json:"metadata"`
}

type RuntimeMetadata struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

type DirectorySync struct {
	Policy       GatewayPolicy     `json:"policy"`
	ListenerURL  string            `json:"listener_url,omitempty"`
	BaseRevision int64             `json:"base_revision"`
	Revision     int64             `json:"revision"`
	Full         bool              `json:"full"`
	Members      []DirectoryMember `json:"members"`
}

type DirectoryMember struct {
	MemberID        string           `json:"member_id"`
	MemberVersion   int64            `json:"member_version"`
	Delegation      MemberDelegation `json:"delegation"`
	State           string           `json:"state"`
	CloudPermission string           `json:"cloud_permission"`
	HookAllowed     bool             `json:"hook_allowed"`
	Reachable       bool             `json:"reachable"`
	Metadata        RuntimeMetadata  `json:"metadata"`
}

type Candidate struct {
	PublicationErrorCode         string               `json:"publication_error_code,omitempty"`
	PublicationApprovalSource    string               `json:"publication_approval_source,omitempty"`
	CloudAllowed                 bool                 `json:"cloud_allowed"`
	PolicyRevision               int64                `json:"policy_revision"`
	MemberID                     string               `json:"member_id"`
	MemberVersion                int64                `json:"member_version"`
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
	MemberID          string `json:"member_id"`
	MemberVersion     int64  `json:"member_version"`
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

// Closure persists independent receipts. Control disconnection never proves data-session closure.
type Closure struct {
	MemberID        string `json:"member_id"`
	MemberVersion   int64  `json:"member_version"`
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

type EgressMember struct {
	State           string   `json:"state"`
	MemberID        string   `json:"member_id"`
	MemberVersion   int64    `json:"member_version"`
	RequestPublicID string   `json:"request_public_id"`
	RuntimePublicID string   `json:"runtime_public_id"`
	Generation      int64    `json:"generation"`
	Destinations    []string `json:"destinations"`
}

type GatewayStatus struct {
	PendingClosureCount   int64            `json:"pending_closure_count"`
	NextClosureCursor     string           `json:"next_closure_cursor,omitempty"`
	ManagementMembers     []EgressMember   `json:"management_members"`
	Gateway               Gateway          `json:"gateway"`
	RegionOrigin          string           `json:"region_origin"`
	Commands              []GatewayCommand `json:"commands"`
	AdmissionDestinations []string         `json:"admission_destinations"`
	Members               []EgressMember   `json:"members"`
	Closures              []Closure        `json:"closures"`
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

// MigrationApproval consumes the Runtime-signed, persisted migration consent.
type MigrationApproval struct {
	Reauthorize           bool         `json:"reauthorize"`
	Current               BindingFence `json:"current"`
	TargetRequestPublicID string       `json:"target_request_public_id"`
}

// GenerationRenewal advances credentials for the same path without changing ownership or environment.
type GenerationRenewal struct {
	Current BindingFence `json:"current"`
}
