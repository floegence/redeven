package gatewaycloud

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const MemberProtocolVersion = "redeven-gateway-v5"

const legacyMemberProtocolVersion = "redeven-gateway-v4"

type GatewayEndpoint = gp.GatewayEndpoint

// MemberDelegation keeps existing v4 member identities verifiable while new
// invitations and members use the v5 endpoint contract.
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

func (i MemberInvitation) Verify(gatewayID, publicKey string, now time.Time) error {
	if strings.TrimSpace(i.GatewayName) == "" || len(i.GatewayName) > 256 {
		return ErrInvalidProof
	}
	if i.ProtocolVersion != MemberProtocolVersion || i.GatewayID != gatewayID || i.GatewayPublicKey != publicKey || !ValidMemberID(i.InvitationID) || len(i.Endpoints) == 0 || len(i.Endpoints) > 16 || i.IssuedAtUnixMS <= 0 || i.IssuedAtUnixMS > now.Add(time.Minute).UnixMilli() || i.ExpiresAtUnixMS <= now.UnixMilli() || i.ExpiresAtUnixMS-i.IssuedAtUnixMS != int64(10*time.Minute/time.Millisecond) {
		return ErrInvalidProof
	}
	seenIDs, seenAddresses := map[string]struct{}{}, map[string]struct{}{}
	for _, endpoint := range i.Endpoints {
		if !ValidMemberID(endpoint.EndpointID) || !ValidOrigin(endpoint.Address) || endpoint.Priority < 0 || endpoint.Priority > 1000 || (endpoint.Scope != gp.GatewayEndpointLAN && endpoint.Scope != gp.GatewayEndpointOverlay && endpoint.Scope != gp.GatewayEndpointPublic) {
			return ErrInvalidProof
		}
		if _, ok := seenIDs[endpoint.EndpointID]; ok {
			return ErrInvalidProof
		}
		if _, ok := seenAddresses[endpoint.Address]; ok {
			return ErrInvalidProof
		}
		seenIDs[endpoint.EndpointID], seenAddresses[endpoint.Address] = struct{}{}, struct{}{}
	}
	token, err := DecodeKey(i.Token)
	if err != nil || len(token) != 32 || len(i.GatewayTLSRootPEM) > 16<<10 || !x509.NewCertPool().AppendCertsFromPEM([]byte(i.GatewayTLSRootPEM)) {
		return ErrInvalidProof
	}
	signature := i.Signature
	i.Signature = ""
	return verifyValue("redeven.gateway.invitation.v5", i, publicKey, signature)
}

type GatewayPolicy struct {
	Revision            int64  `json:"revision"`
	DefaultCloudAllowed bool   `json:"default_cloud_allowed"`
	PublicationMode     string `json:"publication_mode"`
}

func (p GatewayPolicy) Valid() bool {
	return p.Revision > 0 && (p.PublicationMode == "manual" || p.PublicationMode == "automatic")
}

func (m DirectoryMember) CloudAllowed(p GatewayPolicy) bool {
	return m.State == "active" && m.HookAllowed && (m.CloudPermission == "allow" || (m.CloudPermission == "inherit" && p.DefaultCloudAllowed))
}

// GatewayMachineIdentity binds the stable Gateway to its rotating Cloud key.
type GatewayMachineIdentity struct {
	GatewayID     string `json:"gateway_id"`
	PublicKeyB64u string `json:"public_key_b64u"`
	Signature     string `json:"signature"`
}

type AutomaticPublicationApproval struct {
	ExpectedRevision int64 `json:"expected_revision"`
	Authorized       bool  `json:"authorized"`
}

