package protocol

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"net/url"
	"strings"
	"time"
)

var ErrInvalidProof = errors.New("GATEWAY_PROOF_INVALID")

type InvitationCodeDelivery struct {
	ProtocolVersion  string   `json:"protocol_version"`
	InvitationID     string   `json:"invitation_id"`
	GatewayID        string   `json:"gateway_id"`
	GatewayName      string   `json:"gateway_name"`
	GatewayPublicKey string   `json:"gateway_public_key"`
	ShareAddress     string   `json:"share_address"`
	ShareAddresses   []string `json:"share_addresses"`
	Code             string   `json:"code"`
	IssuedAtUnixMS   int64    `json:"issued_at_unix_ms"`
	ExpiresAtUnixMS  int64    `json:"expires_at_unix_ms"`
	Signature        string   `json:"signature"`
}

func (InvitationCodeDelivery) String() string   { return "Gateway.InvitationCodeDelivery" }
func (InvitationCodeDelivery) GoString() string { return "Gateway.InvitationCodeDelivery" }

func SignInvitationCodeDelivery(delivery *InvitationCodeDelivery, key ed25519.PrivateKey) error {
	if delivery == nil {
		return ErrInvalidProof
	}
	delivery.Signature = ""
	signature, err := signValue("redeven.gateway.invitation-code-delivery.v1", *delivery, key)
	if err == nil {
		delivery.Signature = signature
	}
	return err
}

func (i InvitationCodeDelivery) Verify(gatewayID, publicKey string, now time.Time) error {
	if strings.TrimSpace(i.GatewayName) == "" || len(i.GatewayName) > 256 || i.ProtocolVersion != Version || i.GatewayID != gatewayID || i.GatewayPublicKey != publicKey || !ValidAttachmentID(i.InvitationID) || len(i.ShareAddresses) == 0 || len(i.ShareAddresses) > 16 || i.IssuedAtUnixMS <= 0 || i.IssuedAtUnixMS > now.Add(time.Minute).UnixMilli() || i.ExpiresAtUnixMS <= now.UnixMilli() || i.ExpiresAtUnixMS-i.IssuedAtUnixMS != int64(10*time.Minute/time.Millisecond) {
		return ErrInvalidProof
	}
	code, err := flowersec.ParseInvitationCode(i.Code)
	if err != nil || code.Text() != i.Code {
		return ErrInvalidProof
	}
	selected := false
	seen := map[string]bool{}
	for _, address := range i.ShareAddresses {
		if !ValidOrigin(address) || seen[address] {
			return ErrInvalidProof
		}
		seen[address] = true
		selected = selected || address == i.ShareAddress
	}
	if !selected {
		return ErrInvalidProof
	}
	signature := i.Signature
	i.Signature = ""
	return verifyValue("redeven.gateway.invitation-code-delivery.v1", i, publicKey, signature)
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

func ValidAttachmentID(value string) bool {
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

func ValidOrigin(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Path == "" && u.RawPath == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.Opaque == "" && u.String() == value
}

func DecodeKey(value string) ([]byte, error) {
	return base64.RawURLEncoding.Strict().DecodeString(value)
}
