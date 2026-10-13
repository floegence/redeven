package protocol

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

type Purpose string

const (
	PurposeEnroll     Purpose = "enroll"
	PurposeRecover    Purpose = "recover"
	PurposeClosureAck Purpose = "closure_ack"
)

func (p Purpose) Valid() bool {
	return p == PurposeEnroll || p == PurposeRecover || p == PurposeClosureAck
}

type Proof struct {
	ProtocolVersion   string  `json:"protocol_version"`
	CloudOrigin       string  `json:"cloud_origin"`
	NamespacePublicID string  `json:"namespace_public_id"`
	Purpose           Purpose `json:"purpose"`
	ChallengeID       string  `json:"challenge_id"`
	NonceB64u         string  `json:"nonce_b64u"`
	RuntimePublicID   string  `json:"runtime_public_id"`
	BindingPublicID   string  `json:"binding_public_id,omitempty"`
	ExpiresAtUnixMS   int64   `json:"expires_at_unix_ms"`
	BodySHA256        string  `json:"body_sha256"`
	Signature         string  `json:"signature"`
}

func (p Proof) signingBytes() ([]byte, error) {
	p.Signature = ""
	raw, err := json.Marshal(p)
	return append([]byte("redeven.runtime.cloud.rcpp-v5\x00"), raw...), err
}

func (p *Proof) Sign(key ed25519.PrivateKey, payload []byte) error {
	if p == nil || len(key) != ed25519.PrivateKeySize {
		return errors.New("invalid runtime identity key")
	}
	digest := sha256.Sum256(payload)
	p.BodySHA256 = hex.EncodeToString(digest[:])
	raw, err := p.signingBytes()
	if err != nil {
		return err
	}
	p.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, raw))
	return nil
}

func (p Proof) Verify(keyB64u string, payload []byte, now time.Time) error {
	nonce, nonceErr := base64.RawURLEncoding.DecodeString(p.NonceB64u)
	if p.CloudOrigin == "" || p.NamespacePublicID == "" || p.ProtocolVersion != ProtocolVersion || !p.Purpose.Valid() || p.ChallengeID == "" || p.RuntimePublicID == "" || nonceErr != nil || len(nonce) != 32 || base64.RawURLEncoding.EncodeToString(nonce) != p.NonceB64u || p.ExpiresAtUnixMS <= now.UnixMilli() || !ValidPublicKey(keyB64u) {
		return errors.New("invalid runtime cloud proof")
	}
	digest := sha256.Sum256(payload)
	if p.BodySHA256 != hex.EncodeToString(digest[:]) {
		return errors.New("runtime cloud payload digest mismatch")
	}
	key, _ := base64.RawURLEncoding.DecodeString(keyB64u)
	signature, err := base64.RawURLEncoding.DecodeString(p.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || base64.RawURLEncoding.EncodeToString(signature) != p.Signature {
		return errors.New("invalid runtime cloud signature")
	}
	raw, err := p.signingBytes()
	if err != nil || !ed25519.Verify(key, raw, signature) {
		return errors.New("runtime cloud signature mismatch")
	}
	return nil
}