// GatewayCommand permits fixed administrative actions, never programs or arbitrary URLs.
type GatewayCommand struct {
	PublicID        string `json:"public_id"`
	Kind            string `json:"kind"`
	ActorPublicID   string `json:"actor_public_id"`
	MemberID        string `json:"member_id,omitempty"`
	MemberVersion   int64  `json:"member_version,omitempty"`
	CreatedAtUnixMS int64  `json:"created_at_unix_ms"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
}

type GatewayCommandRequest struct {
	RequestID     string `json:"request_id"`
	Kind          string `json:"kind"`
	MemberID      string `json:"member_id,omitempty"`
	MemberVersion int64  `json:"member_version,omitempty"`
}

type GatewayCommandResult struct {
	CommandPublicID string            `json:"command_public_id"`
	Invitation      *MemberInvitation `json:"invitation,omitempty"`
	ErrorCode       string            `json:"error_code,omitempty"`
}

type GatewayCommandStatus struct {
	Command GatewayCommand        `json:"command"`
	State   string                `json:"state"`
	Result  *GatewayCommandResult `json:"result,omitempty"`
}

func ValidMemberID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, c := range value {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}

func MemberID(invitationID, key string) string {
	digest := sha256.Sum256([]byte("redeven.gateway.member.v5\x00" + invitationID + "\x00" + key))
	return "member_" + hex.EncodeToString(digest[:24])
}

func legacyMemberID(invitationID, key string) string {
	digest := sha256.Sum256([]byte("redeven.gateway.member.v4\x00" + invitationID + "\x00" + key))
	return "member_" + hex.EncodeToString(digest[:24])
}

func CandidateID(gatewayID, memberID string) string {
	digest := sha256.Sum256([]byte("redeven.gateway-cloud.candidate.v2\x00" + gatewayID + "\x00" + memberID))
	return "gj_" + hex.EncodeToString(digest[:24])
}

func valueBytes(domain string, value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, ErrInvalidProof
	}
	return append([]byte(domain+"\x00"), raw...), nil
}

func signValue(domain string, value any, key ed25519.PrivateKey) (string, error) {
	if len(key) != ed25519.PrivateKeySize {
		return "", ErrInvalidProof
	}
	raw, err := valueBytes(domain, value)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, raw)), nil
}

func verifyValue(domain string, value any, publicKey, signature string) error {
	key, err := DecodeKey(publicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ErrInvalidProof
	}
	sig, err := DecodeKey(signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return ErrInvalidProof
	}
	raw, err := valueBytes(domain, value)
	if err != nil || !ed25519.Verify(key, raw, sig) {
		return ErrInvalidProof
	}
	return nil
}

func (d MemberDelegation) Verify() error {
	domain, expectedMemberID := "redeven.gateway.delegation.v5", MemberID(d.InvitationID, d.PublicKeyB64u)
	switch d.ProtocolVersion {
	case legacyMemberProtocolVersion:
		domain, expectedMemberID = "redeven.gateway.delegation.v4", legacyMemberID(d.InvitationID, d.PublicKeyB64u)
	case MemberProtocolVersion:
	default:
		return ErrInvalidProof
	}
	if !ValidMemberID(d.GatewayID) || !ValidMemberID(d.InvitationID) || !ValidMemberID(d.RuntimePublicID) || d.MemberID != expectedMemberID || d.ConsentedAtUnixMS <= 0 || !d.ManageAccess || !d.ManageCloudPublication {
		return ErrInvalidProof
	}
	signature := d.Signature
	d.Signature = ""
	return verifyValue(domain, d, d.PublicKeyB64u, signature)
}

// proofContext retains challenge and identity while avoiding a circular payload hash.
func proofContext(proof Proof) Proof {
	proof.BodySHA256, proof.SignatureB64u = "", ""
	return proof
}

func runtimeJoinStatement(proof Proof, request RuntimeJoin) any {
	request.MemberAuthorization = ""
	return struct {
		Proof   Proof       `json:"proof"`
		Request RuntimeJoin `json:"request"`
	}{proofContext(proof), request}
}

func SignRuntimeMembership(proof Proof, request *RuntimeJoin, memberKey ed25519.PrivateKey) error {
	if request == nil || proof.Purpose != PurposeRuntimeJoin {
		return ErrInvalidProof
	}
	signature, err := signValue("redeven.gateway-cloud.member-authorization.v2", runtimeJoinStatement(proof, *request), memberKey)
	if err == nil {
		request.MemberAuthorization = signature
	}
	return err
}

func VerifyRuntimeMembership(proof Proof, request RuntimeJoin, gatewayID string, now time.Time) error {
	if proof.ProtocolVersion != ProtocolVersion || proof.Purpose != PurposeRuntimeJoin || request.MemberVersion < 1 || request.Delegation.Verify() != nil || request.Delegation.GatewayID != gatewayID || request.Delegation.RuntimePublicID != proof.RuntimePublicID || request.Delegation.ConsentedAtUnixMS > now.Add(time.Minute).UnixMilli() || proof.ExpiresAtUnixMS <= now.UnixMilli() {
		return ErrInvalidProof
	}
	return verifyValue("redeven.gateway-cloud.member-authorization.v2", runtimeJoinStatement(proof, request), request.Delegation.PublicKeyB64u, request.MemberAuthorization)
}

func gatewayIdentityStatement(proof Proof, request GatewayRegistration) any {
	request.Identity.Signature = ""
	return struct {
		Proof   Proof               `json:"proof"`
		Request GatewayRegistration `json:"request"`
	}{proofContext(proof), request}
}

func SignGatewayMachineIdentity(proof Proof, request *GatewayRegistration, key ed25519.PrivateKey) error {
	if request == nil || proof.Purpose != PurposeGatewayRegister {
		return ErrInvalidProof
	}
	signature, err := signValue("redeven.gateway-cloud.machine-identity.v2", gatewayIdentityStatement(proof, *request), key)
	if err == nil {
		request.Identity.Signature = signature
	}
	return err
}

func VerifyGatewayMachineIdentity(proof Proof, request GatewayRegistration) error {
	if proof.ProtocolVersion != ProtocolVersion || proof.Purpose != PurposeGatewayRegister || !ValidMemberID(request.Identity.GatewayID) {
		return ErrInvalidProof
	}
	return verifyValue("redeven.gateway-cloud.machine-identity.v2", gatewayIdentityStatement(proof, request), request.Identity.PublicKeyB64u, request.Identity.Signature)
}
