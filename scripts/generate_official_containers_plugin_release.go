//go:build ignore

// Command generate_official_containers_plugin_release materializes the signed,
// embedded release for Redeven's official Containers plugin. It deliberately
// has one fixed output location and one fixed release identity so a caller
// cannot turn it into an arbitrary artifact signer.
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/runtimetarget"
	"github.com/floegence/redevplugin/pkg/trust"
)

const (
	officialReleaseOutputRoot = "spec/redevplugin/official-containers-plugin"
	officialCapabilityPinPath = "spec/redevplugin/official-containers-capability/host-capability.pin.json"
	officialPublicKeyPath     = "spec/redevplugin/redeven-official-v1.public.json"

	officialSourceID        = "redeven-official"
	officialPublisherID     = "com.redeven.official"
	officialPluginID        = "com.redeven.official.containers"
	officialPluginVersion   = "2.0.0"
	officialSigningKeyID    = "redeven-official-v1"
	officialHostID          = "redeven"
	officialPolicyEpoch     = "1"
	officialRevocationEpoch = "1"
	officialEvidenceExpiry  = "2030-01-01T00:00:00Z"

	releaseMetadataRef     = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json"
	packageArtifactRef     = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.redevplugin"
	releaseSignatureRef    = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json.sig"
	packageSignatureRef    = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.sigbundle"
	revocationMetadataRef  = "sources/redeven-official/revocations.json"
	revocationSignatureRef = "sources/redeven-official/revocations.json.sig"
)

