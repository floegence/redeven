package redevpluginintegration

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"

	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/trust"
)

const (
	officialPublisherID            = "com.redeven.official"
	officialContainersPluginID     = "com.redeven.official.containers"
	officialSigningKeyID           = "redeven-official-signing-2026"
	officialSigningPublicKeyBase64 = "fop/x8cYBXzGfLjddDHkxXtB5J/ae1Z7BFauznrGufA="
)

// strictPackageTrustVerifier delegates the complete local-import and release
// trust state machine to ReDevPlugin. Redeven contributes only its product
// signing-key policy through the keyring.
type strictPackageTrustVerifier struct {
	verifier trust.Ed25519Verifier
}

func (v strictPackageTrustVerifier) VerifyPackageTrust(ctx context.Context, req host.PackageTrustVerificationRequest) (host.PackageTrustVerificationResult, error) {
	return v.verifier.VerifyPackageTrust(ctx, req)
}

type officialSigningKeyring struct {
	publicKey ed25519.PublicKey
}

func (k officialSigningKeyring) LookupPackageSigningKey(_ context.Context, req trust.KeyLookupRequest) (trust.SigningKey, error) {
	if req.Algorithm != pluginpkg.PackageSignatureAlgorithmEd25519 || req.KeyID != officialSigningKeyID {
		return trust.SigningKey{}, trust.ErrKeyNotFound
	}
	if req.PublisherID != "" && req.PublisherID != officialPublisherID {
		return trust.SigningKey{}, trust.ErrKeyNotFound
	}
	if req.PluginID != "" && req.PluginID != officialContainersPluginID {
		return trust.SigningKey{}, trust.ErrKeyNotFound
	}
	return trust.SigningKey{
		Algorithm:   pluginpkg.PackageSignatureAlgorithmEd25519,
		KeyID:       officialSigningKeyID,
		PublisherID: officialPublisherID,
		PublicKey:   append(ed25519.PublicKey(nil), k.publicKey...),
	}, nil
}

func newPackageTrustVerifier() (strictPackageTrustVerifier, error) {
	publicKey, err := base64.StdEncoding.DecodeString(officialSigningPublicKeyBase64)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return strictPackageTrustVerifier{}, fmt.Errorf("official package signing key is invalid")
	}
	return strictPackageTrustVerifier{
		verifier: trust.Ed25519Verifier{Keyring: officialSigningKeyring{publicKey: ed25519.PublicKey(publicKey)}},
	}, nil
}
