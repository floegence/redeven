package gatewaymembership

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"golang.org/x/net/idna"
)

var ErrInvalidProof = errors.New("MEMBER_PROOF_INVALID")

const legacyGatewayProtocolVersion = "redeven-gateway-v4"

func decodeKey(value string, size int) ([]byte, error) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || len(raw) != size || base64.RawURLEncoding.EncodeToString(raw) != value {
		return nil, ErrInvalidProof
	}
	return raw, nil
}

func signValue(domain string, value any, private ed25519.PrivateKey) (string, error) {
	if len(private) != ed25519.PrivateKeySize {
		return "", ErrInvalidProof
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", ErrInvalidProof
	}
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, append([]byte(domain+"\x00"), raw...))), nil
}

func verifyValue(domain string, value any, public, signature string) error {
	key, err := decodeKey(public, ed25519.PublicKeySize)
	if err != nil {
		return err
	}
	sig, err := decodeKey(signature, ed25519.SignatureSize)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil || !ed25519.Verify(key, append([]byte(domain+"\x00"), raw...), sig) {
		return ErrInvalidProof
	}
	return nil
}

func validID(value string) bool {
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

// canonicalOrigin normalizes host configuration before it enters signed
// membership material. Every endpoint then uses the same HTTP Origin spelling.
func canonicalOrigin(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.Opaque != "" || strings.ContainsAny(value, "?#\r\n\x00") {
		return "", ErrState
	}
	host := strings.ToLower(u.Hostname())
	if addr, err := netip.ParseAddr(host); err == nil {
		if addr.Zone() != "" {
			return "", ErrState
		}
		host = addr.String()
	} else {
		host, err = idna.Lookup.ToASCII(host)
		if err != nil || host == "" {
			return "", ErrState
		}
	}
	port := u.Port()
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", ErrState
		}
		port = strconv.Itoa(number)
		if port == "443" {
			port = ""
		}
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return "https://" + host, nil
}

func validOrigin(value string) bool {
	canonical, err := canonicalOrigin(value)
	return err == nil && canonical == value
}

func validateGatewayEndpoints(endpoints []gp.GatewayEndpoint) error {
	if len(endpoints) == 0 || len(endpoints) > 16 {
		return ErrInvalidProof
	}
	ids := make(map[string]struct{}, len(endpoints))
	addresses := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		if !validID(endpoint.EndpointID) || len(endpoint.EndpointID) > 64 || !validOrigin(endpoint.Address) || endpoint.Priority < 0 || endpoint.Priority > 1000 {
			return ErrInvalidProof
		}
		if endpoint.Scope != gp.GatewayEndpointLAN && endpoint.Scope != gp.GatewayEndpointOverlay && endpoint.Scope != gp.GatewayEndpointPublic {
			return ErrInvalidProof
		}
		if _, exists := ids[endpoint.EndpointID]; exists {
			return ErrInvalidProof
		}
		if _, exists := addresses[endpoint.Address]; exists {
			return ErrInvalidProof
		}
		ids[endpoint.EndpointID] = struct{}{}
		addresses[endpoint.Address] = struct{}{}
	}
	return nil
}

func SignInvitation(invitation *gp.MemberInvitation, private ed25519.PrivateKey) error {
	if invitation == nil || validateGatewayEndpoints(invitation.Endpoints) != nil {
		return ErrInvalidProof
	}
	invitation.Signature = ""
	signature, err := signValue("redeven.gateway.invitation.v5", *invitation, private)
	if err == nil {
		invitation.Signature = signature
	}
	return err
}

func VerifyInvitation(invitation gp.MemberInvitation, now time.Time) error {
	if invitation.ProtocolVersion != gp.Version || !validID(invitation.InvitationID) || !validID(invitation.GatewayID) || validateGatewayEndpoints(invitation.Endpoints) != nil || invitation.IssuedAtUnixMS <= 0 || invitation.IssuedAtUnixMS > now.Add(time.Minute).UnixMilli() || invitation.ExpiresAtUnixMS <= now.UnixMilli() || invitation.ExpiresAtUnixMS-invitation.IssuedAtUnixMS != int64((10*time.Minute)/time.Millisecond) {
		return ErrInvalidProof
	}
	if strings.TrimSpace(invitation.GatewayName) == "" || len(invitation.GatewayName) > 256 {
		return ErrInvalidProof
	}
	if _, err := decodeKey(invitation.Token, 32); err != nil {
		return err
	}
	root := x509.NewCertPool()
	if !root.AppendCertsFromPEM([]byte(invitation.GatewayTLSRootPEM)) {
		return ErrInvalidProof
	}
	signature := invitation.Signature
	invitation.Signature = ""
	return verifyValue("redeven.gateway.invitation.v5", invitation, invitation.GatewayPublicKey, signature)
}

func SignDelegation(delegation *gp.MemberDelegation, private ed25519.PrivateKey) error {
	delegation.Signature = ""
	signature, err := signValue("redeven.gateway.delegation.v5", *delegation, private)
	if err == nil {
		delegation.Signature = signature
	}
	return err
}

func MemberID(invitationID, publicKey string) string {
	sum := sha256.Sum256([]byte("redeven.gateway.member.v5\x00" + invitationID + "\x00" + publicKey))
	return "member_" + hex.EncodeToString(sum[:24])
}

