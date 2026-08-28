package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
)

// artifactFS contains only public verification material. Private signing keys
// and plugin release payloads are never part of the repository or product binary.
//
//go:embed official-package-signing-key.public.json
var artifactFS embed.FS

type signingPublicKey struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PublisherID   string `json:"publisher_id,omitempty"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type ReleaseTrustPublicKey struct {
	KeyID       string
	PublisherID string
	PublicKey   ed25519.PublicKey
}

// OfficialSigningPublicKey returns the package-signing key pinned by Redeven.
// The returned bytes are independent so callers cannot mutate the embedded pin.
func OfficialSigningPublicKey() (ReleaseTrustPublicKey, error) {
	key, err := readSigningPublicKey(
		"official-package-signing-key.public.json",
		"redeven_official_signing_2026_08",
	)
	if err != nil {
		return ReleaseTrustPublicKey{}, err
	}
	return clonePublicKey(key), nil
}

func readSigningPublicKey(name, expectedKeyID string) (ReleaseTrustPublicKey, error) {
	var public signingPublicKey
	if err := readStrictJSON(name, &public); err != nil {
		return ReleaseTrustPublicKey{}, err
	}
	if public.SchemaVersion != "redevplugin.ed25519_signing_key.v1" || public.Algorithm != "ed25519" ||
		(expectedKeyID != "" && public.KeyID != expectedKeyID) {
		return ReleaseTrustPublicKey{}, errors.New("official signing key identity is invalid")
	}
	publicBytes, err := base64.StdEncoding.DecodeString(public.PublicKey)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return ReleaseTrustPublicKey{}, errors.New("official signing public key is invalid")
	}
	return ReleaseTrustPublicKey{
		KeyID: public.KeyID, PublisherID: public.PublisherID,
		PublicKey: append(ed25519.PublicKey(nil), publicBytes...),
	}, nil
}

func clonePublicKey(value ReleaseTrustPublicKey) ReleaseTrustPublicKey {
	value.PublicKey = append(ed25519.PublicKey(nil), value.PublicKey...)
	return value
}

func readStrictJSON(name string, dst any) error {
	raw, err := artifactFS.ReadFile(name)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("artifact JSON contains a trailing value")
		}
		return err
	}
	return nil
}
