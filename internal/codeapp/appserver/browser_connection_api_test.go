package appserver

import (
	"github.com/floegence/redeven/internal/config"
	"net/http"
	"path/filepath"
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

func TestFlowerBrowserProfileLifecycleValidatesAuthorityAndInput(t *testing.T) {
	root := t.TempDir()
	computer := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), map[string]ai.TargetToolExecutor{"browser-main": ai.NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(root, "helper.mjs"), filepath.Join(root, "profiles"))}, root)
	t.Cleanup(func() { _ = computer.Close() })
	service, err := ai.NewService(ai.Options{StateDir: root, AgentHomeDir: root, Shell: "bash", TargetToolExecutor: computer,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	meta := session.Meta{ChannelID: "ch_ai_readiness", EndpointID: "env", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), meta)
	route := "/_redeven_proxy/api/ai/computer/managed/lifecycle"
	for _, body := range []string{
		"{", "{}", `{"profile_id":"../other","action":"stop"}`, `{"profile_id":"browser-main","action":"restart"}`,
		`{"profile_id":"browser-main","action":"stop","executable":"/bin/sh"}`, `{"profile_id":"browser-main","action":"stop"} {}`,
	} {
		response := serveAIReadinessTestRequest(server, origin, http.MethodPost, route, []byte(body))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("accepted invalid lifecycle request: %d %s", response.Code, response.Body.String())
		}
	}
	body := []byte(`{"profile_id":"browser-main","action":"stop"}`)
	response := serveAIReadinessTestRequest(server, origin, http.MethodPost, route, body)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"state":"stopped"`) {
		t.Fatalf("idempotent stop: %d %s", response.Code, response.Body.String())
	}
	meta.CanWrite = false
	readonly, readOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), meta)
	response = serveAIReadinessTestRequest(readonly, readOrigin, http.MethodPost, route, body)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only lifecycle: %d %s", response.Code, response.Body.String())
	}
}
