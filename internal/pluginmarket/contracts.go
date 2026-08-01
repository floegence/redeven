package pluginmarket

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/remoterelease"
)

var (
	ErrInvalidResponse = errors.New("plugin market response is invalid")
	ErrUnavailable     = errors.New("plugin market is unavailable")
	ErrReleaseMissing  = errors.New("plugin market release is unavailable")
)

var (
	idPattern      = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,127}$`)
	semverPattern  = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
	tagPattern     = regexp.MustCompile(`^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
	shaPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	locatorPattern = regexp.MustCompile(`^[A-Za-z0-9._@+-]+(?:/[A-Za-z0-9._@+-]+)*$`)
)

type Meta struct {
	RequestID  string `json:"request_id"`
	Generation int64  `json:"generation"`
	Stale      bool   `json:"stale"`
	NextCursor string `json:"next_cursor,omitempty"`
	CachedAt   string `json:"cached_at,omitempty"`
}

type LatestPointer struct {
	Channel            string `json:"channel"`
	Version            string `json:"version"`
	AvailabilityStatus string `json:"availability_status"`
}

type PluginSummary struct {
	PluginID    string        `json:"plugin_id"`
	PublisherID string        `json:"publisher_id"`
	Name        string        `json:"name"`
	Summary     string        `json:"summary"`
	Categories  []string      `json:"categories"`
	Channels    []string      `json:"channels"`
	Latest      LatestPointer `json:"latest"`
}

type CatalogResponse struct {
	Data []PluginSummary `json:"data"`
	Meta Meta            `json:"meta"`
}

type ReleaseSource struct {
	Provider        string `json:"provider"`
	RepositoryID    int64  `json:"repository_id"`
	RepositoryOwner string `json:"repository_owner"`
	RepositoryName  string `json:"repository_name"`
	ReleaseID       int64  `json:"release_id"`
	Tag             string `json:"tag"`
	TargetCommit    string `json:"target_commit"`
}

type ReleaseAsset struct {
	AssetID int64  `json:"asset_id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
}

type TransportAsset struct {
	Locator string `json:"locator"`
	ReleaseAsset
}

type PackageHashes struct {
	PackageSHA256  string `json:"package_sha256"`
	ManifestSHA256 string `json:"manifest_sha256"`
	EntriesSHA256  string `json:"entries_sha256"`
}

type PublicKey struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type SigningLedger struct {
	LogID     string `json:"log_id"`
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type PublishedFile struct {
	Locator   string `json:"locator"`
	AssetName string `json:"asset_name"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
}

type PublisherReleaseRef struct {
	SchemaVersion string                `json:"schema_version"`
	ReleaseRef    host.PluginReleaseRef `json:"release_ref"`
	Root          PublicKey             `json:"root"`
	SigningLedger SigningLedger         `json:"signing_ledger"`
	Files         []PublishedFile       `json:"files"`
}

type Compatibility struct {
	MinRedevenVersion     string `json:"min_redeven_version"`
	MinReDevPluginVersion string `json:"min_redevplugin_version"`
}

type LatestRelease struct {
	PluginID        string        `json:"plugin_id"`
	Channel         string        `json:"channel"`
	Version         string        `json:"version"`
	Source          ReleaseSource `json:"source"`
	Asset           ReleaseAsset  `json:"asset"`
	ReleaseRefAsset ReleaseAsset  `json:"release_ref"`
	TrustRoot       struct {
		URL    string `json:"url"`
		SHA256 string `json:"sha256"`
	} `json:"trust_root"`
	PublisherReleaseRef   PublisherReleaseRef `json:"publisher_release_ref"`
	TransportAssets       []TransportAsset    `json:"transport_assets"`
	SignerKeyID           string              `json:"signer_key_id"`
	Compatibility         Compatibility       `json:"compatibility"`
	ReleaseIdentityDigest string              `json:"release_identity_digest"`
}

type LatestReleaseResponse struct {
	Data LatestRelease `json:"data"`
	Meta Meta          `json:"meta"`
}

type CatalogPlugin struct {
	PluginID    string         `json:"plugin_id"`
	PublisherID string         `json:"publisher_id"`
	Name        string         `json:"name"`
	Summary     string         `json:"summary"`
	Categories  []string       `json:"categories"`
	Channels    []string       `json:"channels"`
	Latest      LatestPointer  `json:"latest"`
	Release     *LatestRelease `json:"release,omitempty"`
}

