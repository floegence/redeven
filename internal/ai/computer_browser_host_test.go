package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type browserHostTestTransport struct{ target *url.URL }

func (transport browserHostTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.URL.Scheme, request.URL.Host = transport.target.Scheme, transport.target.Host
	return http.DefaultTransport.RoundTrip(request)
}

func browserHostFixture(t *testing.T, handler http.HandlerFunc) (*browserSourceHost, context.CancelFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	address, _ := url.Parse(server.URL)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	input, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	close(done)
	host := &browserSourceHost{ctx: ctx, cancel: cancel, stdin: input, done: done, directory: t.TempDir(), client: &http.Client{Transport: browserHostTestTransport{target: address}}}
	t.Cleanup(func() { _ = host.Close() })
	return host, cancel
}

func TestBrowserHostCancellationDoesNotSerializeHealthyTargets(t *testing.T) {
	entered, ended := make(chan struct{}), make(chan struct{})
	host, stop := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID, Method string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if request.Method == "blocked" {
			close(entered)
			<-r.Context().Done()
			close(ended)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": true})
	})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- host.call(ctx, "blocked", nil, nil) }()
	<-entered
	var result bool
	if err := host.call(t.Context(), "healthy", nil, &result); err != nil || !result {
		t.Fatalf("healthy target waited behind another target: %v %v", result, err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("request cancellation: %v", err)
	}
	<-ended
	if err := host.call(t.Context(), "healthy", nil, &result); err != nil {
		t.Fatalf("peer cancellation stopped the host: %v", err)
	}
	stop()
	if err := host.call(t.Context(), "healthy", nil, &result); !errors.Is(err, errBrowserHostFailed) {
		t.Fatalf("closed host accepted a command: %v", err)
	}
}

func TestBrowserHostRejectsMissingResultsAndWrongResponseIdentity(t *testing.T) {
	for _, response := range []string{`{"id":"another","result":true}`, `{"id":"1"}`} {
		t.Run(response, func(t *testing.T) {
			host, _ := browserHostFixture(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(response)) })
			var accepted bool
			if err := host.call(t.Context(), "view.acquire", nil, &accepted); err == nil || accepted {
				t.Fatal("invalid host response was accepted as a control result")
			}
		})
	}
}

func TestBrowserHostPackagedIPCOutlivesStartingRequest(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 with published browser dependencies installed")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenBrowserHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	host, err := startBrowserSourceHost(ctx, node, helper, browserHostHandlers{})
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Close() })
	err = host.call(t.Context(), "source.ready", map[string]any{"target": "ungranted"}, nil)
	if err == nil || !strings.Contains(err.Error(), "helper_rejected") {
		t.Fatalf("host lifetime or source grant failed: %v", err)
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(host.directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("private host socket directory survived shutdown: %v", err)
	}
}

func TestBrowserHostRejectsIncompatibleAndFailedHandshakeWithoutSecrets(t *testing.T) {
	for _, handshake := range []string{
		`{"type":"ready","protocol_version":6}`,
		`{"type":"unexpected","protocol_version":1}`,
		`{"type":"ready","protocol_version":1,"error":"Authorization: private-secret"}`,
		`{"error":"data:image/png;base64,private-secret"}`,
	} {
		t.Run(handshake, func(t *testing.T) {
			helper := filepath.Join(t.TempDir(), "host.sh")
			if err := os.WriteFile(helper, []byte("printf '%s\\n' '"+handshake+"'\nwhile IFS= read -r line; do :; done\n"), 0600); err != nil {
				t.Fatal(err)
			}
			host, err := startBrowserSourceHost(t.Context(), "/bin/sh", helper, browserHostHandlers{})
			if host != nil {
				_ = host.Close()
				t.Fatal("incompatible source host was admitted")
			}
			var startup *TargetStartupError
			if !errors.As(err, &startup) || startup.Reason != "browser_host_handshake_invalid" || strings.Contains(err.Error(), "private-secret") {
				t.Fatalf("unsafe startup failure: %v", err)
			}
		})
	}
}

