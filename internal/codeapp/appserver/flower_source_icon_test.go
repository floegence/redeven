package appserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

type flowerIconTransport func(*http.Request) (*http.Response, error)

func (f flowerIconTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func flowerTestPNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func flowerTestResponse(r *http.Request, b []byte) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b)), Request: r, Header: make(http.Header)}
}

func TestFlowerSourceIconCacheNinetyDaysAndRestart(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)
	icon := flowerTestPNG(t)
	var calls atomic.Int32
	c := newFlowerIconCache(dir)
	c.now = func() time.Time { return now }
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) { calls.Add(1); return flowerTestResponse(r, icon), nil })
	first := c.get(context.Background(), "https://example.com")
	if first.DataURL == "" || !first.ExpiresAt.Equal(now.Add(90*24*time.Hour)) {
		t.Fatalf("missing 90-day image: %+v", first)
	}
	restarted := newFlowerIconCache(dir)
	restarted.now = func() time.Time { return now.Add(89 * 24 * time.Hour) }
	restarted.client = c.client
	if got := restarted.get(context.Background(), "https://example.com"); got.DataURL != first.DataURL || calls.Load() != 1 {
		t.Fatal("restart must serve persisted bytes without another fetch")
	}
	restarted.now = func() time.Time { return now.Add(90 * 24 * time.Hour) }
	if got := restarted.get(context.Background(), "https://example.com"); got.DataURL == "" || calls.Load() != 2 {
		t.Fatal("expiry must refresh exactly once")
	}
}
func TestFlowerSourceIconDiscoveryAndNegativeCache(t *testing.T) {
	now := time.Now()
	c := newFlowerIconCache(t.TempDir())
	c.now = func() time.Time { return now }
	var calls atomic.Int32
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		switch r.URL.Path {
		case "/":
			return flowerTestResponse(r, []byte("<html><head><link rel='icon' href='/assets/brand.svg'></head></html>")), nil
		case "/assets/brand.svg":
			return flowerTestResponse(r, []byte("<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0h16v16z'/></svg>")), nil
		default:
			return flowerTestResponse(r, []byte("not an icon")), nil
		}
	})
	if got := c.get(context.Background(), "https://example.com"); !strings.HasPrefix(got.DataURL, "data:image/svg+xml;base64,") {
		t.Fatal("must discover real website link icon")
	}
	if calls.Load() != 3 {
		t.Fatalf("discovery requests: %d", calls.Load())
	}
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return flowerTestResponse(r, []byte("no icons")), nil
	})
	failed := c.get(context.Background(), "https://missing.example")
	before := calls.Load()
	if failed.DataURL != "" || !failed.ExpiresAt.Equal(now.Add(flowerIconFailureTTL)) {
		t.Fatal("failure must keep generated fallback and a short negative TTL")
	}
	if got := c.get(context.Background(), "https://missing.example"); got.DataURL != "" || calls.Load() != before {
		t.Fatal("failure must not refetch on every display")
	}
}
func TestFlowerSourceIconConcurrentDedupAndCancellation(t *testing.T) {
	c := newFlowerIconCache(t.TempDir())
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	png := flowerTestPNG(t)
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return flowerTestResponse(r, png), nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan flowerSourceIcon, 1)
	go func() { done <- c.get(ctx, "https://example.com") }()
	<-started
	var wait sync.WaitGroup
	results := make(chan flowerSourceIcon, 12)
	for range 12 {
		wait.Add(1)
		go func() { defer wait.Done(); results <- c.get(context.Background(), "https://example.com") }()
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelling an icon subscriber must return immediately")
	}
	close(release)
	wait.Wait()
	close(results)
	for icon := range results {
		if icon.DataURL == "" {
			t.Fatal("one subscriber cancellation must not poison shared result")
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("expected one concurrent fetch, got %d", calls.Load())
	}
}
func TestFlowerSourceIconBoundsAndOtherAPIAvailability(t *testing.T) {
	c := newFlowerIconCache(t.TempDir())
	release := make(chan struct{})
	started := make(chan struct{}, 4)
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-release
		return flowerTestResponse(r, []byte("missing")), nil
	})
	var wait sync.WaitGroup
	for _, host := range []string{"a.example", "b.example", "c.example", "d.example"} {
		wait.Add(1)
		go func() { defer wait.Done(); c.get(context.Background(), "https://"+host) }()
	}
	for range 4 {
		<-started
	}
	done := make(chan struct{})
	go func() { c.get(context.Background(), "https://overflow.example"); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("saturated icon work must not wait for a slot")
	}
	server := &Server{resolveSessionMeta: resolveMetaForTest("icons", session.Meta{CanRead: true, UserPublicID: "user", EndpointID: "runtime"})}
	r := httptest.NewRequest(http.MethodGet, "http://localhost/_redeven_proxy/api/ui-cache-scope", nil)
	r.Header.Set("Origin", envOriginWithChannel("icons"))
	w := httptest.NewRecorder()
	server.handleAPI(w, r)
	if w.Code != http.StatusOK {
		t.Fatal("icon requests must not block independent Runtime APIs")
	}
	close(release)
	wait.Wait()
}
func TestFlowerSourceIconPublicNetworkAndRedirectPolicy(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "https://user:pass@example.com", "http://127.0.0.1", "http://[::ffff:127.0.0.1]", "http://10.0.0.1", "http://localhost", "http://api.localhost", "https://example.com:8443", "https://example.com/path", "https://example.com?secret=1"} {
		if _, err := flowerIconOrigin(raw); err == nil {
			t.Errorf("accepted unsafe origin %s", raw)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "100.100.100.200", "192.0.2.1", "::1", "fc00::1", "fe80::1", "64:ff9b::a00:1", "2002:7f00:1::", "::ffff:192.168.1.1"} {
		if publicFlowerIconIP(netip.MustParseAddr(ip)) {
			t.Errorf("accepted nonpublic destination %s", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if !publicFlowerIconIP(netip.MustParseAddr(ip)) {
			t.Errorf("rejected public destination %s", ip)
		}
	}
	c := newFlowerIconCache("")
	prior := httptest.NewRequest("GET", "https://example.com/favicon.ico", nil)
	for _, destination := range []string{"http://example.com/favicon.ico", "https://127.0.0.1/icon", "https://user:secret@example.com/icon"} {
		r := httptest.NewRequest("GET", destination, nil)
		if c.client.CheckRedirect(r, []*http.Request{prior}) == nil {
			t.Errorf("unsafe redirect accepted %s", destination)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn, err := dialFlowerIcon(ctx, "tcp", "127.0.0.1:80"); err == nil {
		conn.Close()
		t.Fatal("dial must reject private resolved address")
	}
}
func TestFlowerSourceIconContentValidation(t *testing.T) {
	for _, body := range []string{"<html>not image</html>", "<svg><script>alert(1)</script></svg>", "<svg onload='alert(1)'/>", "<svg><image href='https://tracker.example/a'/></svg>", "<svg><use href='https://example.com/x'/></svg>", "<svg><path style='fill:url(https://example.com)'/></svg>", "<svg><path fill='url(https://example.com)'/></svg>", "<!DOCTYPE svg><svg/>"} {
		if flowerIconData([]byte(body)) != "" {
			t.Errorf("accepted active/invalid image %s", body)
		}
	}
	if flowerIconData(make([]byte, flowerIconMaxBytes+1)) != "" {
		t.Fatal("oversized image accepted")
	}
	var oversized bytes.Buffer
	_ = png.Encode(&oversized, image.NewNRGBA(image.Rect(0, 0, 1025, 1)))
	if flowerIconData(oversized.Bytes()) != "" {
		t.Fatal("oversized dimensions accepted")
	}
	var large bytes.Buffer
	_ = png.Encode(&large, image.NewNRGBA(image.Rect(0, 0, 256, 256)))
	data := flowerIconData(large.Bytes())
	decoded, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, "data:image/png;base64,"))
	cfg, _, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || cfg.Width != 64 {
		t.Fatal("large favicon must be reduced to a small resource")
	}
	icon := make([]byte, 22)
	copy(icon, []byte{0, 0, 1, 0, 1, 0})
	binary.LittleEndian.PutUint32(icon[14:18], 999)
	if flowerIconData(icon) != "" {
		t.Fatal("out of bounds ICO accepted")
	}
}
func TestFlowerSourceIconPermissionAndCorruptCache(t *testing.T) {
	for _, read := range []bool{false, true} {
		c := newFlowerIconCache(t.TempDir())
		c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
			t.Fatal("malformed/unauthorized request must not fetch")
			return nil, nil
		})
		server := &Server{sourceIcons: c, resolveSessionMeta: resolveMetaForTest("icons", session.Meta{CanRead: read})}
		server.sourceIconsOnce.Do(func() {})
		r := httptest.NewRequest("GET", "http://localhost/_redeven_proxy/api/flower/source-icon?origin="+url.QueryEscape("http://127.0.0.1"), nil)
		r.Header.Set("Origin", envOriginWithChannel("icons"))
		w := httptest.NewRecorder()
		server.handleAPI(w, r)
		expected := http.StatusForbidden
		if read {
			expected = http.StatusBadRequest
		}
		if w.Code != expected {
			t.Fatalf("expected %d got %d", expected, w.Code)
		}
	}
	c := newFlowerIconCache(t.TempDir())
	png := flowerTestPNG(t)
	var calls atomic.Int32
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) { calls.Add(1); return flowerTestResponse(r, png), nil })
	_ = os.MkdirAll(c.dir, 0700)
	corrupt, _ := json.Marshal(flowerSourceIcon{DataURL: "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte("<svg onload='x'/>")), ExpiresAt: time.Now().Add(time.Hour)})
	_ = os.WriteFile(c.path("https://example.com"), corrupt, 0600)
	if icon := c.get(context.Background(), "https://example.com"); icon.DataURL == "" || calls.Load() != 1 {
		t.Fatal("corrupt persisted image must be discarded and refetched")
	}
}

func TestFlowerSourceIconEndpointWithoutAI(t *testing.T) {
	c := newFlowerIconCache(t.TempDir())
	icon := flowerTestPNG(t)
	var calls atomic.Int32
	c.client.Transport = flowerIconTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return flowerTestResponse(r, icon), nil
	})
	server := &Server{sourceIcons: c, resolveSessionMeta: resolveMetaForTest("icons", session.Meta{CanRead: true})}
	server.sourceIconsOnce.Do(func() {})
	for range 2 {
		r := httptest.NewRequest(http.MethodGet, "http://localhost/_redeven_proxy/api/flower/source-icon?origin="+url.QueryEscape("https://example.com"), nil)
		r.Header.Set("Origin", envOriginWithChannel("icons"))
		w := httptest.NewRecorder()
		server.handleAPI(w, r)
		var response struct {
			OK   bool             `json:"ok"`
			Data flowerSourceIcon `json:"data"`
		}
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &response) != nil || !response.OK || response.Data.DataURL == "" {
			t.Fatalf("icon endpoint must work without AI: status=%d body=%s", w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("authenticated icon envelope must not enter a shared HTTP cache")
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("repeated endpoint reads must reuse cached bytes: %d", calls.Load())
	}
}
