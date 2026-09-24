package appserver

import (
	"net/http"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserViewAPIRejectsForgedGrantsWithoutAcquiringAI(t *testing.T) {
	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
	meta := session.Meta{ChannelID: "browser-channel", UserPublicID: "browser-user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	srv, origin := newAIReadinessTestServer(t, provider, meta)
	srv.browserRuntime = ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = srv.browserRuntime.Close() })
	for _, check := range []struct {
		method, path, body string
		status             int
	}{
		{http.MethodPost, "", `{"targets":["forged-target"]}`, http.StatusBadRequest},
		{http.MethodPost, "", `{"targets":["forged-target"],"owner":"another-user"}`, http.StatusBadRequest},
		{http.MethodPost, "/forged-view/control", `{"target":"forged-target","takeover":true,"private":true}`, http.StatusConflict},
		{http.MethodDelete, "/forged-view/control", `{"token":"old-token"}`, http.StatusBadRequest},
		{http.MethodDelete, "/forged-view", "", http.StatusBadRequest},
		{http.MethodGet, "/forged-view/resource?target=page&id=opaque", "", http.StatusNotFound},
		{http.MethodGet, "/forged-view/download?target=page&id=opaque", "", http.StatusNotFound},
		{http.MethodPost, "/forged-view/upload?chooser=chooser&name=file&size=3&token=old", "abc", http.StatusNotFound},
		{http.MethodPost, "/forged-view/upload?size=-1", "", http.StatusNotFound},
		{http.MethodGet, "/forged-view/resource?target=page&target=another&id=opaque", "", http.StatusNotFound},
	} {
		response := serveAIReadinessTestRequest(srv, origin, check.method, "/_redeven_proxy/api/browser/views"+check.path, []byte(check.body))
		if response.Code != check.status {
			t.Fatalf("%s %s: %d %s", check.method, check.path, response.Code, response.Body.String())
		}
	}
	for _, path := range []string{"?browser_target=page&browser_resource=opaque", "?instance=short", "?instance=1234567890123456&instance=1234567890123456", "forged-view/", "forged-view/?browser_target=page&browser_resource=opaque", "forged-view/../another/"} {
		response := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/env/browser/"+path, nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("browser document %s: %d %s", path, response.Code, response.Body.String())
		}
	}
	for _, request := range []struct {
		method, path, body string
		status             int
	}{
		{http.MethodGet, "environment", "", http.StatusOK},
		{http.MethodGet, "profiles", "", http.StatusBadRequest},
		{http.MethodGet, "installation", "", http.StatusBadRequest},
		{http.MethodPost, "workspace", `{"managed_profile_id":"unavailable"}`, http.StatusBadRequest},
		{http.MethodPost, "workspace", `{"managed_profile_id":"browser-main","owner":"another"}`, http.StatusBadRequest},
	} {
		response := serveAIReadinessTestRequest(srv, origin, request.method, "/_redeven_proxy/api/browser/"+request.path, []byte(request.body))
		if response.Code != request.status {
			t.Fatalf("browser %s: %d %s", request.path, response.Code, response.Body.String())
		}
	}
	acquired, _, _ := provider.counts()
	if acquired != 0 {
		t.Fatal("browser views acquired the model service")
	}
}