func TestBrowserHostSourceRejectionPreservesConfirmedNonExecution(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenBrowserHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	host, err := startBrowserSourceHost(ctx, node, helper, browserHostHandlers{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Close() })
	executor := &extensionTargetExecutor{sourceHost: host, targetID: "missing-source"}
	result, err := executor.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "missing-source", ToolName: "browser.navigate"})
	var failure *targetToolPolicyError
	if !errors.As(err, &failure) || failure.code != "target_connection_required" {
		t.Fatalf("pre-dispatch rejection became unknown: %+v %v", result, err)
	}
	if result.Result.(map[string]any)["action_executed"] != false {
		t.Fatalf("missing non-execution fact: %+v", result)
	}
	var response playwrightTargetResponse
	err = host.call(ctx, "source.tool", map[string]any{"target": "missing-source", "request": playwrightTargetRequest{ID: "request", TargetID: "missing-source", ToolName: "browser.navigate"}}, &response)
	if err != nil || response.ID != "request" || response.TargetID != "missing-source" || response.Error != "TARGET_CONNECTION_REQUIRED" || response.Result["action_executed"] != false {
		t.Fatalf("managed wire shape lost source rejection: %+v %v", response, err)
	}
}

func TestBrowserHostFailureReasonsNeverInventNonExecution(t *testing.T) {
	for _, variant := range []string{"helper_rejected", "invalid_response", "response_unavailable"} {
		t.Run(variant, func(t *testing.T) {
			host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
				var request struct{ ID string }
				_ = json.NewDecoder(r.Body).Decode(&request)
				switch variant {
				case "helper_rejected":
					_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "error": "private arbitrary error"})
				case "invalid_response":
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "wrong", "result": true})
				default:
					w.WriteHeader(http.StatusServiceUnavailable)
				}
			})
			executor := &extensionTargetExecutor{sourceHost: host, targetID: "target"}
			result, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "target", ToolName: "browser.navigate"})
			if !errors.Is(err, errComputerEffectUnknown) {
				t.Fatalf("carrier failure invented a result: %+v %v", result, err)
			}
			payload := result.Result.(map[string]any)
			if payload["reason"] != variant || payload["action_executed"] != nil {
				t.Fatalf("lost bounded facts: %+v", payload)
			}
			rows, _ := json.Marshal(computerActivityResultRows("computer.exec", payload))
			if !strings.Contains(string(rows), variant) || strings.Contains(string(rows), "private") {
				t.Fatalf("unsafe or missing visible diagnostic: %s", rows)
			}
		})
	}
}

func TestBrowserHostRejectionPreservesScriptPrefix(t *testing.T) {
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID string }
		_ = json.NewDecoder(r.Body).Decode(&request)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": map[string]any{"error": "TARGET_CONNECTION_REQUIRED", "result": map[string]any{"action_executed": false}}})
	})
	executor := &extensionTargetExecutor{sourceHost: host, targetID: "test-target"}
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(ctx context.Context, inner TargetToolCall) (TargetToolResult, error) {
		calls++
		if calls == 1 {
			return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed")}}, nil
		}
		return executor.ExecuteTargetTool(ctx, inner)
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({emit:false}); log('confirmed'); await ui.click(1,2); await ui.key('Enter');")
	payload := result.Result.(map[string]any)
	if err == nil || errors.Is(err, errComputerEffectUnknown) || calls != 2 || payload["completed"] != false || payload["effect_outcome_unknown"] != false || payload["action_executed"] != false || len(extractStringSlice(payload["completed_actions"])) != 1 {
		t.Fatalf("rejection lost facts or continued: calls=%d %+v %v", calls, payload, err)
	}
	body, _ := json.Marshal(payload)
	if !strings.Contains(string(body), "confirmed") {
		t.Fatalf("lost output: %s", body)
	}
}
