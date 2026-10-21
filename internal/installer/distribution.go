package installer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	distributionAsset      = "redeven-installer-contract.json"
	distributionSchema     = "redeven.installer_distribution.v1"
	runtimeArchiveContract = "redeven.runtime-suite.v1"
	firstInstallerRelease  = "v0.13.13"
)

type distributionContract struct {
	SchemaVersion           string   `json:"schema_version"`
	MinimumInstallerVersion string   `json:"minimum_installer_version"`
	RuntimeArchiveContract  string   `json:"runtime_archive_contract"`
	Platforms               []string `json:"platforms"`
}

func needsDistributionContract(version string) bool {
	return semver.Compare(strings.SplitN(version, "-", 2)[0], firstInstallerRelease) >= 0
}

func decodeDistribution(data []byte) (*distributionContract, error) {
	var contract distributionContract
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&contract); err != nil {
		return nil, fmt.Errorf("decode installer distribution contract: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("installer distribution contract contains trailing data")
	}
	if contract.SchemaVersion != distributionSchema || contract.RuntimeArchiveContract != runtimeArchiveContract || validateReleaseVersion(contract.MinimumInstallerVersion) != nil {
		return nil, errors.New("unsupported installer distribution or runtime archive contract")
	}
	platforms := append([]string{}, contract.Platforms...)
	slices.Sort(platforms)
	if !slices.Equal(platforms, []string{"darwin_amd64", "darwin_arm64", "linux_amd64", "linux_arm64"}) {
		return nil, errors.New("installer distribution platform inventory is not the reviewed closed target set")
	}
	return &contract, nil
}

func loadDistribution(ctx context.Context, d *downloader, source releaseSource, version string, inventory map[string]string) (*distributionContract, error) {
	if !needsDistributionContract(version) {
		return nil, nil
	}
	digest, exists := inventory[distributionAsset]
	if !exists {
		return nil, errors.New("authenticated release is missing its installer distribution contract")
	}
	data, err := d.metadata(ctx, source.assetURLs(version, distributionAsset), 64<<10)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != digest {
		return nil, errors.New("installer distribution contract does not match its signed digest")
	}
	return decodeDistribution(data)
}

func verifySourceInventory(ctx context.Context, d *downloader, source releaseSource, version string, verifier *releaseVerifier) (map[string]string, error) {
	payload, err := d.metadata(ctx, source.assetURLs(version, "SHA256SUMS"), 8<<20)
	if err != nil {
		return nil, err
	}
	signature, err := d.metadata(ctx, source.assetURLs(version, "SHA256SUMS.sig"), 32<<10)
	if err != nil {
		return nil, err
	}
	certificate, err := d.metadata(ctx, source.assetURLs(version, "SHA256SUMS.pem"), 256<<10)
	if err != nil {
		return nil, err
	}
	if err := verifier.verify(ctx, payload, signature, certificate, version); err != nil {
		return nil, err
	}
	return parseChecksums(payload)
}

func bootstrapValue(script []byte, key string) (string, error) {
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `='([^'\r\n]*)'[\t ]*$`)
	matches := pattern.FindAllSubmatch(script, -1)
	if len(matches) != 1 {
		return "", fmt.Errorf("active entry must declare exactly one %s", key)
	}
	return string(matches[0][1]), nil
}

func checkBootstrapPins(script []byte, contract *distributionContract, inventory map[string]string) (string, error) {
	version, err := bootstrapValue(script, "INSTALLER_VERSION")
	if err != nil || validateReleaseVersion(version) != nil {
		return "", errors.New("active installation entry does not pin a canonical installer release")
	}
	schema, err := bootstrapValue(script, "INSTALLER_CONTRACT")
	if err != nil || schema != contract.SchemaVersion {
		return "", errors.New("active installation entry does not implement the required installer contract")
	}
	if semver.Compare(version, contract.MinimumInstallerVersion) < 0 {
		return "", fmt.Errorf("active entry pins installer %s but release requires at least %s", version, contract.MinimumInstallerVersion)
	}
	if inventory != nil {
		for _, platform := range contract.Platforms {
			actual, err := bootstrapValue(script, "SHA256_"+strings.ToUpper(platform))
			expected := inventory["redeven-installer_"+platform]
			if err != nil || !validDigest(expected) || actual != expected {
				return "", fmt.Errorf("active entry's %s installer pin does not match its authenticated release", platform)
			}
		}
	}
	return version, nil
}

