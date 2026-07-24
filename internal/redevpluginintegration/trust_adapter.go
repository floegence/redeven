package redevpluginintegration

import (
	"context"
	"crypto/ed25519"
	"fmt"

	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/trust"
)

const (
	officialPublisherID        = "com.redeven.official"
	officialContainersPluginID = "com.redeven.official.containers"
	officialSigningKeyID       = "redeven-official-signing-2026"
)

// strictPackageTrustVerifier delegates the complete local-import and release
// trust state machine to ReDevPlugin. Redeven contributes only its product
// signing-key policy through the keyring.
type strictPackageTrustVerifier struct {
	verifier trust.Ed25519Verifier
}

var (
	_ host.PackageTrustVerifier                      = strictPackageTrustVerifier{}
	_ host.ExternalPackageSignatureAssessor          = strictPackageTrustVerifier{}
	_ host.ExternalPackageSignatureFreshnessAssessor = strictPackageTrustVerifier{}
)

func (v strictPackageTrustVerifier) VerifyPackageTrust(ctx context.Context, req host.PackageTrustVerificationRequest) (host.PackageTrustVerificationResult, error) {
	return v.verifier.VerifyPackageTrust(ctx, req)
}

func (v strictPackageTrustVerifier) AssessExternalPackageSignature(ctx context.Context, req host.ExternalPackageSignatureAssessmentRequest) (registry.SignatureAssessment, error) {
	return v.verifier.AssessExternalPackageSignature(ctx, req)
}

func (v strictPackageTrustVerifier) AssessExternalPackageSignatureFreshness(ctx context.Context, req host.ExternalPackageSignatureFreshnessRequest) (registry.SignatureAssessment, error) {
	return v.verifier.AssessExternalPackageSignatureFreshness(ctx, req)
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
	signingKey, err := redevpluginartifacts.OfficialSigningPublicKey()
	if err != nil || signingKey.KeyID != officialSigningKeyID || len(signingKey.PublicKey) != ed25519.PublicKeySize {
		return strictPackageTrustVerifier{}, fmt.Errorf("official package signing key is invalid")
	}
	return strictPackageTrustVerifier{
		verifier: trust.Ed25519Verifier{Keyring: officialSigningKeyring{publicKey: append(ed25519.PublicKey(nil), signingKey.PublicKey...)}},
	}, nil
}
