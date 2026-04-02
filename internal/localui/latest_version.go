package localui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	localLatestVersionManifestURL                 = "https://version.agent.redeven.com/v1/manifest.json"
	localLatestVersionCacheTTL                    = 5 * time.Minute
	localLatestVersionUnavailableMessage          = "Latest version metadata is unavailable."
	localLatestVersionTemporaryUnavailableMessage = "Latest version metadata is temporarily unavailable."
	localLatestVersionDesktopManagedMessage       = "Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade."
)

var (
	localReleaseTagPattern                             = regexp.MustCompile(`^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	defaultLatestVersionResolver latestVersionResolver = newManifestLatestVersionResolver(
		localLatestVersionManifestURL,
		&http.Client{Timeout: 3 * time.Second},
		localLatestVersionCacheTTL,
	)
)

type latestVersionResolver interface {
	Load(context.Context) (latestVersionLoadResult, error)
}

type latestVersionResolverFunc func(context.Context) (latestVersionLoadResult, error)

func (fn latestVersionResolverFunc) Load(ctx context.Context) (latestVersionLoadResult, error) {
	return fn(ctx)
}

type latestVersionSnapshot struct {
	latest           string
	recommended      string
	sourceReleaseTag string
	releasePageURL   string
	etag             string
	fetchedAt        time.Time
	ttl              time.Duration
}

type latestVersionLoadResult struct {
	snapshot latestVersionSnapshot
	source   string
	stale    bool
	message  string
}

type latestVersionManifest struct {
	Latest           string `json:"latest"`
	Recommended      string `json:"recommended"`
	SourceReleaseTag string `json:"source_release_tag"`
	ReleasePageURL   string `json:"release_page_url"`
}

type manifestLatestVersionResolver struct {
	manifestURL string
	httpClient  *http.Client
	ttl         time.Duration
	now         func() time.Time

	mu       sync.Mutex
	snapshot latestVersionSnapshot
}

func newManifestLatestVersionResolver(manifestURL string, httpClient *http.Client, ttl time.Duration) *manifestLatestVersionResolver {
	url := strings.TrimSpace(manifestURL)
	if url == "" {
		url = localLatestVersionManifestURL
	}
	client := httpClient
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	if ttl <= 0 {
		ttl = localLatestVersionCacheTTL
	}
	return &manifestLatestVersionResolver{
		manifestURL: url,
		httpClient:  client,
		ttl:         ttl,
		now:         time.Now,
	}
}

func (r *manifestLatestVersionResolver) Load(ctx context.Context) (latestVersionLoadResult, error) {
	if r == nil {
		return latestVersionLoadResult{}, errors.New("missing latest version resolver")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	now := r.nowTime()
	snap := r.readSnapshot()
	hasCache := strings.TrimSpace(snap.latest) != "" && !snap.fetchedAt.IsZero()
	if hasCache && now.Sub(snap.fetchedAt) < snap.ttl {
		return latestVersionLoadResult{snapshot: snap, source: "cache"}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.manifestURL, nil)
	if err != nil {
		return r.withStaleFallback(snap, hasCache, err)
	}
	if strings.TrimSpace(snap.etag) != "" {
		req.Header.Set("If-None-Match", snap.etag)
	}

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return r.withStaleFallback(snap, hasCache, err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotModified:
		if !hasCache {
			return latestVersionLoadResult{}, errors.New("latest version manifest returned 304 without cache")
		}
		fetchedAt := r.nowTime()
		snap = r.refreshFetchedAt(fetchedAt)
		return latestVersionLoadResult{snapshot: snap, source: "upstream_not_modified"}, nil
	case http.StatusOK:
		// Continue below.
	default:
		return r.withStaleFallback(snap, hasCache, errors.New("latest version manifest returned non-200"))
	}

	var body latestVersionManifest
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return r.withStaleFallback(snap, hasCache, err)
	}

	latest, recommended, sourceReleaseTag, releasePageURL, err := normalizeLatestVersionManifest(body)
	if err != nil {
		return r.withStaleFallback(snap, hasCache, err)
	}

	fetchedAt := r.nowTime()
	next := latestVersionSnapshot{
		latest:           latest,
		recommended:      recommended,
		sourceReleaseTag: sourceReleaseTag,
		releasePageURL:   releasePageURL,
		etag:             strings.TrimSpace(resp.Header.Get("ETag")),
		fetchedAt:        fetchedAt,
		ttl:              r.ttl,
	}
	r.writeSnapshot(next)
	return latestVersionLoadResult{snapshot: next, source: "upstream"}, nil
}

func (r *manifestLatestVersionResolver) withStaleFallback(snap latestVersionSnapshot, hasCache bool, err error) (latestVersionLoadResult, error) {
	if hasCache {
		return latestVersionLoadResult{
			snapshot: snap,
			source:   "cache_stale",
			stale:    true,
			message:  localLatestVersionTemporaryUnavailableMessage,
		}, nil
	}
	return latestVersionLoadResult{}, err
}

func (r *manifestLatestVersionResolver) nowTime() time.Time {
	if r == nil || r.now == nil {
		return time.Now()
	}
	return r.now()
}

func (r *manifestLatestVersionResolver) readSnapshot() latestVersionSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()

	snap := r.snapshot
	if snap.ttl <= 0 {
		snap.ttl = r.ttl
	}
	return snap
}

func (r *manifestLatestVersionResolver) refreshFetchedAt(fetchedAt time.Time) latestVersionSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.snapshot.fetchedAt = fetchedAt
	if r.snapshot.ttl <= 0 {
		r.snapshot.ttl = r.ttl
	}
	return r.snapshot
}

func (r *manifestLatestVersionResolver) writeSnapshot(snap latestVersionSnapshot) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if snap.ttl <= 0 {
		snap.ttl = r.ttl
	}
	r.snapshot = snap
}

func normalizeLatestVersionManifest(body latestVersionManifest) (latest string, recommended string, sourceReleaseTag string, releasePageURL string, err error) {
	latest = strings.TrimSpace(body.Latest)
	recommended = strings.TrimSpace(body.Recommended)
	if latest == "" {
		return "", "", "", "", errors.New("manifest latest is empty")
	}
	if !localReleaseTagPattern.MatchString(latest) {
		return "", "", "", "", errors.New("manifest latest is invalid")
	}
	if recommended == "" || !localReleaseTagPattern.MatchString(recommended) {
		recommended = latest
	}
	return latest, recommended, strings.TrimSpace(body.SourceReleaseTag), strings.TrimSpace(body.ReleasePageURL), nil
}