func bootstrapAsset(channel string) string {
	if channel == "portal" {
		return "redeven-install-portal.sh"
	}
	return "redeven-install.sh"
}

func checkPublishedBootstrap(entry []byte, channel, version string, contract *distributionContract, inventory map[string]string) error {
	hash := sha256.Sum256(entry)
	if digest := inventory[bootstrapAsset(channel)]; !validDigest(digest) || hex.EncodeToString(hash[:]) != digest {
		return errors.New("installation bootstrap does not match its authenticated release digest")
	}
	pinnedVersion, err := checkBootstrapPins(entry, contract, inventory)
	if err != nil {
		return err
	}
	if pinnedVersion != version {
		return errors.New("installation bootstrap must pin its own release")
	}
	actualChannel, err := bootstrapValue(entry, "INSTALLER_CHANNEL")
	if err != nil || actualChannel != channel {
		return errors.New("installation bootstrap uses a different distribution channel")
	}
	mirror, err := bootstrapValue(entry, "INSTALLER_MIRROR")
	expectedMirror := sourceFor(channel).mirrorURL
	if err != nil || mirror != expectedMirror {
		return errors.New("installation bootstrap uses a different distribution mirror")
	}
	return nil
}

func checkActiveBootstrap(ctx context.Context, d *downloader, entryURL string, expected []byte) error {
	active, err := d.metadata(ctx, []string{entryURL}, 1<<20)
	if err != nil {
		return err
	}
	if !bytes.Equal(active, expected) {
		return errors.New("active installation entry differs from the authenticated release bootstrap")
	}
	return nil
}

// CheckDistribution authenticates a completed release and its generated
// installation bootstrap. Portal active readback authenticates its own release
// and checks compatibility with the candidate Runtime contract. Mutable entry
// readback is optional so GitHub promotion can
// validate a candidate before changing GitHub's default version pointer.
// Rollback uses another immutable signed release, never a separate legacy script.
func CheckDistribution(ctx context.Context, channel, version string, checkActiveEntry bool) error {
	if channel != "github" && channel != "portal" {
		return errors.New("distribution channel must be github or portal")
	}
	if validateReleaseVersion(version) != nil || !needsDistributionContract(version) {
		return errors.New("distribution readiness requires a self-contained-installer release contract")
	}
	temporary, err := os.MkdirTemp("", "redeven-distribution-check-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	d := newDownloader(temporary, io.Discard)
	source := sourceFor(channel)
	verifier, err := newReleaseVerifier(ctx)
	if err != nil {
		return err
	}
	inventory, err := verifySourceInventory(ctx, d, source, version, verifier)
	if err != nil {
		return err
	}
	contract, err := loadDistribution(ctx, d, source, version, inventory)
	if err != nil {
		return err
	}
	entry, err := d.metadata(ctx, source.assetURLs(version, bootstrapAsset(channel)), 1<<20)
	if err != nil {
		return err
	}
	if err := checkPublishedBootstrap(entry, channel, version, contract, inventory); err != nil {
		return err
	}
	if checkActiveEntry {
		entryURL := "https://github.com/floegence/redeven/releases/latest/download/redeven-install.sh"
		if channel == "portal" {
			entryURL = "https://redeven.com/install.sh"
		} else {
			return checkActiveBootstrap(ctx, d, entryURL, entry)
		}
		active, err := d.metadata(ctx, []string{entryURL}, 1<<20)
		if err != nil {
			return err
		}
		activeVersion, err := bootstrapValue(active, "INSTALLER_VERSION")
		if err != nil || validateReleaseVersion(activeVersion) != nil || !needsDistributionContract(activeVersion) {
			return errors.New("active Portal entry does not select a self-contained installer release")
		}
		activeInventory, err := verifySourceInventory(ctx, d, source, activeVersion, verifier)
		if err != nil {
			return err
		}
		activeContract, err := loadDistribution(ctx, d, source, activeVersion, activeInventory)
		if err != nil {
			return err
		}
		if err := checkPublishedBootstrap(active, channel, activeVersion, activeContract, activeInventory); err != nil {
			return err
		}
		// Portal may recommend an older Runtime than GitHub latest. Its active
		// bootstrap must still satisfy that Runtime's authenticated minimum.
		_, err = checkBootstrapPins(active, contract, activeInventory)
		return err
	}
	return nil
}
