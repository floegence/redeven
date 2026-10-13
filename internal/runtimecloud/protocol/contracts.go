package protocol

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

const ProtocolVersion = "rcpp-v5"

type OwnerKind string

const (
	OwnerUser      OwnerKind = "user"
	OwnerNamespace OwnerKind = "namespace"
)

type BindingFence struct {
	PublicID          string    `json:"public_id"`
	CloudID           string    `json:"cloud_id"`
	RuntimePublicID   string    `json:"runtime_public_id"`
	EnvPublicID       string    `json:"env_public_id"`
	NamespacePublicID string    `json:"namespace_public_id"`
	OwnerKind         OwnerKind `json:"owner_kind"`
	OwnerPublicID     string    `json:"owner_public_id"`
	Generation        int64     `json:"generation"`
}

func (b BindingFence) Valid() bool {
	for _, value := range []string{b.PublicID, b.CloudID, b.RuntimePublicID, b.EnvPublicID, b.NamespacePublicID, b.OwnerPublicID} {
		if value == "" || strings.TrimSpace(value) != value || len(value) > 128 {
			return false
		}
	}
	return b.Generation > 0 && (b.OwnerKind == OwnerUser || b.OwnerKind == OwnerNamespace && b.OwnerPublicID == b.NamespacePublicID)
}

type Binding struct {
	BindingFence
	Region                  string `json:"region"`
	State                   string `json:"state"`
	PublicKeyB64u           string `json:"public_key_b64u"`
	IdentityExpiresAtUnixMS int64  `json:"identity_expires_at_unix_ms"`
}

func (b Binding) Valid() bool {
	return b.BindingFence.Valid() && b.Region != "" && b.State == "active" && ValidPublicKey(b.PublicKeyB64u) && b.IdentityExpiresAtUnixMS > 0
}

func ValidPublicKey(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 32 && base64.RawURLEncoding.EncodeToString(raw) == value
}

type Metadata struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

type ChallengeRequest struct {
	ProtocolVersion   string  `json:"protocol_version"`
	NamespacePublicID string  `json:"namespace_public_id"`
	Purpose           Purpose `json:"purpose"`
	RuntimePublicID   string  `json:"runtime_public_id"`
	BindingPublicID   string  `json:"binding_public_id,omitempty"`
}

type ChallengeResponse struct {
	Proof Proof `json:"proof"`
}

type SignedRequest struct {
	Proof   Proof           `json:"proof"`
	Payload json.RawMessage `json:"payload"`
}

type EnrollmentAuthorization struct {
	RuntimeLinkTicket   string          `json:"runtime_link_ticket,omitempty"`
	EnvPublicID         string          `json:"env_public_id,omitempty"`
	GatewayPublicID     string          `json:"gateway_public_id,omitempty"`
	MemberID            string          `json:"member_id,omitempty"`
	MemberVersion       int64           `json:"member_version,omitempty"`
	Delegation          json.RawMessage `json:"delegation,omitempty"`
	MemberAuthorization string          `json:"member_authorization,omitempty"`
}

func (a EnrollmentAuthorization) Valid() bool {
	if a.RuntimeLinkTicket != "" {
		return a.EnvPublicID != "" && a.GatewayPublicID == "" && a.MemberID == "" && a.MemberVersion == 0 && len(a.Delegation) == 0 && a.MemberAuthorization == ""
	}
	return a.EnvPublicID == "" && a.GatewayPublicID != "" && a.MemberID != "" && a.MemberVersion > 0 && len(a.Delegation) > 0 && a.MemberAuthorization != ""
}

type RecoverAuthorizationResponse struct {
	ProtocolVersion     string        `json:"protocol_version"`
	State               ApprovalState `json:"state"`
	ReasonCode          string        `json:"reason_code,omitempty"`
	RetryAfterMS        int64         `json:"retry_after_ms"`
	Binding             *Binding      `json:"binding,omitempty"`
	Closures            []Closure     `json:"closures"`
	NextClosureCursor   string        `json:"next_closure_cursor,omitempty"`
	PendingClosureCount int64         `json:"pending_closure_count"`
}

type EnrollRequest struct {
	OperationID     string                  `json:"operation_id"`
	RuntimePublicID string                  `json:"runtime_public_id"`
	PublicKeyB64u   string                  `json:"public_key_b64u"`
	Authorization   EnrollmentAuthorization `json:"authorization"`
	Metadata        Metadata                `json:"metadata"`
}

type RecoverRequest struct {
	EnrollmentOperationID string `json:"enrollment_operation_id,omitempty"`
	ClosureAfter          string `json:"closure_after,omitempty"`
	RuntimePublicID       string `json:"runtime_public_id"`
	BindingPublicID       string `json:"binding_public_id,omitempty"`
	DeliveryRequestID     string `json:"delivery_request_id"`
}

type ApprovalState string

const (
	ApprovalApproved         ApprovalState = "approved"
	ApprovalPending          ApprovalState = "pending"
	ApprovalRevoked          ApprovalState = "revoked"
	ApprovalIdentityRequired ApprovalState = "identity_required"
	ApprovalActionRequired   ApprovalState = "action_required"
)

const (
	ReasonAwaitingApproval = "AWAITING_APPROVAL"
	ReasonRevoked          = "AUTHORIZATION_REVOKED"
	ReasonIdentityExpired  = "IDENTITY_EXPIRED"
	ReasonBindingChanged   = "BINDING_CHANGED"
	RecoveryRetryAfterMS   = 30000
)

