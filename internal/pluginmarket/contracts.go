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

	"github.com/floegence/redevplugin/v3/pkg/host"
	pluginmanifest "github.com/floegence/redevplugin/v3/pkg/manifest"
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
	idPattern          = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,127}$`)
	semverPattern      = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
	tagPattern         = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+@-]{0,254}$`)
	shaPattern         = regexp.MustCompile(`^[0-9a-f]{64}$`)
	prefixedSHAPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	commitPattern      = regexp.MustCompile(`^[0-9a-f]{40}$`)
	locatorPattern     = regexp.MustCompile(`^[A-Za-z0-9._@+-]+(?:/[A-Za-z0-9._@+-]+)*$`)
)

type Meta struct {
	RequestID  string `json:"request_id"`
	Generation int64  `json:"generation"`
	Stale      bool   `json:"stale"`
	NextCursor string `json:"next_cursor,omitempty"`
	CachedAt   string `json:"cached_at,omitempty"`
}

type LatestPointer struct {
	Channel            string          `json:"channel"`
	Version            string          `json:"version"`
	AvailabilityStatus string          `json:"availability_status"`
	InstallPreview     *InstallPreview `json:"install_preview,omitempty"`
}

type PluginSummary struct {
	PluginID     string              `json:"plugin_id"`
	PublisherID  string              `json:"publisher_id"`
	SourceKind   string              `json:"source_kind"`
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

type LatestRelease struct {
	PluginID              string          `json:"plugin_id"`
	Channel               string          `json:"channel"`
	Version               string          `json:"version"`
	Source                ReleaseSource   `json:"source"`
	Asset                 ReleaseAsset    `json:"asset"`
	PublisherID           string          `json:"publisher_id"`
	PackageSHA256         string          `json:"package_sha256"`
	ManifestSHA256        string          `json:"manifest_sha256"`
	EntriesSHA256         string          `json:"entries_sha256"`
	ReleaseIdentityDigest string          `json:"release_identity_digest"`
	InstallPreview        *InstallPreview `json:"install_preview,omitempty"`
}

// InstallPreview is the market's verified, display-ready projection for the
// exact release. ReDevPlugin remains the installation authority; Redeven only
// transports this evidence to the UI and binds the command to its digests.
type InstallPreview struct {
	Release               LatestRelease                       `json:"release"`
	SecuritySummary       host.ExternalPackageSecuritySummary `json:"security_summary"`
	ReleaseIdentityDigest string                              `json:"release_identity_digest"`
	ManifestSHA256        string                              `json:"manifest_sha256"`
	ContractSetSHA256     string                              `json:"contract_set_sha256"`
	SummarySHA256         string                              `json:"summary_sha256"`
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
	SourceKind   string           `json:"source_kind"`
	PluginID     string           `json:"plugin_id"`
	PublisherID  string           `json:"publisher_id"`
	Presentation PresentationFull `json:"presentation"`
	Categories   []string         `json:"categories"`
	Channels     []string         `json:"channels"`
	Repository   PluginRepository `json:"repository"`
	Status       string           `json:"status"`
	Latest       []LatestPointer  `json:"latest"`
}

type PluginDetailResponse struct {
	Data PluginDetail `json:"data"`
	Meta Meta         `json:"meta"`
}

type CatalogPlugin struct {
	PluginID     string              `json:"plugin_id"`
	PublisherID  string              `json:"publisher_id"`
	SourceKind   string              `json:"source_kind"`
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

func validateSnapshot(snapshot Snapshot) error {
	if snapshot.SchemaVersion != SnapshotSchemaVersion || snapshot.Generation < 0 || snapshot.CachedAt.IsZero() || snapshot.CachedAt.Location() != time.UTC ||
		(snapshot.Source != SnapshotSourceRemote && snapshot.Source != SnapshotSourceCache) {
		return invalid("snapshot metadata is invalid")
	}
	seen := make(map[string]struct{}, len(snapshot.Plugins))
	for _, plugin := range snapshot.Plugins {
		if err := validatePluginSummary(PluginSummary{
			PluginID: plugin.PluginID, PublisherID: plugin.PublisherID, SourceKind: plugin.SourceKind, Presentation: plugin.Presentation,
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
	if plugin.SourceKind != "official" && plugin.SourceKind != "community" {
		return invalid("catalog source kind is invalid")
	}
	if !idPattern.MatchString(plugin.PluginID) || !idPattern.MatchString(plugin.PublisherID) || !validateCompactPresentation(plugin.Presentation, plugin.PluginID) ||
		len(plugin.Channels) == 0 || !idPattern.MatchString(plugin.Latest.Channel) || !semverPattern.MatchString(plugin.Latest.Version) {
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
	if plugin.Latest.InstallPreview != nil {
		if err := validateInstallPreview(*plugin.Latest.InstallPreview, plugin.PluginID, plugin.Latest.Channel, plugin.Latest.Version); err != nil {
			return err
		}
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
	return validateLatestReleaseWithPreview(release, true)
}

func validateLatestReleaseWithPreview(release LatestRelease, validatePreview bool) error {
	if !idPattern.MatchString(release.PluginID) || !idPattern.MatchString(release.PublisherID) || release.Channel != "stable" || !semverPattern.MatchString(release.Version) ||
		release.Source.Provider != "github" || release.Source.RepositoryID <= 0 || release.Source.ReleaseID <= 0 ||
		!regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,99}$`).MatchString(release.Source.RepositoryOwner) ||
		!regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`).MatchString(release.Source.RepositoryName) ||
		!regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*-v`+regexp.QuoteMeta(release.Version)+`$`).MatchString(release.Source.Tag) ||
		!commitPattern.MatchString(release.Source.TargetCommit) || !prefixedSHAPattern.MatchString(release.ReleaseIdentityDigest) {
		return invalid("latest release identity is invalid")
	}
	for _, digest := range []string{release.PackageSHA256, release.ManifestSHA256, release.EntriesSHA256} {
		if !shaPattern.MatchString(digest) {
			return invalid("latest release package hashes are invalid")
		}
	}
	if err := validateReleaseAsset(release.Asset); err != nil {
		return err
	}
	expected := "https://github.com/" + release.Source.RepositoryOwner + "/" + release.Source.RepositoryName + "/releases/download/" + url.PathEscape(release.Source.Tag) + "/" + url.PathEscape(release.Asset.Name)
	if release.Asset.URL != expected {
		return invalid("package URL differs from its exact source identity")
	}
	if validatePreview && release.InstallPreview != nil {
		if err := validateInstallPreview(*release.InstallPreview, release.PluginID, release.Channel, release.Version); err != nil {
			return err
		}
	}
	return nil
}

func validateInstallPreview(preview InstallPreview, pluginID, channel, version string) error {
	if preview.Release.PluginID != pluginID || preview.Release.Channel != channel || preview.Release.Version != version {
		return invalid("install preview release does not match catalog pointer")
	}
	if err := validateLatestReleaseWithPreview(preview.Release, false); err != nil {
		return err
	}
	if preview.ManifestSHA256 != "sha256:"+preview.Release.ManifestSHA256 ||
		preview.ReleaseIdentityDigest != preview.Release.ReleaseIdentityDigest || !prefixedSHAPattern.MatchString(preview.ReleaseIdentityDigest) ||
		!prefixedSHAPattern.MatchString(preview.ManifestSHA256) || !prefixedSHAPattern.MatchString(preview.ContractSetSHA256) || !prefixedSHAPattern.MatchString(preview.SummarySHA256) ||
		preview.SecuritySummary.SummarySHA256 != preview.SummarySHA256 {
		return invalid("install preview identity is invalid")
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
