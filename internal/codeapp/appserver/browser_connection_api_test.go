package appserver

import (
	"net/http"
	"runtime"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestFlowerBrowserPreparationRejectsMissingAuthorityAndClientPaths(t *testing.T) {
	for _, missing := range []string{"read", "write", "execute", "none"} {
		t.Run(missing, func(t *testing.T) {
			meta := session.Meta{ChannelID: "browser-channel", UserPublicID: "browser-user", EndpointID: "environment", CanRead: missing != "read", CanWrite: missing != "write", CanExecute: missing != "execute"}
			provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
			srv, origin := newAIReadinessTestServer(t, provider, meta)
			computer := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
			srv.browserRuntime = computer
			t.Cleanup(func() { _ = computer.Close() })
			applications := &hostAppsStub{}
			srv.hostApps = applications
			for _, body := range []string{`{"installation_id":"browser-forged"}`, `{"installation_id":"browser-forged","executable":"/bin/sh"}`, `{"installation_id":"browser-forged","profile":"/another/user"}`} {
				response := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/browser/extension/remote", []byte(body))
				switch {
				case missing != "none":
					if response.Code != http.StatusForbidden {
						t.Fatalf("missing %s admitted preparation: %d %s", missing, response.Code, response.Body.String())
					}
				case strings.Contains(body, "executable") || strings.Contains(body, "profile"):
					if response.Code != http.StatusBadRequest {
						t.Fatalf("client path was accepted: %d %s", response.Code, response.Body.String())
					}
				default:
					code := "HOST_APP_UNAVAILABLE"
					if runtime.GOOS == "linux" {
						code = "HOST_APP_NOT_FOUND"
					}
					if !strings.Contains(response.Body.String(), `"error_code":"`+code+`"`) {
						t.Fatalf("unavailable source lost its reason: %d %s", response.Code, response.Body.String())
					}
				}
			}
			if applications.calls != 0 {
				t.Fatal("rejected preparation reached the application lifecycle")
			}
			acquired, _, _ := provider.counts()
			if acquired != 0 {
				t.Fatal("browser preparation acquired an AI provider")
			}
		})
	}
}

func TestRemovedBrowserProductRoutesReturnNotFound(t *testing.T) {
	meta := session.Meta{ChannelID: "browser-channel", UserPublicID: "browser-user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	srv, origin := newAIReadinessTestServer(t, &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}, meta)
	srv.browserRuntime = ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "workspace"}, {http.MethodPost, "views"}, {http.MethodPut, "views/old/preferences"},
		{http.MethodGet, "library/profiles"}, {http.MethodPut, "library/bookmark"},
		{http.MethodGet, "preference"}, {http.MethodPost, "recovery"},
		{http.MethodGet, "views/old/resource"}, {http.MethodGet, "views/old/download"},
		{http.MethodGet, "extension/tabs"}, {http.MethodPost, "connections/cdp"},
	} {
		response := serveAIReadinessTestRequest(srv, origin, route.method, "/_redeven_proxy/api/browser/"+route.path, nil)
		if response.Code != http.StatusNotFound {
			t.Errorf("%s %s returned %d: %s", route.method, route.path, response.Code, response.Body.String())
		}
	}
	response := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/env/browser/?instance=old-browser-view", nil)
	if response.Code != http.StatusNotFound {
		t.Errorf("retired browser document returned %d: %s", response.Code, response.Body.String())
	}
}