type CredentialDelivery struct {
	ProtocolVersion     string                 `json:"protocol_version"`
	CloudOrigin         string                 `json:"cloud_origin"`
	RegionOrigin        string                 `json:"region_origin"`
	Binding             Binding                `json:"binding"`
	DeliveryRequestID   string                 `json:"delivery_request_id"`
	ControlArtifactPool *ControlArtifactPoolV2 `json:"control_artifact_pool"`
}

type RecoverResponse struct {
	ProtocolVersion     string              `json:"protocol_version"`
	State               ApprovalState       `json:"state"`
	ReasonCode          string              `json:"reason_code,omitempty"`
	RetryAfterMS        int64               `json:"retry_after_ms"`
	Binding             *Binding            `json:"binding,omitempty"`
	Delivery            *CredentialDelivery `json:"delivery,omitempty"`
	Closures            []Closure           `json:"closures"`
	NextClosureCursor   string              `json:"next_closure_cursor,omitempty"`
	PendingClosureCount int64               `json:"pending_closure_count"`
}

func (r RecoverResponse) Valid() bool {
	if r.ProtocolVersion != ProtocolVersion || r.RetryAfterMS < 0 || r.RetryAfterMS > 60000 || r.PendingClosureCount < 0 || len(r.Closures) > 50 || r.PendingClosureCount < int64(len(r.Closures)) {
		return false
	}
	if r.Binding != nil && (!r.Binding.BindingFence.Valid() || !ValidPublicKey(r.Binding.PublicKeyB64u)) {
		return false
	}
	for _, closure := range r.Closures {
		if closure.PublicID == "" || closure.BindingPublicID == "" || closure.RuntimePublicID == "" || closure.Generation < 1 || closure.RuntimeClosed {
			return false
		}
		if r.Binding != nil && (closure.BindingPublicID != r.Binding.PublicID || closure.RuntimePublicID != r.Binding.RuntimePublicID) {
			return false
		}
	}
	if r.State == ApprovalApproved {
		return r.ReasonCode == "" && r.Binding != nil && r.Binding.Valid() && r.Delivery != nil && r.Delivery.ProtocolVersion == ProtocolVersion && r.Delivery.Binding == *r.Binding && r.Delivery.ControlArtifactPool != nil
	}
	return r.Delivery == nil && r.ReasonCode != "" && (r.State == ApprovalPending || r.State == ApprovalRevoked || r.State == ApprovalIdentityRequired || r.State == ApprovalActionRequired)
}

type Closure struct {
	PublicID        string `json:"public_id"`
	BindingPublicID string `json:"binding_public_id"`
	RuntimePublicID string `json:"runtime_public_id"`
	Generation      int64  `json:"generation"`
	Reason          string `json:"reason"`
	RuntimeClosed   bool   `json:"runtime_closed"`
}

type ClosureAck struct {
	ClosurePublicID string `json:"closure_public_id"`
	BindingPublicID string `json:"binding_public_id"`
	Generation      int64  `json:"generation"`
}

type BindingOperationRequest struct {
	OperationID string       `json:"operation_id"`
	Binding     BindingFence `json:"binding"`
}

type UserEnrollmentWitness struct {
	Signed               SignedRequest `json:"signed"`
	UserPublicID         string        `json:"user_public_id"`
	EnvPublicID          string        `json:"env_public_id"`
	Region               string        `json:"region"`
	TicketID             string        `json:"ticket_id"`
	TicketExpiresAtUnixS int64         `json:"ticket_expires_at_unix_s"`
}

type CredentialIssueRequest struct {
	Binding           Binding `json:"binding"`
	DeliveryRequestID string  `json:"delivery_request_id"`
}

type RouteSelection struct {
	Kind     string `json:"kind"`
	MemberID string `json:"member_id,omitempty"`
}

type RoutePreflightRequest struct {
	OperationID           string         `json:"operation_id"`
	ExpectedRouteRevision int64          `json:"expected_route_revision"`
	Selection             RouteSelection `json:"selection"`
}

type RouteCommitRequest struct {
	OperationID string `json:"operation_id"`
	Confirmed   bool   `json:"confirmed"`
}

type RouteOperation struct {
	RouteFingerprint       string         `json:"route_fingerprint"`
	OperationID            string         `json:"operation_id"`
	ExpectedRouteRevision  int64          `json:"expected_route_revision"`
	AssociationRevision    int64          `json:"association_revision"`
	Selection              RouteSelection `json:"selection"`
	State                  string         `json:"state"`
	ExpiresAtUnixMS        int64          `json:"expires_at_unix_ms"`
	CommittedRouteRevision int64          `json:"committed_route_revision,omitempty"`
	ReasonCode             string         `json:"reason_code,omitempty"`
}

// Status separates authorization, connection and selected route. It contains
// presentation metadata only, never machine keys or connection credentials.
type Status struct {
	AssociationRevision int64          `json:"association_revision"`
	Enabled             bool           `json:"enabled"`
	ApprovalState       ApprovalState  `json:"approval_state"`
	ReasonCode          string         `json:"reason_code,omitempty"`
	ConnectionState     string         `json:"connection_state"`
	Route               RouteSelection `json:"route"`
	RouteRevision       int64          `json:"route_revision"`
	NextAttemptAtUnixMS int64          `json:"next_attempt_at_unix_ms,omitempty"`
}
type RetryRequest struct {
	ExpectedAssociationRevision int64 `json:"expected_association_revision"`
}

// ClosureList describes closure facts for the selected Cloud binding.
type ClosureList struct {
	Items      []Closure `json:"items"`
	NextCursor string    `json:"next_cursor,omitempty"`
}

// BindingLookup returns authorization metadata without connection credentials.
type BindingLookup struct {
	Binding *Binding `json:"binding"`
}