const (
	SnapshotSchemaVersion = "redeven.plugin_market_snapshot.v1"
	SnapshotSourceRemote  = "remote"
	SnapshotSourceCache   = "cache"
)

type Snapshot struct {
	SchemaVersion string          `json:"schema_version"`
	Generation    int64           `json:"generation"`
	ETag          string          `json:"etag,omitempty"`
	CachedAt      time.Time       `json:"cached_at"`
	Stale         bool            `json:"stale"`
	Source        string          `json:"source"`
	Plugins       []CatalogPlugin `json:"plugins"`
}

func (release LatestRelease) RemoteProjection() (host.PluginReleaseRef, []remoterelease.Asset, error) {
	if err := validateLatestRelease(release); err != nil {
		return host.PluginReleaseRef{}, nil, err
	}
	files := release.PublisherReleaseRef.Files
	assets := release.TransportAssets
	if len(files) != len(assets) {
		return host.PluginReleaseRef{}, nil, invalid("release transport is incomplete")
	}
	result := make([]remoterelease.Asset, len(files))
	for index, file := range files {
		asset := assets[index]
		if file.Locator != asset.Locator || file.AssetName != asset.Name || file.SHA256 != asset.SHA256 || file.Size != asset.Size {
			return host.PluginReleaseRef{}, nil, invalid("release transport does not match the signed publisher projection")
		}
		result[index] = remoterelease.Asset{Locator: file.Locator, URL: asset.URL, SHA256: file.SHA256, Size: file.Size}
	}
	return release.PublisherReleaseRef.ReleaseRef, result, nil
}

func validateSnapshot(snapshot Snapshot) error {
	if snapshot.SchemaVersion != SnapshotSchemaVersion || snapshot.Generation < 0 || snapshot.CachedAt.IsZero() || snapshot.CachedAt.Location() != time.UTC ||
		(snapshot.Source != SnapshotSourceRemote && snapshot.Source != SnapshotSourceCache) {
		return invalid("snapshot metadata is invalid")
	}
	seen := make(map[string]struct{}, len(snapshot.Plugins))
	for _, plugin := range snapshot.Plugins {
		if err := validatePluginSummary(PluginSummary{
			PluginID: plugin.PluginID, PublisherID: plugin.PublisherID, Name: plugin.Name, Summary: plugin.Summary,
			Categories: plugin.Categories, Channels: plugin.Channels, Latest: plugin.Latest,
		}); err != nil {
			return err
		}
		if _, exists := seen[plugin.PluginID]; exists {
			return invalid("snapshot contains a duplicate plugin")
		}
		seen[plugin.PluginID] = struct{}{}
		if plugin.Release != nil {
			if plugin.Release.PluginID != plugin.PluginID || plugin.Release.Channel != plugin.Latest.Channel || plugin.Release.Version != plugin.Latest.Version {
				return invalid("snapshot release does not match its catalog pointer")
			}
			if err := validateLatestRelease(*plugin.Release); err != nil {
				return err
			}
		}
	}
	return nil
}

func validatePluginSummary(plugin PluginSummary) error {
	if !idPattern.MatchString(plugin.PluginID) || !idPattern.MatchString(plugin.PublisherID) || strings.TrimSpace(plugin.Name) == "" || strings.TrimSpace(plugin.Summary) == "" ||
		len(plugin.Categories) == 0 || len(plugin.Channels) == 0 || !idPattern.MatchString(plugin.Latest.Channel) || !semverPattern.MatchString(plugin.Latest.Version) {
		return invalid("catalog plugin is invalid")
	}
	if plugin.Latest.AvailabilityStatus != "visible" && plugin.Latest.AvailabilityStatus != "disabled" && plugin.Latest.AvailabilityStatus != "revoked" {
		return invalid("catalog availability is invalid")
	}
	for _, values := range [][]string{plugin.Categories, plugin.Channels} {
		for index, value := range values {
			if !idPattern.MatchString(value) || (index > 0 && value <= values[index-1]) {
				return invalid("catalog arrays must contain stable-sorted identifiers")
			}
		}
	}
	if !slices.Contains(plugin.Channels, plugin.Latest.Channel) {
		return invalid("catalog latest channel is not declared")
	}
	return nil
}