type signingPrivateKeyDocument struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PrivateKey    string `json:"private_key"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type signingPublicKeyDocument struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type signedReleaseMetadataDocument struct {
	SchemaVersion            string                        `json:"schema_version"`
	SourceID                 string                        `json:"source_id"`
	ReleaseMetadataRef       string                        `json:"release_metadata_ref"`
	PublisherID              string                        `json:"publisher_id"`
	PluginID                 string                        `json:"plugin_id"`
	Version                  string                        `json:"version"`
	DistributionRef          host.PackageDistributionRef   `json:"distribution_ref"`
	Hashes                   host.PackageHashSet           `json:"hashes"`
	ReleaseMetadataSignature host.ReleaseMetadataSignature `json:"release_metadata_signature"`
	PackageSignature         host.PackageReleaseSignature  `json:"package_signature"`
	Compatibility            host.ReleaseCompatibility     `json:"compatibility"`
	HostRequirements         []host.HostRequirement        `json:"host_requirements"`
	ReleaseEvidence          host.ReleaseEvidence          `json:"release_evidence"`
}

type sourceRevocationDocument struct {
	SchemaVersion    string   `json:"schema_version"`
	SourceID         string   `json:"source_id"`
	HighestSeenEpoch string   `json:"highest_seen_epoch"`
	GeneratedAt      string   `json:"generated_at"`
	ExpiresAt        string   `json:"expires_at"`
	RevokedKeyIDs    []string `json:"revoked_key_ids"`
}

func main() {
	var packagePath string
	var privateKeyPath string
	flag.StringVar(&packagePath, "package", "", "path to the already signed Containers .redevplugin package")
	flag.StringVar(&privateKeyPath, "private-key", "", "path to the official Ed25519 private-key document")
	flag.Parse()
	if flag.NArg() != 0 {
		fatal(errors.New("positional arguments are not allowed"))
	}
	if err := generate(packagePath, privateKeyPath); err != nil {
		fatal(err)
	}
}

func generate(packagePath string, privateKeyPath string) error {
	packagePath = strings.TrimSpace(packagePath)
	privateKeyPath = strings.TrimSpace(privateKeyPath)
	if packagePath == "" || privateKeyPath == "" {
		return errors.New("--package and --private-key are required")
	}

	packageBytes, err := os.ReadFile(packagePath)
	if err != nil {
		return fmt.Errorf("read signed plugin package: %w", err)
	}
	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(packageBytes), int64(len(packageBytes)), pluginpkg.DefaultReadLimits())
	if err != nil {
		return fmt.Errorf("read signed plugin package contract: %w", err)
	}
	if err := validatePackageIdentity(pkg); err != nil {
		return err
	}

	privateDoc, privateKey, err := loadPrivateKey(privateKeyPath)
	if err != nil {
		return err
	}
	publicDoc, publicKey, err := loadPublicKey(officialPublicKeyPath)
	if err != nil {
		return err
	}
	if privateDoc.KeyID != publicDoc.KeyID || !privateKey.Public().(ed25519.PublicKey).Equal(publicKey) {
		return errors.New("private signing key does not match the committed official public key")
	}
	if err := verifyPackageSignature(pkg, publicKey); err != nil {
		return err
	}

	pin, err := loadCapabilityPin(officialCapabilityPinPath)
	if err != nil {
		return err
	}
	if len(pkg.Manifest.CapabilityBindings) != 1 || !reflect.DeepEqual(pkg.Manifest.CapabilityBindings[0].Contract, pin) {
		return errors.New("plugin manifest capability pin does not match the official signed capability")
	}

	generatedAt := pkg.PackageSignature.SignedAt
	if _, err := time.Parse(time.RFC3339, generatedAt); err != nil {
		return errors.New("package signature signed_at is not a valid RFC3339 timestamp")
	}
	if _, err := time.Parse(time.RFC3339, officialEvidenceExpiry); err != nil {
		return errors.New("official revocation expiry is invalid")
	}

	releaseMetadata := signedReleaseMetadataDocument{
		SchemaVersion:      "redevplugin.release_metadata.v5",
		SourceID:           officialSourceID,
		ReleaseMetadataRef: releaseMetadataRef,
		PublisherID:        officialPublisherID,
		PluginID:           officialPluginID,
		Version:            officialPluginVersion,
		DistributionRef: host.PackageDistributionRef{
			Distribution: host.PackageDistributionHostArtifactRef,
			ArtifactRef:  packageArtifactRef,
		},
		Hashes: host.PackageHashSet{
			PackageSHA256:  pkg.PackageHash,
			ManifestSHA256: pkg.ManifestHash,
			EntriesSHA256:  pkg.EntriesHash,
		},
		ReleaseMetadataSignature: host.ReleaseMetadataSignature{
			Algorithm:         pluginpkg.PackageSignatureAlgorithmEd25519,
			KeyID:             officialSigningKeyID,
			SignatureRef:      releaseSignatureRef,
			SourcePolicyEpoch: officialPolicyEpoch,
			RevocationEpoch:   officialRevocationEpoch,
		},
		PackageSignature: host.PackageReleaseSignature{
			Algorithm:          pluginpkg.PackageSignatureAlgorithmEd25519,
			KeyID:              officialSigningKeyID,
			SignatureBundleRef: packageSignatureRef,
			SourcePolicyEpoch:  officialPolicyEpoch,
			RevocationEpoch:    officialRevocationEpoch,
		},
		Compatibility: host.ReleaseCompatibility{
			MinReDevPluginVersion: "0.5.1",
			MinRuntimeVersion:     "0.5.1",
			UIProtocolVersion:     "plugin-ui-v5",
			SupportedTargets: []runtimetarget.Target{
				runtimetarget.DarwinAMD64,
				runtimetarget.DarwinARM64,
				runtimetarget.LinuxAMD64,
				runtimetarget.LinuxARM64,
			},
		},
		HostRequirements: []host.HostRequirement{{
			HostID: officialHostID,
			RequiredCapabilityContracts: []host.HostCapabilityRequirement{{
				CapabilityID:      "redeven.capability.container_resources",
				CapabilityVersion: "1.0.0",
				Contract:          pin,
			}},
		}},
		ReleaseEvidence: host.ReleaseEvidence{GeneratedAt: generatedAt},
	}
	releaseBytes, err := json.Marshal(releaseMetadata)
	if err != nil {
		return fmt.Errorf("marshal release metadata: %w", err)
	}
	releaseSignature := ed25519.Sign(privateKey, releaseBytes)
	releaseHash := sha256.Sum256(releaseBytes)

	revocations := sourceRevocationDocument{
		SchemaVersion:    "redevplugin.source_revocations.v1",
		SourceID:         officialSourceID,
		HighestSeenEpoch: officialRevocationEpoch,
		GeneratedAt:      generatedAt,
		ExpiresAt:        officialEvidenceExpiry,
		RevokedKeyIDs:    []string{},
	}
	revocationBytes, err := json.Marshal(revocations)
	if err != nil {
		return fmt.Errorf("marshal source revocations: %w", err)
	}
	revocationSignature := ed25519.Sign(privateKey, revocationBytes)

	releaseRef := host.PluginReleaseRef{
		SourceID:              officialSourceID,
		ReleaseMetadataRef:    releaseMetadataRef,
		ReleaseMetadataSHA256: hex.EncodeToString(releaseHash[:]),
		PublisherID:           officialPublisherID,
		PluginID:              officialPluginID,
		Version:               officialPluginVersion,
		ExpectedHashes:        releaseMetadata.Hashes,
	}
	releaseRefBytes, err := json.MarshalIndent(releaseRef, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal release ref: %w", err)
	}
	releaseRefBytes = append(releaseRefBytes, '\n')

	packageSignatureBytes, ok := pkg.SignatureFiles[pluginpkg.PackageSignaturePath]
	if !ok || len(packageSignatureBytes) == 0 {
		return errors.New("signed package is missing its package signature bundle")
	}

	files := map[string][]byte{
		"release-ref.json":     releaseRefBytes,
		packageArtifactRef:     packageBytes,
		releaseMetadataRef:     releaseBytes,
		releaseSignatureRef:    releaseSignature,
		packageSignatureRef:    packageSignatureBytes,
		revocationMetadataRef:  revocationBytes,
		revocationSignatureRef: revocationSignature,
	}
	if err := replaceOutputTree(officialReleaseOutputRoot, files); err != nil {
		return err
	}
	fmt.Printf("generated %s\n", officialReleaseOutputRoot)
	fmt.Printf("release_metadata_sha256=%s\n", releaseRef.ReleaseMetadataSHA256)
	fmt.Printf("artifact_sha256=%s\n", sha256Hex(packageBytes))
	return nil
}

func validatePackageIdentity(pkg pluginpkg.Package) error {
	if pkg.Manifest.Publisher.PublisherID != officialPublisherID ||
		pkg.Manifest.PluginID() != officialPluginID ||
		pkg.Manifest.Version() != officialPluginVersion {
		return errors.New("signed package identity is not the official Containers release")
	}
	if pkg.Manifest.Plugin.MinRuntimeVersion != "0.5.1" || pkg.Manifest.Plugin.UIProtocolVersion != "plugin-ui-v5" {
		return errors.New("signed package compatibility is not ReDevPlugin v0.5.1/plugin-ui-v5")
	}
	if pkg.PackageSignature == nil || pkg.PackageSignature.KeyID != officialSigningKeyID {
		return errors.New("signed package does not use the official signing key")
	}
	return nil
}

func verifyPackageSignature(pkg pluginpkg.Package, publicKey ed25519.PublicKey) error {
	payload, err := trust.CanonicalPackageSignaturePayload(*pkg.PackageSignature)
	if err != nil {
		return fmt.Errorf("canonicalize package signature: %w", err)
	}
	signature, err := base64.StdEncoding.DecodeString(pkg.PackageSignature.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, payload, signature) {
		return errors.New("signed package signature is invalid")
	}
	return nil
}

func loadPrivateKey(filename string) (signingPrivateKeyDocument, ed25519.PrivateKey, error) {
	var doc signingPrivateKeyDocument
	if err := readStrictJSONFile(filename, &doc); err != nil {
		return doc, nil, fmt.Errorf("read private signing key: %w", err)
	}
	if doc.SchemaVersion != "redevplugin.ed25519_signing_key.v1" || doc.Algorithm != "ed25519" || doc.KeyID != officialSigningKeyID {
		return doc, nil, errors.New("private signing key identity is invalid")
	}
	privateKey, err := base64.StdEncoding.DecodeString(doc.PrivateKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return doc, nil, errors.New("private signing key material is invalid")
	}
	return doc, ed25519.PrivateKey(privateKey), nil
}

func loadPublicKey(filename string) (signingPublicKeyDocument, ed25519.PublicKey, error) {
	var doc signingPublicKeyDocument
	if err := readStrictJSONFile(filename, &doc); err != nil {
		return doc, nil, fmt.Errorf("read public signing key: %w", err)
	}
	if doc.SchemaVersion != "redevplugin.ed25519_signing_key.v1" || doc.Algorithm != "ed25519" || doc.KeyID != officialSigningKeyID {
		return doc, nil, errors.New("public signing key identity is invalid")
	}
	publicKey, err := base64.StdEncoding.DecodeString(doc.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return doc, nil, errors.New("public signing key material is invalid")
	}
	return doc, ed25519.PublicKey(publicKey), nil
}

func loadCapabilityPin(filename string) (capabilitycontract.Pin, error) {
	var pin capabilitycontract.Pin
	if err := readStrictJSONFile(filename, &pin); err != nil {
		return pin, fmt.Errorf("read official capability pin: %w", err)
	}
	if err := capabilitycontract.ValidatePin(pin); err != nil {
		return pin, fmt.Errorf("validate official capability pin: %w", err)
	}
	return pin, nil
}

func readStrictJSONFile(filename string, dst any) error {
	raw, err := os.ReadFile(filename)
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
			return errors.New("JSON contains a trailing value")
		}
		return err
	}
	return nil
}

func replaceOutputTree(root string, files map[string][]byte) error {
	parent := filepath.Dir(root)
	temp, err := os.MkdirTemp(parent, ".official-containers-plugin-")
	if err != nil {
		return fmt.Errorf("create release staging directory: %w", err)
	}
	defer os.RemoveAll(temp)
	for name, content := range files {
		if filepath.IsAbs(name) || strings.Contains(name, "\\") || strings.Contains(name, "..") {
			return fmt.Errorf("unsafe release output path %q", name)
		}
		filename := filepath.Join(temp, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			return fmt.Errorf("create release output directory: %w", err)
		}
		if err := os.WriteFile(filename, content, 0o644); err != nil {
			return fmt.Errorf("write release artifact %s: %w", name, err)
		}
	}
	if err := os.RemoveAll(root); err != nil {
		return fmt.Errorf("replace previous release output: %w", err)
	}
	if err := os.Rename(temp, root); err != nil {
		return fmt.Errorf("publish release output: %w", err)
	}
	return nil
}

func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
