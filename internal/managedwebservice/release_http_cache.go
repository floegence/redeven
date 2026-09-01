package managedwebservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	releaseMetadataCacheTTL = 30 * time.Second
	releaseMetadataMaxBytes = 16 << 20
	releaseMetadataMaxTotal = 128 << 20
	releaseMetadataMaxItems = 12_000
)

type releaseRefreshContextKey struct{}

func withReleaseSourceRefresh(ctx context.Context) context.Context {
	return context.WithValue(ctx, releaseRefreshContextKey{}, true)
}

func releaseMetadataRedirectPolicy(request *http.Request, via []*http.Request) error {
	if len(via) >= 4 {
		return fmt.Errorf("too many release source redirects")
	}
	if request.URL.Scheme != "https" {
		return fmt.Errorf("release source redirect must use HTTPS")
	}
	if len(via) > 0 && request.URL.Host != via[len(via)-1].URL.Host {
		request.Header.Del("Authorization")
		request.Header.Del("Cookie")
	}
	return nil
}

type releaseMetadataEntry struct {
	status     int
	statusText string
	header     http.Header
	body       []byte
	storedAt   time.Time
}

type releaseMetadataCall struct {
	done chan struct{}
}

// releaseMetadataTransport owns the one short-lived source cache used by both
// npm and OCI discovery. It collapses concurrent reads and keeps validators so
// a refresh never needs a parallel polling or product-server state source.
type releaseMetadataTransport struct {
	base     http.RoundTripper
	ttl      time.Duration
	maxBytes int64

	mu       sync.Mutex
	entries  map[string]releaseMetadataEntry
	inflight map[string]*releaseMetadataCall
	total    int64
}

func newReleaseMetadataTransport(base http.RoundTripper) *releaseMetadataTransport {
	if base == nil {
		base = http.DefaultTransport
	}
	return &releaseMetadataTransport{
		base: base, ttl: releaseMetadataCacheTTL, maxBytes: releaseMetadataMaxBytes,
		entries: map[string]releaseMetadataEntry{}, inflight: map[string]*releaseMetadataCall{},
	}
}

func (t *releaseMetadataTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil || request.Method != http.MethodGet || request.Body != nil || strings.TrimSpace(request.Header.Get("Accept")) == "" {
		return t.base.RoundTrip(request)
	}
	key := releaseMetadataCacheKey(request)
	force, _ := request.Context().Value(releaseRefreshContextKey{}).(bool)
	for {
		t.mu.Lock()
		entry, hasEntry := t.entries[key]
		if hasEntry && !force && time.Since(entry.storedAt) < t.ttl {
			t.mu.Unlock()
			return cachedMetadataResponse(request, entry), nil
		}
		if call, running := t.inflight[key]; running {
			t.mu.Unlock()
			select {
			case <-request.Context().Done():
				return nil, request.Context().Err()
			case <-call.done:
			}
			t.mu.Lock()
			entry, hasEntry = t.entries[key]
			t.mu.Unlock()
			if hasEntry {
				return cachedMetadataResponse(request, entry), nil
			}
			continue
		}
		call := &releaseMetadataCall{done: make(chan struct{})}
		t.inflight[key] = call
		t.mu.Unlock()

		response, err := t.fetch(request, entry, hasEntry)
		t.mu.Lock()
		delete(t.inflight, key)
		close(call.done)
		t.mu.Unlock()
		return response, err
	}
}

func (t *releaseMetadataTransport) fetch(request *http.Request, previous releaseMetadataEntry, hasPrevious bool) (*http.Response, error) {
	outbound := request.Clone(request.Context())
	outbound.Header = request.Header.Clone()
	if hasPrevious {
		if etag := strings.TrimSpace(previous.header.Get("ETag")); etag != "" {
			outbound.Header.Set("If-None-Match", etag)
		}
		if modified := strings.TrimSpace(previous.header.Get("Last-Modified")); modified != "" {
			outbound.Header.Set("If-Modified-Since", modified)
		}
	}
	response, err := t.base.RoundTrip(outbound)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusNotModified && hasPrevious {
		_ = response.Body.Close()
		previous.storedAt = time.Now()
		t.store(releaseMetadataCacheKey(request), previous)
		return cachedMetadataResponse(request, previous), nil
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusUnauthorized {
		return response, nil
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, t.maxBytes+1))
	closeErr := response.Body.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if int64(len(raw)) > t.maxBytes {
		return nil, fmt.Errorf("release metadata response exceeded its safe cache limit")
	}
	entry := releaseMetadataEntry{
		status: response.StatusCode, statusText: response.Status, header: response.Header.Clone(),
		body: append([]byte(nil), raw...), storedAt: time.Now(),
	}
	t.store(releaseMetadataCacheKey(request), entry)
	return cachedMetadataResponse(request, entry), nil
}

func (t *releaseMetadataTransport) store(key string, entry releaseMetadataEntry) {
	t.mu.Lock()
	if previous, ok := t.entries[key]; ok {
		t.total -= int64(len(previous.body))
	}
	t.entries[key] = entry
	t.total += int64(len(entry.body))
	for len(t.entries) > releaseMetadataMaxItems || t.total > releaseMetadataMaxTotal {
		oldestKey, oldestAt := "", time.Time{}
		for candidateKey, candidate := range t.entries {
			if oldestKey == "" || candidate.storedAt.Before(oldestAt) {
				oldestKey, oldestAt = candidateKey, candidate.storedAt
			}
		}
		if oldestKey == "" {
			break
		}
		t.total -= int64(len(t.entries[oldestKey].body))
		delete(t.entries, oldestKey)
	}
	t.mu.Unlock()
}

func releaseMetadataCacheKey(request *http.Request) string {
	authorization := sha256.Sum256([]byte(request.Header.Get("Authorization")))
	return request.URL.String() + "\x00" + request.Header.Get("Accept") + "\x00" + hex.EncodeToString(authorization[:])
}

func cachedMetadataResponse(request *http.Request, entry releaseMetadataEntry) *http.Response {
	return &http.Response{
		StatusCode: entry.status, Status: entry.statusText, Header: entry.header.Clone(),
		Body: io.NopCloser(bytes.NewReader(entry.body)), ContentLength: int64(len(entry.body)),
		Request: request,
	}
}