func legacyMemberID(invitationID, publicKey string) string {
	sum := sha256.Sum256([]byte("redeven.gateway.member.v4\x00" + invitationID + "\x00" + publicKey))
	return "member_" + hex.EncodeToString(sum[:24])
}

func VerifyDelegation(delegation gp.MemberDelegation) error {
	domain, expectedMemberID := "redeven.gateway.delegation.v5", MemberID(delegation.InvitationID, delegation.PublicKeyB64u)
	if delegation.ProtocolVersion == legacyGatewayProtocolVersion {
		domain, expectedMemberID = "redeven.gateway.delegation.v4", legacyMemberID(delegation.InvitationID, delegation.PublicKeyB64u)
	} else if delegation.ProtocolVersion != gp.Version {
		return ErrInvalidProof
	}
	if !validID(delegation.GatewayID) || delegation.MemberID != expectedMemberID || !validID(delegation.RuntimePublicID) || !validID(delegation.InvitationID) || delegation.ConsentedAtUnixMS <= 0 || !delegation.ManageAccess || !delegation.ManageCloudPublication {
		return ErrInvalidProof
	}
	signature := delegation.Signature
	delegation.Signature = ""
	return verifyValue(domain, delegation, delegation.PublicKeyB64u, signature)
}

func SignJoin(request *gp.MemberJoinRequest, private ed25519.PrivateKey) error {
	request.Signature = ""
	signature, err := signValue("redeven.gateway.member-join.v5", *request, private)
	if err == nil {
		request.Signature = signature
	}
	return err
}

func VerifyJoin(request gp.MemberJoinRequest, gatewayID string, now time.Time) error {
	if request.ProtocolVersion != gp.Version || !validID(request.DeliveryID) || request.Delegation.GatewayID != gatewayID || request.InvitationID != request.Delegation.InvitationID || request.Delegation.ConsentedAtUnixMS > now.Add(time.Minute).UnixMilli() || len(request.ClientCSRPEM) > 4096 || len(request.Metadata.Hostname) > 255 || len(request.Metadata.OS) > 64 || len(request.Metadata.Arch) > 64 || len(request.Metadata.Version) > 64 {
		return ErrInvalidProof
	}
	if err := VerifyDelegation(request.Delegation); err != nil {
		return err
	}
	if err := VerifyMemberService(request.Service, request.Delegation, now); err != nil {
		return err
	}
	signature := request.Signature
	request.Signature = ""
	return verifyValue("redeven.gateway.member-join.v5", request, request.Delegation.PublicKeyB64u, signature)
}

func ServiceOrigin(runtimeID string) string {
	digest := sha256.Sum256([]byte(runtimeID))
	return "https://r-" + hex.EncodeToString(digest[:20]) + ".redeven.invalid"
}

type serviceStatement struct {
	MemberID        string           `json:"member_id"`
	RuntimePublicID string           `json:"runtime_public_id"`
	Service         gp.MemberService `json:"service"`
}

// Member signatures bind a TLS certificate to the enrolled identity. Even the
// Gateway cannot substitute its own leaf for an already selected member ID.
func SignService(service *gp.MemberService, delegation gp.MemberDelegation, key ed25519.PrivateKey) error {
	service.Signature = ""
	domain := "redeven.gateway.service.v5"
	if delegation.ProtocolVersion == legacyGatewayProtocolVersion {
		domain = "redeven.gateway.service.v4"
	}
	signature, err := signValue(domain, serviceStatement{delegation.MemberID, delegation.RuntimePublicID, *service}, key)
	if err == nil {
		service.Signature = signature
	}
	return err
}

func VerifyMemberService(service gp.MemberService, delegation gp.MemberDelegation, now time.Time) error {
	if err := VerifyDelegation(delegation); err != nil {
		return err
	}
	if err := VerifyService(service, delegation.RuntimePublicID, now); err != nil {
		return err
	}
	signature := service.Signature
	service.Signature = ""
	domain := "redeven.gateway.service.v5"
	if delegation.ProtocolVersion == legacyGatewayProtocolVersion {
		domain = "redeven.gateway.service.v4"
	}
	return verifyValue(domain, serviceStatement{delegation.MemberID, delegation.RuntimePublicID, service}, delegation.PublicKeyB64u, signature)
}

func VerifyService(service gp.MemberService, runtimeID string, now time.Time) error {
	if service.Revision < 1 || service.Origin != ServiceOrigin(runtimeID) || service.ExpiresAtUnixMS <= now.UnixMilli() || len(service.CertificatePEM) > 8192 {
		return ErrInvalidProof
	}
	block, rest := pem.Decode([]byte(service.CertificatePEM))
	if block == nil || block.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) != 0 {
		return ErrInvalidProof
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil || certificate.NotBefore.After(now) || certificate.NotAfter.UnixMilli() != service.ExpiresAtUnixMS || certificate.VerifyHostname(strings.TrimPrefix(service.Origin, "https://")) != nil {
		return ErrInvalidProof
	}
	digest := sha256.Sum256(certificate.Raw)
	if hex.EncodeToString(digest[:]) != service.CertificateSHA256 {
		return ErrInvalidProof
	}
	return nil
}
