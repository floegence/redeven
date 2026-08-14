package pluginmarket

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/floegence/redevplugin/pkg/host"
	pluginmanifest "github.com/floegence/redevplugin/pkg/manifest"
	"github.com/floegence/redevplugin/pkg/remoterelease"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
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
	PluginID     string              `json:"plugin_id"`
	PublisherID  string              `json:"publisher_id"`
	Presentation PresentationCompact `json:"presentation"`
	Categories   []string            `json:"categories"`
	Channels     []string            `json:"channels"`
	Latest       LatestPointer       `json:"latest"`
}

type PresentationCompact struct {
	DefaultLocale string                      `json:"default_locale"`
	Icon          *PresentationIcon           `json:"icon,omitempty"`
	Locales       []PresentationCompactLocale `json:"locales"`
}

type PresentationIcon struct {
	URL       string `json:"url"`
	MediaType string `json:"media_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	SHA256    string `json:"sha256"`
}

type PresentationCompactLocale struct {
	Locale        string   `json:"locale"`
	Name          string   `json:"name"`
	PublisherName string   `json:"publisher_name,omitempty"`
	Summary       string   `json:"summary"`
	Keywords      []string `json:"keywords"`
}

type PresentationFull struct {
	DefaultLocale string                   `json:"default_locale"`
	Icon          *PresentationIcon        `json:"icon,omitempty"`
	Locales       []PresentationFullLocale `json:"locales"`
}

type PresentationFullLocale struct {
	Locale        string                `json:"locale"`
	Name          string                `json:"name"`
	PublisherName string                `json:"publisher_name,omitempty"`
	Summary       string                `json:"summary"`
	Description   []string              `json:"description"`
	Highlights    []string              `json:"highlights"`
	Keywords      []string              `json:"keywords"`
	Surfaces      []PresentationSurface `json:"surfaces"`
	Settings      []PresentationSetting `json:"settings"`
}

// PresentationCatalog is the normalized author presentation exchanged by the
// market and host. Catalog responses may omit detail-only arrays; detail
// responses populate every field.
type PresentationCatalog = PresentationFull
type PresentationLocale = PresentationFullLocale

type ResolvedSurfacePresentation = pluginmanifest.ResolvedSurfacePresentation
type ResolvedSettingPresentation = pluginmanifest.ResolvedSettingPresentation
type ResolvedPresentation = pluginmanifest.ResolvedPresentation

func ResolvePresentation(presentation PresentationCatalog, requestedLocale string) ResolvedPresentation {
	catalog := pluginmanifest.PresentationCatalog{DefaultLocale: presentation.DefaultLocale}
	for _, locale := range presentation.Locales {
		resolved := pluginmanifest.PresentationLocale{
			Locale: locale.Locale, PluginName: locale.Name, PublisherName: locale.PublisherName,
			Summary: locale.Summary, Description: slices.Clone(locale.Description),
			Highlights: slices.Clone(locale.Highlights), Keywords: slices.Clone(locale.Keywords),
			Surfaces: make([]pluginmanifest.ResolvedSurfacePresentation, len(locale.Surfaces)),
			Settings: make([]pluginmanifest.ResolvedSettingPresentation, len(locale.Settings)),
		}
		for index, surface := range locale.Surfaces {
			resolved.Surfaces[index] = pluginmanifest.ResolvedSurfacePresentation{SurfaceID: surface.SurfaceID, Label: surface.Label}
		}
		for index, setting := range locale.Settings {
			options := make([]pluginmanifest.SettingOptionSpec, len(setting.Options))
			for optionIndex, option := range setting.Options {
				options[optionIndex] = pluginmanifest.SettingOptionSpec{Value: option.Value, Label: option.Label}
			}
			resolved.Settings[index] = pluginmanifest.ResolvedSettingPresentation{Key: setting.Key, Label: setting.Label, Options: options}
		}
		catalog.Locales = append(catalog.Locales, resolved)
	}
	return pluginmanifest.ResolvePresentation(catalog, requestedLocale)
}

type PresentationSurface struct {
	SurfaceID string `json:"surface_id"`
	Label     string `json:"label"`
}

type PresentationSetting struct {
	Key     string                      `json:"key"`
	Label   string                      `json:"label"`
	Options []PresentationSettingOption `json:"options"`
}

type PresentationSettingOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
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

type PluginRepository struct {
	Provider     string `json:"provider"`
	RepositoryID int64  `json:"repository_id"`
	Owner        string `json:"owner"`
	Name         string `json:"name"`
	URL          string `json:"url"`
}

type PluginDetail struct {
	PluginID      string           `json:"plugin_id"`
	PublisherID   string           `json:"publisher_id"`
	Presentation  PresentationFull `json:"presentation"`
	Categories    []string         `json:"categories"`
	Channels      []string         `json:"channels"`
	Repository    PluginRepository `json:"repository"`
	Compatibility Compatibility    `json:"compatibility"`
	Status        string           `json:"status"`
	Latest        []LatestPointer  `json:"latest"`
}

type PluginDetailResponse struct {
	Data PluginDetail `json:"data"`
	Meta Meta         `json:"meta"`
}

type CatalogPlugin struct {
	PluginID     string              `json:"plugin_id"`
	PublisherID  string              `json:"publisher_id"`
	Presentation PresentationCompact `json:"presentation"`
	Categories   []string            `json:"categories"`
	Channels     []string            `json:"channels"`
	Latest       LatestPointer       `json:"latest"`
	Release      *LatestRelease      `json:"release,omitempty"`
}

const (
	SnapshotSchemaVersion = "redeven.plugin_market_snapshot.v2"
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

func (snapshot Snapshot) Clone() Snapshot {
	return cloneSnapshot(snapshot)
}

func (snapshot Snapshot) LatestRelease(pluginID, channel string) (LatestRelease, error) {
	for _, plugin := range snapshot.Plugins {
		if plugin.PluginID == pluginID && plugin.Latest.Channel == channel && plugin.Release != nil {
			return *cloneLatestRelease(plugin.Release), nil
		}
	}
	return LatestRelease{}, ErrReleaseMissing
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
			PluginID: plugin.PluginID, PublisherID: plugin.PublisherID, Presentation: plugin.Presentation,
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
	if !idPattern.MatchString(plugin.PluginID) || !idPattern.MatchString(plugin.PublisherID) || !validateCompactPresentation(plugin.Presentation, plugin.PluginID) ||
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

func validateCompactPresentation(presentation PresentationCompact, pluginID string) bool {
	if presentation.DefaultLocale == "" || len(presentation.Locales) == 0 || len(presentation.Locales) > 16 || !validatePresentationIcon(presentation.Icon, pluginID) {
		return false
	}
	seen := make(map[string]struct{}, len(presentation.Locales))
	defaultPublisherPresent := false
	for _, locale := range presentation.Locales {
		if locale.Locale == presentation.DefaultLocale {
			defaultPublisherPresent = locale.PublisherName != ""
			break
		}
	}
	for _, locale := range presentation.Locales {
		if !validPresentationLocale(locale.Locale) || !validPresentationText(locale.Name, 128) ||
			(locale.PublisherName != "" && !validPresentationText(locale.PublisherName, 128)) ||
			(defaultPublisherPresent != (locale.PublisherName != "")) || !validPresentationText(locale.Summary, 240) ||
			len(locale.Keywords) == 0 || len(locale.Keywords) > 12 || hasDuplicateKeywords(locale.Keywords) {
			return false
		}
		for _, keyword := range locale.Keywords {
			if !validPresentationText(keyword, 64) {
				return false
			}
		}
		if _, exists := seen[locale.Locale]; exists {
			return false
		}
		seen[locale.Locale] = struct{}{}
	}
	_, exists := seen[presentation.DefaultLocale]
	return exists && validPresentationLocale(presentation.DefaultLocale)
}

func validateFullPresentation(presentation PresentationFull, pluginID string) bool {
	if len(presentation.Locales) == 0 || len(presentation.Locales) > 16 || !validPresentationLocale(presentation.DefaultLocale) || !validatePresentationIcon(presentation.Icon, pluginID) {
		return false
	}
	seen := make(map[string]struct{}, len(presentation.Locales))
	var defaultLocale *PresentationFullLocale
	for index := range presentation.Locales {
		locale := &presentation.Locales[index]
		if !validPresentationLocale(locale.Locale) || !validPresentationText(locale.Name, 128) || !validPresentationText(locale.Summary, 240) || len(locale.Description) == 0 || len(locale.Description) > 12 || len(locale.Keywords) == 0 || len(locale.Keywords) > 12 || len(locale.Highlights) > 8 || hasDuplicateKeywords(locale.Keywords) {
			return false
		}
		if locale.PublisherName != "" && !validPresentationText(locale.PublisherName, 128) {
			return false
		}
		if _, exists := seen[locale.Locale]; exists {
			return false
		}
		seen[locale.Locale] = struct{}{}
		if locale.Locale == presentation.DefaultLocale {
			defaultLocale = locale
		}
		if hasDuplicateIDs(locale.Surfaces, func(surface PresentationSurface) string { return surface.SurfaceID }) || hasDuplicateIDs(locale.Settings, func(setting PresentationSetting) string { return setting.Key }) {
			return false
		}
		for _, surface := range locale.Surfaces {
			if !idPattern.MatchString(surface.SurfaceID) || !validPresentationText(surface.Label, 128) {
				return false
			}
		}
		for _, setting := range locale.Settings {
			if strings.TrimSpace(setting.Key) == "" || utf8.RuneCountInString(setting.Key) > 128 || !validPresentationText(setting.Label, 128) || hasDuplicateIDs(setting.Options, func(option PresentationSettingOption) string { return option.Value }) {
				return false
			}
			for _, option := range setting.Options {
				if strings.TrimSpace(option.Value) == "" || utf8.RuneCountInString(option.Value) > 128 || !validPresentationText(option.Label, 128) {
					return false
				}
			}
		}
		if len(locale.Description) == 0 || len(locale.Description) > 12 || runeCount(locale.Description) > 8000 {
			return false
		}
		for _, text := range locale.Description {
			if !validPresentationText(text, 1000) {
				return false
			}
		}
		for _, text := range locale.Highlights {
			if !validPresentationText(text, 240) {
				return false
			}
		}
		for _, text := range locale.Keywords {
			if !validPresentationText(text, 64) {
				return false
			}
		}
	}
	if defaultLocale == nil {
		return false
	}
	defaultPublisherPresent := defaultLocale.PublisherName != ""
	defaultSurfaces := make(map[string]struct{}, len(defaultLocale.Surfaces))
	defaultSettings := make(map[string]PresentationSetting, len(defaultLocale.Settings))
	for _, surface := range defaultLocale.Surfaces {
		defaultSurfaces[surface.SurfaceID] = struct{}{}
	}
	for _, setting := range defaultLocale.Settings {
		defaultSettings[setting.Key] = setting
	}
	for _, locale := range presentation.Locales {
		if (locale.PublisherName != "") != defaultPublisherPresent {
			return false
		}
		if len(locale.Surfaces) != len(defaultSurfaces) || len(locale.Settings) != len(defaultSettings) {
			return false
		}
		for _, surface := range locale.Surfaces {
			if _, ok := defaultSurfaces[surface.SurfaceID]; !ok {
				return false
			}
		}
		for _, setting := range locale.Settings {
			expected, ok := defaultSettings[setting.Key]
			if !ok || len(setting.Options) != len(expected.Options) {
				return false
			}
			values := make(map[string]struct{}, len(expected.Options))
			for _, option := range expected.Options {
				values[option.Value] = struct{}{}
			}
			for _, option := range setting.Options {
				if _, ok := values[option.Value]; !ok {
					return false
				}
			}
		}
	}
	return true
}

func validatePresentationIcon(icon *PresentationIcon, pluginID string) bool {
	if icon == nil {
		return true
	}
	if !idPattern.MatchString(pluginID) || !shaPattern.MatchString(icon.SHA256) ||
		(icon.MediaType != "image/png" && icon.MediaType != "image/webp") ||
		icon.Width < 1 || icon.Width > 512 || icon.Height < 1 || icon.Height > 512 {
		return false
	}
	parsed, err := url.ParseRequestURI(icon.URL)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" ||
		parsed.Path != "/v1/plugins/"+url.PathEscape(pluginID)+"/icon" {
		return false
	}
	query := parsed.Query()
	return len(query) == 1 && len(query["sha256"]) == 1 && query.Get("sha256") == icon.SHA256
}

func validPresentationLocale(value string) bool {
	if strings.TrimSpace(value) != value || value == "" {
		return false
	}
	tag, err := language.Parse(value)
	return err == nil && tag.String() == value
}

func validPresentationText(value string, maxRunes int) bool {
	if value == "" || !utf8.ValidString(value) || strings.TrimSpace(value) != value || norm.NFC.String(value) != value || utf8.RuneCountInString(value) > maxRunes {
		return false
	}
	for _, valueRune := range value {
		if unicode.IsControl(valueRune) {
			return false
		}
	}
	return true
}

func hasDuplicateKeywords(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	fold := cases.Fold()
	for _, value := range values {
		key := fold.String(value)
		if _, exists := seen[key]; exists {
			return true
		}
		seen[key] = struct{}{}
	}
	return false
}

func runeCount(values []string) int {
	total := 0
	for _, value := range values {
		total += utf8.RuneCountInString(value)
	}
	return total
}

func hasDuplicateIDs[T any](values []T, key func(T) string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		id := key(value)
		if _, exists := seen[id]; exists {
			return true
		}
		seen[id] = struct{}{}
	}
	return false
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
