package pluginmarket

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	defaultMarketOrigin  = "https://plugins.redeven.com"
	maxMarketResponse    = 8 << 20
	maxMarketIcon        = 512 << 10
	marketRequestTimeout = 15 * time.Second
)

type IconAsset struct {
	Data      []byte
	MediaType string
	SHA256    string
}

type ServiceOptions struct {
	Origin             string
	CachePath          string
	HTTPClient         *http.Client
	Now                func() time.Time
	RedevenVersion     string
	ReDevPluginVersion string
}

type Service struct {
	origin             *url.URL
	cachePath          string
	httpClient         *http.Client
	now                func() time.Time
	redevenVersion     string
	redevpluginVersion string

	mu   sync.RWMutex
	last *Snapshot
}

func NewService(options ServiceOptions) (*Service, error) {
	originValue := strings.TrimSpace(options.Origin)
	if originValue == "" {
		originValue = defaultMarketOrigin
	}
	origin, err := url.Parse(originValue)
	if err != nil || !validMarketOrigin(origin) {
		return nil, errors.New("plugin market origin must be an HTTPS origin")
	}
	cachePath := strings.TrimSpace(options.CachePath)
	if cachePath == "" {
		return nil, errors.New("plugin market cache path is required")
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		origin: origin, cachePath: cachePath, httpClient: client, now: now,
		redevenVersion:     compatibilityVersion(options.RedevenVersion, "1.0.0"),
		redevpluginVersion: compatibilityVersion(options.ReDevPluginVersion, "0.0.0"),
	}, nil
}

func compatibilityVersion(value, fallback string) string {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if semverPattern.MatchString(value) {
		return value
	}
	return fallback
}

func validMarketOrigin(origin *url.URL) bool {
	if origin == nil || origin.Hostname() == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return false
	}
	if origin.Scheme == "https" {
		return true
	}
	// Local Wrangler development is intentionally the only plaintext exception.
	// It cannot be used for a non-loopback host or by the default production path.
	if origin.Scheme != "http" {
		return false
	}
	host := strings.ToLower(origin.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// Refresh fetches and validates one current remote catalog snapshot. Cache
// fallback is intentionally separate so callers cannot confuse displayable
// last-known-good data with fresh release authority.
func (service *Service) Refresh(ctx context.Context) (Snapshot, error) {
	if service == nil {
		return Snapshot{}, ErrUnavailable
	}
	snapshot, err := service.refresh(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	service.mu.RLock()
	last := service.last
	if last != nil && snapshot.Generation < last.Generation {
		service.mu.RUnlock()
		return Snapshot{}, invalid("catalog generation moved backwards")
	}
	service.mu.RUnlock()
	if err := service.writeCache(snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("persist plugin market cache: %w", err)
	}
	service.mu.Lock()
	service.last = &snapshot
	service.mu.Unlock()
	return cloneSnapshot(snapshot), nil
}

// CachedSnapshot returns only already-verified local evidence and never starts
// a network request. It lets the host render its last known catalog and bind a
// pending release provider before the background market refresh completes.
func (service *Service) CachedSnapshot() (Snapshot, bool) {
	if service == nil {
		return Snapshot{}, false
	}
	service.mu.RLock()
	last := service.last
	if last != nil {
		snapshot := cloneSnapshot(*last)
		service.mu.RUnlock()
		snapshot.Stale = true
		snapshot.Source = SnapshotSourceCache
		return snapshot, true
	}
	service.mu.RUnlock()
	snapshot, err := service.readCache()
	if err != nil {
		return Snapshot{}, false
	}
	service.mu.Lock()
	if service.last == nil {
		frozen := cloneSnapshot(snapshot)
		service.last = &frozen
	}
	last = service.last
	service.mu.Unlock()
	return cloneSnapshot(*last), true
}

func (service *Service) Detail(ctx context.Context, pluginID string) (PluginDetail, int64, error) {
	if service == nil || !idPattern.MatchString(pluginID) {
		return PluginDetail{}, -1, ErrInvalidResponse
	}
	endpoint := service.endpoint("/v1/plugins/" + url.PathEscape(pluginID))
	var response PluginDetailResponse
	if _, err := service.getJSON(ctx, endpoint, &response); err != nil {
		return PluginDetail{}, -1, err
	}
	if response.Meta.Generation < 0 || response.Meta.Stale || response.Data.PluginID != pluginID || !idPattern.MatchString(response.Data.PublisherID) || response.Data.Status == "" || len(response.Data.Presentation.Locales) == 0 {
		return PluginDetail{}, -1, invalid("plugin detail is invalid")
	}
	if !validateFullPresentation(response.Data.Presentation, pluginID) {
		return PluginDetail{}, -1, invalid("plugin detail presentation is invalid")
	}
	return response.Data, response.Meta.Generation, nil
}

func (service *Service) Icon(ctx context.Context, pluginID string, expected PresentationIcon) (IconAsset, error) {
	if service == nil || !validatePresentationIcon(&expected, pluginID) {
		return IconAsset{}, ErrInvalidResponse
	}
	endpoint := service.endpoint("/v1/plugins/" + url.PathEscape(pluginID) + "/icon")
	query := endpoint.Query()
	query.Set("sha256", expected.SHA256)
	endpoint.RawQuery = query.Encode()
	requestCtx, cancel := context.WithTimeout(ctx, marketRequestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return IconAsset{}, err
	}
	request.Header.Set("Accept", expected.MediaType)
	request.Header.Set("User-Agent", "Redeven")
	response, err := service.httpClient.Do(request)
	if err != nil {
		return IconAsset{}, err
	}
	defer response.Body.Close()
	if response.Request != nil && response.Request.URL.String() != endpoint.String() {
		return IconAsset{}, invalid("plugin icon redirected outside its evidence-bound URL")
	}
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		return IconAsset{}, fmt.Errorf("plugin market returned HTTP %d", response.StatusCode)
	}
	mediaType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if mediaType != expected.MediaType {
		return IconAsset{}, invalid("plugin icon media type does not match catalog evidence")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxMarketIcon+1))
	if err != nil {
		return IconAsset{}, err
	}
	if len(data) == 0 || len(data) > maxMarketIcon || fmt.Sprintf("%x", sha256.Sum256(data)) != expected.SHA256 {
		return IconAsset{}, invalid("plugin icon bytes do not match catalog evidence")
	}
	return IconAsset{Data: data, MediaType: mediaType, SHA256: expected.SHA256}, nil
}

