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
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `='([^'\r\n]+)'[\t ]*$`)
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

// CheckDistribution is a read-only release/promotion gate. It authenticates the
// requested release, compares the actual HTTPS entry with reviewed source, and
// verifies every entry pin against that installer's own signed release. It must
// succeed before advancing a default version pointer or restoring an old entry.
func CheckDistribution(ctx context.Context, channel, version, expectedEntry, rollbackEntry string) error {
	if channel != "github" && channel != "portal" {
		return errors.New("distribution channel must be github or portal")
	}
	if validateReleaseVersion(version) != nil || !needsDistributionContract(version) {
		return errors.New("distribution readiness requires a self-contained-installer release contract")
	}
	info, err := os.Lstat(expectedEntry)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return errors.New("reviewed installation entry is not a bounded regular source file")
	}
	expected, err := os.ReadFile(expectedEntry)
	if err != nil {
		return err
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
	entryURL := "https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh"
	if channel == "portal" {
		entryURL = "https://redeven.com/install.sh"
	}
	entry, err := d.metadata(ctx, []string{entryURL}, 1<<20)
	if err != nil {
		return err
	}
	if !bytes.Equal(entry, expected) {
		return errors.New("deployed installation entry does not match the reviewed source; publication is not confirmed")
	}
	entries := [][]byte{entry}
	if rollbackEntry != "" {
		info, err := os.Lstat(rollbackEntry)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
			return errors.New("rollback installation entry must be a bounded regular reviewed source file")
		}
		rollback, err := os.ReadFile(rollbackEntry)
		if err != nil {
			return err
		}
		entries = append(entries, rollback)
	}
	for _, entry := range entries {
		installerVersion, err := checkBootstrapPins(entry, contract, nil)
		if err != nil {
			return err
		}
		installerInventory := inventory
		if installerVersion != version {
			installerInventory, err = verifySourceInventory(ctx, d, source, installerVersion, verifier)
			if err != nil {
				return err
			}
		}
		if _, err := checkBootstrapPins(entry, contract, installerInventory); err != nil {
			return err
		}
	}
	return nil
}
