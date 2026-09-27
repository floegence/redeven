package appserver

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserWorkspaceFailureActionsAndRecoveryAuthorization(t *testing.T) {
	for _, writable := range []bool{true, false} {
		meta := session.Meta{ChannelID: "browser-channel", UserPublicID: "browser-user", EndpointID: "environment", CanRead: true, CanWrite: writable, CanExecute: writable}
		provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
		srv, origin := newAIReadinessTestServer(t, provider, meta)
		registry := ai.NewTargetRegistry()
		if err := registry.Register(ai.TargetDescriptor{ID: "browser-main", Kind: "browser.managed"}); err != nil {
			t.Fatal(err)
		}
		directory := t.TempDir()
		runtime := ai.NewComputerUseRuntime(registry, map[string]ai.TargetToolExecutor{"browser-main": ai.NewPlaywrightTargetExecutor("/fixture/node", filepath.Join(directory, "helper.mjs"), directory)}, directory)
		runtime.ConfigureManagedBrowser(directory)
		srv.browserRuntime = runtime
		t.Cleanup(func() { _ = runtime.Close() })
		for _, check := range []struct{ path, body, code string }{
			{"workspace", `{"managed_profile_id":"browser-main"}`, "BROWSER_INSTALL_REQUIRED"},
			{"recovery", `{"expected_generation":"retired"}`, "BROWSER_GENERATION_CHANGED"},
		} {
			response := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/browser/"+check.path, []byte(check.body))
			if !writable {
				if response.Code != http.StatusForbidden {
					t.Fatalf("read-only recovery: %d", response.Code)
				}
				continue
			}
			var result struct {
				Code string `json:"error_code"`
			}
			if json.Unmarshal(response.Body.Bytes(), &result) != nil || response.Code != http.StatusConflict || result.Code != check.code {
				t.Fatalf("%s: %d %s", check.path, response.Code, response.Body.String())
			}
		}
		if writable {
			if _, err := runtime.SetComputerBrowserEnabled(t.Context(), &meta, false); err != nil {
				t.Fatal(err)
			}
			response := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/browser/workspace", []byte(`{"managed_profile_id":"browser-main"}`))
			var result struct {
				Code string `json:"error_code"`
			}
			if json.Unmarshal(response.Body.Bytes(), &result) != nil || result.Code != "BROWSER_DISABLED" {
				t.Fatalf("disabled: %s", response.Body.String())
			}
		}

		for _, check := range []struct {
			method, body string
			status       int
		}{
			{http.MethodGet, "", http.StatusOK},
			{http.MethodPost, `{"view_id":"missing"}`, http.StatusConflict},
			{http.MethodPost, `{"view_id":"missing","profile_id":"browser-main"}`, http.StatusBadRequest},
		} {
			response := serveAIReadinessTestRequest(srv, origin, check.method, "/_redeven_proxy/api/browser/preference", []byte(check.body))
			want := check.status
			if !writable {
				want = http.StatusForbidden
			}
			if response.Code != want {
				t.Fatalf("preference %s: %d %s", check.method, response.Code, response.Body.String())
			}
			if writable && check.method == http.MethodGet {
				var value struct {
					Data struct {
						Preference any `json:"preference"`
					} `json:"data"`
				}
				if json.Unmarshal(response.Body.Bytes(), &value) != nil || value.Data.Preference != nil {
					t.Fatal("new owner inherited a source preference")
				}
			}
		}
		acquired, _, _ := provider.counts()
		if acquired != 0 {
			t.Fatal("browser recovery acquired AI service")
		}
	}
}

func TestRemoteBrowserPreparationRejectsMissingAuthorityAndClientPaths(t *testing.T) {
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
