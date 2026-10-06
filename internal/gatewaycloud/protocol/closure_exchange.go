package gatewaycloud

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"time"
)

// RuntimeClosureExchangeRequest observes or acknowledges one exact binding generation.
// Terminal receipts can retry offline and confer no connection, publication, recovery or migration authority.
type RuntimeClosureExchangeRequest struct {
	CloudOrigin    string       `json:"cloud_origin"`
	Binding        BindingFence `json:"binding"`
	IssuedAtUnixMS int64        `json:"issued_at_unix_ms"`
	Closed         bool         `json:"closed"`
	Signature      string       `json:"signature"`
}

type RuntimeClosureExchangeResponse struct {
	Closure  *Closure `json:"closure,omitempty"`
	Accepted bool     `json:"accepted"`
}

func (r RuntimeClosureExchangeRequest) signingBytes() ([]byte, error) {
	if !ValidOrigin(r.CloudOrigin) || !r.Binding.Valid() || r.IssuedAtUnixMS <= 0 {
		return nil, ErrInvalidProof
	}
	r.Signature = ""
	raw, err := json.Marshal(r)
	return append([]byte("redeven.gateway.runtime-closure.v2\x00"), raw...), err
}
func (r *RuntimeClosureExchangeRequest) Sign(key ed25519.PrivateKey) error {
	raw, err := r.signingBytes()
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return ErrInvalidProof
	}
	r.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, raw))
	return nil
}
func (r RuntimeClosureExchangeRequest) Verify(public string, now time.Time) error {
	raw, err := r.signingBytes()
	if err != nil {
		return err
	}
	if r.IssuedAtUnixMS > now.Add(time.Minute).UnixMilli() || (!r.Closed && r.IssuedAtUnixMS < now.Add(-2*time.Minute).UnixMilli()) {
		return ErrInvalidProof
	}
	key, err := DecodeKey(public)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ErrInvalidProof
	}
	signature, err := DecodeKey(r.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(key, raw, signature) {
		return ErrInvalidProof
	}
	return nil
}