func (service *Service) refresh(ctx context.Context) (Snapshot, error) {
	plugins := make([]CatalogPlugin, 0)
	cursor := ""
	generation := int64(-1)
	etag := ""
	seen := map[string]struct{}{}
	for {
		endpoint := service.endpoint("/v1/catalog")
		query := endpoint.Query()
		query.Set("channel", "stable")
		query.Set("limit", "100")
		query.Set("redeven_version", service.redevenVersion)
		query.Set("redevplugin_version", service.redevpluginVersion)
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		endpoint.RawQuery = query.Encode()
		var page CatalogResponse
		responseETag, err := service.getJSON(ctx, endpoint, &page)
		if err != nil {
			return Snapshot{}, err
		}
		if page.Meta.Generation < 0 || page.Meta.Stale {
			return Snapshot{}, invalid("remote catalog is stale or has an invalid generation")
		}
		if generation == -1 {
			generation = page.Meta.Generation
			etag = responseETag
		} else if generation != page.Meta.Generation {
			return Snapshot{}, invalid("catalog generation changed during pagination")
		}
		for _, summary := range page.Data {
			if err := validatePluginSummary(summary); err != nil {
				return Snapshot{}, err
			}
			if _, exists := seen[summary.PluginID]; exists {
				return Snapshot{}, invalid("catalog contains a duplicate plugin")
			}
			seen[summary.PluginID] = struct{}{}
			plugin := CatalogPlugin{
				PluginID: summary.PluginID, PublisherID: summary.PublisherID, Presentation: cloneCompactPresentation(summary.Presentation),
				Categories: slices.Clone(summary.Categories), Channels: slices.Clone(summary.Channels), Latest: summary.Latest,
			}
			if summary.Latest.AvailabilityStatus == "visible" {
				if summary.Latest.InstallPreview == nil {
					return Snapshot{}, invalid("visible catalog release is missing its install preview")
				}
				plugin.Release = cloneLatestRelease(&summary.Latest.InstallPreview.Release)
			}
			plugins = append(plugins, plugin)
		}
		if page.Meta.NextCursor == "" {
			break
		}
		if len(page.Meta.NextCursor) > 4096 || page.Meta.NextCursor == cursor {
			return Snapshot{}, invalid("catalog cursor is invalid")
		}
		cursor = page.Meta.NextCursor
	}
	if generation < 0 {
		return Snapshot{}, invalid("catalog response is empty")
	}
	slices.SortFunc(plugins, func(left, right CatalogPlugin) int { return strings.Compare(left.PluginID, right.PluginID) })
	snapshot := Snapshot{
		SchemaVersion: SnapshotSchemaVersion,
		Generation:    generation,
		ETag:          etag,
		CachedAt:      service.now().UTC(),
		Source:        SnapshotSourceRemote,
		Plugins:       plugins,
	}
	if err := validateSnapshot(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (service *Service) getJSON(parent context.Context, endpoint url.URL, destination any) (string, error) {
	ctx, cancel := context.WithTimeout(parent, marketRequestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Redeven")
	response, err := service.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		return "", fmt.Errorf("plugin market returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxMarketResponse+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return "", invalid("decode response: " + err.Error())
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return "", invalid("response contains trailing JSON")
	}
	return strings.TrimSpace(response.Header.Get("ETag")), nil
}

func (service *Service) endpoint(path string) url.URL {
	endpoint := *service.origin
	endpoint.Path = path
	return endpoint
}

func (service *Service) readCache() (Snapshot, error) {
	value, err := os.ReadFile(service.cachePath)
	if err != nil {
		return Snapshot{}, err
	}
	var snapshot Snapshot
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return Snapshot{}, invalid("decode cached snapshot: " + err.Error())
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Snapshot{}, invalid("cached snapshot contains trailing JSON")
	}
	snapshot.Stale = true
	snapshot.Source = SnapshotSourceCache
	if err := validateSnapshot(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (service *Service) writeCache(snapshot Snapshot) error {
	value, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	directory := filepath.Dir(service.cachePath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".plugin-market-lkg-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(value); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, service.cachePath); err != nil {
		return err
	}
	committed = true
	return nil
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	result := snapshot
	result.Plugins = make([]CatalogPlugin, len(snapshot.Plugins))
	for index, plugin := range snapshot.Plugins {
		result.Plugins[index] = plugin
		result.Plugins[index].Categories = slices.Clone(plugin.Categories)
		result.Plugins[index].Channels = slices.Clone(plugin.Channels)
		result.Plugins[index].Presentation = cloneCompactPresentation(plugin.Presentation)
		result.Plugins[index].Release = cloneLatestRelease(plugin.Release)
	}
	return result
}

func cloneCompactPresentation(presentation PresentationCompact) PresentationCompact {
	result := presentation
	if presentation.Icon != nil {
		icon := *presentation.Icon
		result.Icon = &icon
	}
	result.Locales = make([]PresentationCompactLocale, len(presentation.Locales))
	for index, locale := range presentation.Locales {
		result.Locales[index] = locale
		result.Locales[index].Keywords = slices.Clone(locale.Keywords)
	}
	return result
}

func cloneLatestRelease(release *LatestRelease) *LatestRelease {
	if release == nil {
		return nil
	}
	result := *release
	result.PublisherReleaseRef.Files = slices.Clone(release.PublisherReleaseRef.Files)
	result.TransportAssets = slices.Clone(release.TransportAssets)
	if release.InstallPreview != nil {
		preview := *release.InstallPreview
		previewRelease := preview.Release
		previewRelease.InstallPreview = nil
		preview.Release = *cloneLatestRelease(&previewRelease)
		preview.TransportAssets = slices.Clone(preview.TransportAssets)
		preview.SecuritySummary.Permissions = slices.Clone(preview.SecuritySummary.Permissions)
		preview.SecuritySummary.Methods = slices.Clone(preview.SecuritySummary.Methods)
		preview.SecuritySummary.CapabilityContracts = slices.Clone(preview.SecuritySummary.CapabilityContracts)
		preview.SecuritySummary.Workers = slices.Clone(preview.SecuritySummary.Workers)
		preview.SecuritySummary.Network = slices.Clone(preview.SecuritySummary.Network)
		preview.SecuritySummary.Storage = slices.Clone(preview.SecuritySummary.Storage)
		preview.SecuritySummary.SecretRefs = slices.Clone(preview.SecuritySummary.SecretRefs)
		preview.SecuritySummary.CoreActions = slices.Clone(preview.SecuritySummary.CoreActions)
		preview.SecuritySummary.Intents = slices.Clone(preview.SecuritySummary.Intents)
		preview.SecuritySummary.Surfaces = slices.Clone(preview.SecuritySummary.Surfaces)
		result.InstallPreview = &preview
	}
	return &result
}
