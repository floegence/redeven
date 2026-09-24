package appserver

import (
	"encoding/json"
	"net/http"
	"path/filepath"
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
		acquired, _, _ := provider.counts()
		if acquired != 0 {
			t.Fatal("browser recovery acquired AI service")
		}
	}
}