func validateLatestRelease(release LatestRelease) error {
	ref := release.PublisherReleaseRef.ReleaseRef
	if !idPattern.MatchString(release.PluginID) || !idPattern.MatchString(release.Channel) || !semverPattern.MatchString(release.Version) ||
		release.Source.Provider != "github" || release.Source.RepositoryID <= 0 || release.Source.ReleaseID <= 0 ||
		strings.TrimSpace(release.Source.RepositoryOwner) == "" || strings.TrimSpace(release.Source.RepositoryName) == "" ||
		!tagPattern.MatchString(release.Source.Tag) || strings.TrimPrefix(release.Source.Tag, "v") != release.Version || !commitPattern.MatchString(release.Source.TargetCommit) ||
		release.PublisherReleaseRef.SchemaVersion != "redevplugin.publisher_release_ref.v1" || ref.PluginID != release.PluginID || ref.Channel != release.Channel || ref.Version != release.Version ||
		!idPattern.MatchString(ref.SourceID) || !idPattern.MatchString(ref.PublisherID) || !locatorPattern.MatchString(ref.ReleaseMetadataRef) || !shaPattern.MatchString(ref.ReleaseMetadataSHA256) ||
		release.PublisherReleaseRef.Root.Algorithm != "ed25519" || !idPattern.MatchString(release.PublisherReleaseRef.Root.KeyID) || strings.TrimSpace(release.PublisherReleaseRef.Root.PublicKey) == "" ||
		release.PublisherReleaseRef.SigningLedger.Algorithm != "ed25519" || !idPattern.MatchString(release.PublisherReleaseRef.SigningLedger.LogID) || !idPattern.MatchString(release.PublisherReleaseRef.SigningLedger.KeyID) || strings.TrimSpace(release.PublisherReleaseRef.SigningLedger.PublicKey) == "" ||
		!idPattern.MatchString(release.SignerKeyID) || !semverPattern.MatchString(release.Compatibility.MinRedevenVersion) || !semverPattern.MatchString(release.Compatibility.MinReDevPluginVersion) ||
		!shaPattern.MatchString(release.ReleaseIdentityDigest) || !shaPattern.MatchString(release.TrustRoot.SHA256) || !validHTTPSURL(release.TrustRoot.URL) {
		return invalid("latest release identity is invalid")
	}
	for _, digest := range []string{ref.ExpectedHashes.PackageSHA256, ref.ExpectedHashes.ManifestSHA256, ref.ExpectedHashes.EntriesSHA256} {
		if !strings.HasPrefix(digest, "sha256:") || !shaPattern.MatchString(strings.TrimPrefix(digest, "sha256:")) {
			return invalid("latest release package hashes are invalid")
		}
	}
	if err := validateReleaseAsset(release.Asset); err != nil {
		return err
	}
	if err := validateReleaseAsset(release.ReleaseRefAsset); err != nil {
		return err
	}
	if len(release.PublisherReleaseRef.Files) == 0 || len(release.PublisherReleaseRef.Files) != len(release.TransportAssets) {
		return invalid("latest release transport is incomplete")
	}
	for index, file := range release.PublisherReleaseRef.Files {
		if !locatorPattern.MatchString(file.Locator) || strings.HasPrefix(file.Locator, "/") || !safeAssetName(file.AssetName) || !shaPattern.MatchString(file.SHA256) || file.Size <= 0 ||
			(index > 0 && file.Locator <= release.PublisherReleaseRef.Files[index-1].Locator) {
			return invalid("publisher release file is invalid")
		}
		asset := release.TransportAssets[index]
		if asset.Locator != file.Locator || asset.Name != file.AssetName || asset.SHA256 != file.SHA256 || asset.Size != file.Size || asset.AssetID <= 0 || !validHTTPSURL(asset.URL) {
			return invalid("transport asset does not match publisher release file")
		}
	}
	return nil
}

func validateReleaseAsset(asset ReleaseAsset) error {
	if asset.AssetID <= 0 || !safeAssetName(asset.Name) || !validHTTPSURL(asset.URL) || asset.Size <= 0 || !shaPattern.MatchString(asset.SHA256) {
		return invalid("release asset is invalid")
	}
	return nil
}

func validHTTPSURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil && parsed.Fragment == ""
}

func safeAssetName(value string) bool {
	return value != "" && len(value) <= 255 && value != "." && value != ".." && !strings.ContainsAny(value, "/\\?#")
}

func invalid(reason string) error {
	return fmt.Errorf("%w: %s", ErrInvalidResponse, reason)
}
