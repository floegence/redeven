package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"

	"github.com/floegence/redevplugin/pkg/capabilitycontract"
)

const containersCapabilityRoot = "official-containers-capability-v4/bundle"

// artifactFS contains only public verification material. Private signing keys
// and plugin release payloads are never part of the repository or product binary.
//
//go:embed official-release-trust-v1.public.json official-containers-capability-v4/bundle/** official-containers-capability-v4/host-capability.public.json
var artifactFS embed.FS

type signingPublicKey struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PublisherID   string `json:"publisher_id,omitempty"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type publicKeyPin struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type officialReleaseTrustAnchorsFile struct {
	SchemaVersion string       `json:"schema_version"`
	SourceID      string       `json:"source_id"`
	Root          publicKeyPin `json:"root"`
	SigningLedger struct {
		LogID string `json:"log_id"`
		publicKeyPin
	} `json:"signing_ledger"`
}

type ReleaseTrustPublicKey struct {
	KeyID       string
	PublisherID string
	PublicKey   ed25519.PublicKey
}

type OfficialReleaseTrustAnchors struct {
	SourceID         string
	Root             ReleaseTrustPublicKey
	SigningLedgerLog string
	SigningLedger    ReleaseTrustPublicKey
}

func OfficialReleaseTrustAnchorSet() (OfficialReleaseTrustAnchors, error) {
	var value officialReleaseTrustAnchorsFile
	if err := readStrictJSON("official-release-trust-v1.public.json", &value); err != nil {
		return OfficialReleaseTrustAnchors{}, err
	}
	if value.SchemaVersion != "redeven.official_release_trust_anchors.v1" ||
		value.SourceID != "redeven_official" || value.SigningLedger.LogID != "redeven_official_signing_log" {
		return OfficialReleaseTrustAnchors{}, errors.New("official release trust anchor identity is invalid")
	}
	root, err := decodePublicKeyPin(value.Root)
	if err != nil {
		return OfficialReleaseTrustAnchors{}, err
	}
	ledger, err := decodePublicKeyPin(value.SigningLedger.publicKeyPin)
	if err != nil {
		return OfficialReleaseTrustAnchors{}, err
	}
	return OfficialReleaseTrustAnchors{
		SourceID:         value.SourceID,
		Root:             root,
		SigningLedgerLog: value.SigningLedger.LogID,
		SigningLedger:    ledger,
	}, nil
}

// OfficialSigningPublicKey returns the package-signing key pinned by Redeven.
// The returned bytes are independent so callers cannot mutate the embedded pin.
func OfficialSigningPublicKey() (ReleaseTrustPublicKey, error) {
	key, err := readSigningPublicKey(
		"official-containers-capability-v4/host-capability.public.json",
		"redeven_official_signing_2026",
	)
	if err != nil {
		return ReleaseTrustPublicKey{}, err
	}
	return clonePublicKey(key), nil
}

func ContainersCapabilityBundle() (capabilitycontract.Bundle, capabilitycontract.TrustedKey, error) {
	var pin capabilitycontract.Pin
	if err := readStrictJSON(containersCapabilityRoot+"/host-capability.pin.json", &pin); err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	if err := capabilitycontract.ValidatePin(pin); err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	refs := []string{
		pin.ArtifactRef,
		pin.ManifestRef,
		pin.SignatureRef,
		pin.CompatibilityRef,
		pin.GeneratedClientRef,
		pin.NoticesRef,
	}
	files := make(map[string][]byte, len(refs))
	for _, ref := range refs {
		content, err := artifactFS.ReadFile(path.Join(containersCapabilityRoot, ref))
		if err != nil {
			return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
		}
		files[ref] = append([]byte(nil), content...)
	}

	public, err := readSigningPublicKey("official-containers-capability-v4/host-capability.public.json", pin.SignatureKeyID)
	if err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	if public.PublisherID != pin.PublisherID {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, errors.New("official capability publisher identity is invalid")
	}
	return capabilitycontract.Bundle{Pin: pin, Files: files}, capabilitycontract.TrustedKey{
		PublisherID:     pin.PublisherID,
		KeyID:           pin.SignatureKeyID,
		PublicKey:       append(ed25519.PublicKey(nil), public.PublicKey...),
		PolicyEpoch:     pin.SignaturePolicyEpoch,
		RevocationEpoch: pin.SignatureRevocationEpoch,
	}, nil
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

func decodePublicKeyPin(value publicKeyPin) (ReleaseTrustPublicKey, error) {
	if value.Algorithm != "ed25519" || strings.TrimSpace(value.KeyID) == "" {
		return ReleaseTrustPublicKey{}, errors.New("official release public key identity is invalid")
	}
	publicBytes, err := base64.StdEncoding.DecodeString(value.PublicKey)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return ReleaseTrustPublicKey{}, errors.New("official release public key is invalid")
	}
	return ReleaseTrustPublicKey{
		KeyID:     value.KeyID,
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
