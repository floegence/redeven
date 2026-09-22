package appserver

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserLibraryBookmarkHistoryAndZoomWithoutProvider(t *testing.T) {
	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
	meta := session.Meta{UserPublicID: "browser-user", EndpointID: "browser-environment", CanRead: true, CanWrite: true, CanExecute: true}
	srv, origin := newAIReadinessTestServer(t, provider, meta)
	runtime := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
	runtime.ConfigureManagedBrowser(t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	srv.browserRuntime = runtime
	ctx := context.Background()
	if err := runtime.SaveBrowserLibraryProfile(ctx, &meta, browserstore.Profile{ID: "daily", Name: "Daily", Kind: browserstore.Managed}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RecordBrowserVisit(ctx, &meta, "daily", browserstore.Entry{URL: "https://example.test/page", Title: "Visited page"}); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		method, path, body, includes, excludes string
		status                                 int
	}{
		{http.MethodPut, "tabs", `{"profile_id":"daily","tabs":[{"url":"https://forged.test/","title":"Forged restore","selected":true}]}`, "", "", http.StatusNotFound},
		{http.MethodPut, "bookmark", `{"profile_id":"daily","url":"https://example.test/page","title":"Saved page"}`, "", "", http.StatusOK},
		{http.MethodGet, "bookmarks?profile_id=daily", "", "Saved page", "", http.StatusOK},
		{http.MethodPut, "bookmark", `{"profile_id":"daily","url":"https://example.test/page","title":"Renamed page"}`, "", "", http.StatusOK},
		{http.MethodGet, "bookmarks?profile_id=daily", "", "Renamed page", "Saved page", http.StatusOK},
		{http.MethodPut, "bookmark", `{"profile_id":"daily","url":"https://example.test/page","title":"Forged","owner_id":"someone-else"}`, "", "", http.StatusBadRequest},
		{http.MethodPut, "zoom", `{"profile_id":"daily","origin":"https://EXAMPLE.test:443","zoom":0.25}`, "", "", http.StatusOK},
		{http.MethodGet, "zoom?profile_id=daily&origin=https%3A%2F%2Fexample.test", "", `"zoom":0.25`, "", http.StatusOK},
		{http.MethodPut, "zoom", `{"profile_id":"daily","origin":"ftp://example.test","zoom":1}`, "", "", http.StatusBadRequest},
		{http.MethodGet, "history?profile_id=daily&limit=20", "", "Visited page", "", http.StatusOK},
		{http.MethodDelete, "history?profile_id=daily", "", "", "", http.StatusOK},
		{http.MethodGet, "history?profile_id=daily&limit=20", "", `"data":[]`, "Visited page", http.StatusOK},
		{http.MethodGet, "bookmarks?profile_id=daily", "", "Renamed page", "", http.StatusOK},
		{http.MethodDelete, "bookmark", `{"profile_id":"daily","url":"https://example.test/page"}`, "", "", http.StatusOK},
		{http.MethodGet, "bookmarks?profile_id=daily", "", `"data":[]`, "Renamed page", http.StatusOK},
	} {
		response := serveAIReadinessTestRequest(srv, origin, check.method, "/_redeven_proxy/api/browser/library/"+check.path, []byte(check.body))
		body := response.Body.String()
		if response.Code != check.status || (check.includes != "" && !strings.Contains(body, check.includes)) || (check.excludes != "" && strings.Contains(body, check.excludes)) {
			t.Fatalf("%s %s: status=%d body=%s", check.method, check.path, response.Code, body)
		}
	}
	acquired, _, _ := provider.counts()
	if acquired != 0 {
		t.Fatalf("browser library acquired AI service %d times", acquired)
	}
}

func TestBrowserLibraryDoesNotAcquireAIService(t *testing.T) {
	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
	meta := session.Meta{UserPublicID: "browser-user", EndpointID: "browser-environment", CanRead: true, CanWrite: true, CanExecute: true}
	srv, origin := newAIReadinessTestServer(t, provider, meta)
	runtime := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
	runtime.ConfigureManagedBrowser(t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	srv.browserRuntime = runtime

	response := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/browser/library/profile", []byte(`{"id":"daily","name":"Daily browsing","kind":"managed"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("create browser profile without AI: status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/browser/library/profiles", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "Daily browsing") {
		t.Fatalf("read browser profile without AI: status=%d body=%s", response.Code, response.Body.String())
	}
	acquired, _, _ := provider.counts()
	if acquired != 0 {
		t.Fatalf("browser library acquired AI service %d times", acquired)
	}

	for _, changed := range []session.Meta{
		{UserPublicID: "other-user", EndpointID: meta.EndpointID, CanRead: true, CanWrite: true, CanExecute: true},
		{UserPublicID: meta.UserPublicID, EndpointID: "other-environment", CanRead: true, CanWrite: true, CanExecute: true},
	} {
		other, otherOrigin := newAIReadinessTestServer(t, provider, changed)
		other.browserRuntime = runtime
		response := serveAIReadinessTestRequest(other, otherOrigin, http.MethodGet, "/_redeven_proxy/api/browser/library/profiles", nil)
		if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "Daily browsing") {
			t.Fatalf("browser profiles crossed owner boundary: status=%d body=%s", response.Code, response.Body.String())
		}
	}

	for _, body := range []string{
		`{"id":"injected","name":"Injected owner","kind":"managed","owner_id":"other-user"}`,
		`{"id":"injected","name":"Trailing request","kind":"managed"} {}`,
	} {
		response := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/browser/library/profile", []byte(body))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid browser profile accepted: status=%d body=%s", response.Code, response.Body.String())
		}
	}
}

func TestBrowserLibraryRejectsInsufficientPermissionsBeforeAIReadiness(t *testing.T) {
	for _, meta := range []session.Meta{
		{CanRead: true},
		{CanRead: true, CanWrite: true},
		{CanRead: true, CanExecute: true},
	} {
		provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
		srv, origin := newAIReadinessTestServer(t, provider, meta)
		response := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/browser/library/profiles", nil)
		if response.Code != http.StatusForbidden {
			t.Fatalf("insufficient browser permissions: status=%d body=%s", response.Code, response.Body.String())
		}
		acquired, _, _ := provider.counts()
		if acquired != 0 {
			t.Fatalf("forbidden browser request acquired AI service %d times", acquired)
		}
	}
}
