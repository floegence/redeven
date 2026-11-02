package protocol

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"strings"
	"time"
)

const ClientAccessPurpose = "redeven-gateway-client"
const clientAccessPrefix = "rdgc1."

// ClientAccessPackage is delivered through the host-authorized sharing action.
// Its root is scoped to this Gateway connection, never installed globally. The
// one-time secret is sent over verified HTTPS; pairing pins the signed Gateway identity.
type ClientAccessPackage struct {
	Purpose          string `json:"purpose"`
	Version          int    `json:"version"`
	AccessCode       string `json:"access_code"`
	GatewayID        string `json:"gateway_id"`
	GatewayPublicKey string `json:"gateway_public_key"`
	TLSRootPEM       string `json:"tls_root_pem"`
	ExpiresAtUnixMS  int64  `json:"expires_at_unix_ms"`
}

func (p ClientAccessPackage) validate(now time.Time) error {
	keyBlock, keyRest := pem.Decode([]byte(p.GatewayPublicKey))
	rootBlock, rootRest := pem.Decode([]byte(p.TLSRootPEM))
	if keyBlock == nil || rootBlock == nil || strings.TrimSpace(string(keyRest)) != "" || strings.TrimSpace(string(rootRest)) != "" {
		return errors.New("invalid Gateway client trust")
	}
	key, keyErr := x509.ParsePKIXPublicKey(keyBlock.Bytes)
	_, validKey := key.(ed25519.PublicKey)
	root, rootErr := x509.ParseCertificate(rootBlock.Bytes)
	if keyErr != nil || !validKey || rootErr != nil || !root.IsCA {
		return errors.New("invalid Gateway client trust")
	}
	roots := x509.NewCertPool()
	if p.Purpose != ClientAccessPurpose || p.Version != 1 || len(p.AccessCode) < 16 || len(p.AccessCode) > 128 || p.GatewayID == "" || len(p.GatewayID) > 256 || len(p.GatewayPublicKey) > 4096 || !strings.Contains(p.GatewayPublicKey, "BEGIN PUBLIC KEY") || len(p.TLSRootPEM) > 16384 || !roots.AppendCertsFromPEM([]byte(p.TLSRootPEM)) || p.ExpiresAtUnixMS <= now.UnixMilli() || p.ExpiresAtUnixMS > now.Add(11*time.Minute).UnixMilli() {
		return errors.New("invalid or expired Gateway client access package")
	}
	return nil
}

func EncodeClientAccessPackage(p ClientAccessPackage) (string, error) {
	if err := p.validate(time.Now()); err != nil {
		return "", err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return clientAccessPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func DecodeClientAccessPackage(value string, now time.Time) (ClientAccessPackage, error) {
	var p ClientAccessPackage
	value = strings.TrimSpace(value)
	if len(value) > 32768 || !strings.HasPrefix(value, clientAccessPrefix) {
		return p, errors.New("Gateway client access package required")
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(strings.TrimPrefix(value, clientAccessPrefix))
	if err != nil {
		return p, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return ClientAccessPackage{}, errors.New("invalid Gateway client access package")
	}
	return p, p.validate(now)
}
