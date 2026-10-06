package gatewaycloud

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"time"
)

const ProtocolVersion = 1

var ErrInvalidProof = errors.New("GATEWAY_PROOF_INVALID")

type Purpose string

const (
	PurposeUserMigration      Purpose = "user_migration"
	PurposeGatewayRegister    Purpose = "gateway_register"
	PurposeGatewayStatus      Purpose = "gateway_status"
	PurposeRuntimeStatus      Purpose = "runtime_status"
	PurposeGatewaySync        Purpose = "gateway_sync"
	PurposeRuntimeJoin        Purpose = "runtime_join"
	PurposeRuntimeRecover     Purpose = "runtime_recover"
	PurposeGenerationRenew    Purpose = "generation_renew"
	PurposeRuntimeReauthorize Purpose = "runtime_reauthorize"
	PurposeRuntimeMigrate     Purpose = "runtime_migrate"
	PurposeIdentityRotate     Purpose = "identity_rotate"
	PurposeCertificateRotate  Purpose = "certificate_rotate"
	PurposeClosureAck         Purpose = "closure_ack"
)

type Proof struct {
	ProtocolVersion   int     `json:"protocol_version"`
	Purpose           Purpose `json:"purpose"`
	CloudOrigin       string  `json:"cloud_origin"`
	NamespacePublicID string  `json:"namespace_public_id"`
	GatewayPublicID   string  `json:"gateway_public_id"`
	RuntimePublicID   string  `json:"runtime_public_id"`
	BindingPublicID   string  `json:"binding_public_id"`
	BindingGeneration int64   `json:"binding_generation"`
	ChallengeID       string  `json:"challenge_id"`
	ChallengeB64u     string  `json:"challenge_b64u"`
	ExpiresAtUnixMS   int64   `json:"expires_at_unix_ms"`
	BodySHA256        string  `json:"body_sha256"`
	SignatureB64u     string  `json:"signature_b64u"`
}

func (p Proof) SigningBytes() ([]byte, error) {
	if p.ProtocolVersion != ProtocolVersion || !p.Purpose.Valid() || !ValidOrigin(p.CloudOrigin) ||
		p.ChallengeID == "" || p.ExpiresAtUnixMS <= 0 || p.BindingGeneration < 0 {
		return nil, ErrInvalidProof
	}
	challenge, err := DecodeKey(p.ChallengeB64u)
	if err != nil || len(challenge) != 32 {
		return nil, ErrInvalidProof
	}
	digest, err := hex.DecodeString(p.BodySHA256)
	if err != nil || len(digest) != sha256.Size || hex.EncodeToString(digest) != p.BodySHA256 {
		return nil, ErrInvalidProof
	}
	var out bytes.Buffer
	out.WriteString("redeven.gateway-cloud.proof.v1\x00")
	for _, value := range []string{string(p.Purpose), p.CloudOrigin, p.NamespacePublicID, p.GatewayPublicID, p.RuntimePublicID, p.BindingPublicID, p.ChallengeID, p.ChallengeB64u, p.BodySHA256} {
		if len(value) > 512 || strings.ContainsAny(value, "\x00\r\n") {
			return nil, ErrInvalidProof
		}
		_ = binary.Write(&out, binary.BigEndian, uint32(len(value)))
		out.WriteString(value)
	}
	_ = binary.Write(&out, binary.BigEndian, p.BindingGeneration)
	_ = binary.Write(&out, binary.BigEndian, p.ExpiresAtUnixMS)
	return out.Bytes(), nil
}

func (p Proof) Verify(publicKeyB64u string, body []byte, now time.Time) error {
	public, err := DecodeKey(publicKeyB64u)
	if err != nil || len(public) != ed25519.PublicKeySize || p.ExpiresAtUnixMS <= now.UnixMilli() || p.ExpiresAtUnixMS > now.Add(5*time.Minute).UnixMilli() {
		return ErrInvalidProof
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != p.BodySHA256 {
		return ErrInvalidProof
	}
	message, err := p.SigningBytes()
	if err != nil {
		return err
	}
	signature, err := DecodeKey(p.SignatureB64u)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(public, message, signature) {
		return ErrInvalidProof
	}
	return nil
}

func (p *Proof) Sign(private ed25519.PrivateKey, body []byte) error {
	if p == nil || len(private) != ed25519.PrivateKeySize {
		return ErrInvalidProof
	}
	digest := sha256.Sum256(body)
	p.BodySHA256 = hex.EncodeToString(digest[:])
	message, err := p.SigningBytes()
	if err != nil {
		return err
	}
	p.SignatureB64u = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, message))
	return nil
}

func DecodeKey(value string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != value {
		return nil, ErrInvalidProof
	}
	return raw, nil
}

func (p Purpose) Valid() bool {
	switch p {
	case PurposeRuntimeReauthorize, PurposeUserMigration, PurposeGenerationRenew, PurposeCertificateRotate, PurposeGatewayRegister, PurposeGatewayStatus, PurposeRuntimeStatus, PurposeGatewaySync, PurposeRuntimeJoin, PurposeRuntimeRecover, PurposeRuntimeMigrate, PurposeIdentityRotate, PurposeClosureAck:
		return true
	default:
		return false
	}
}

func ValidOrigin(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Path == "" && u.RawPath == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.Opaque == "" && u.String() == value
}

func RotationSigningBytes(proof Proof, newPublicKeyB64u string) ([]byte, error) {
	if proof.Purpose != PurposeIdentityRotate {
		return nil, ErrInvalidProof
	}
	key, err := DecodeKey(newPublicKeyB64u)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return nil, ErrInvalidProof
	}
	digest := sha256.Sum256([]byte(newPublicKeyB64u))
	proof.BodySHA256 = hex.EncodeToString(digest[:])
	raw, err := proof.SigningBytes()
	if err != nil {
		return nil, err
	}
	return append([]byte("redeven.gateway-cloud.key-rotation.v1\x00"), raw...), nil
}
