package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// Use a real browser, QuickJS, Flower service and published Floret runtime.
// HTTPS against this local HTTP server fails deterministically without a proxy,
// public website or real model. The script must stop, then the turn must recover.
func TestComputerNavigationFailureContinuesProductionTurn(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires pinned Chromium")
	}
	var forbidden atomic.Int32
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/forbidden" {
			forbidden.Add(1)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<title>Navigation fixture</title><h1>Recovered local page</h1>`)
	}))
	defer site.Close()
	failedURL := strings.Replace(site.URL, "http:", "https:", 1)
	code := fmt.Sprintf(`await browser.navigate(%q); await ui.observe(); await browser.navigate(%q); await browser.navigate(%q);`, site.URL, failedURL, site.URL+"/forbidden")
	var steps atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flush := w.(http.Flusher)
		if defs, _ := body["tools"].([]any); len(defs) == 0 {
			writeAskUserIntegrationTextResponse(w, flush, "title", "Navigation recovery")
			return
		}
		var candidate string
		failed, observed := false, false
		computerProviderObjects(body["input"], func(value map[string]any) {
			if ref, _ := value["default_candidate_ref"].(string); ref != "" {
				candidate = ref
			}
			if value["code"] == "NAVIGATION_FAILED" {
				failed = true
				if value["retryable"] != false {
					t.Error("navigation failure became automatically retryable")
				}
			}
			if value["name"] == "Recovered local page" {
				observed = true
			}
		})
		step := steps.Add(1)
		name, args := "", map[string]any{}
		switch step {
		case 1:
			name = "computer_targets"
		case 2:
			if candidate == "" {
				t.Error("missing browser candidate")
			}
			name, args = "computer_select_target", map[string]any{"candidate_ref": candidate}
		case 3:
			name, args = "computer_exec", map[string]any{"code": code, "description": "Check navigation failure"}
		case 4:
			if !failed {
				t.Error("model did not receive a normal navigation failure")
			}
			name = "computer_observe"
		case 5:
			name, args = "computer_exec", map[string]any{"code": fmt.Sprintf(`await browser.navigate(%q); await ui.observe();`, site.URL), "description": "Recover and inspect the page"}
		default:
			if !observed {
				t.Error("model could not observe the recovered page")
			}
			writeAskUserIntegrationTextResponse(w, flush, "done", "Recovered and inspected the local page.")
			return
		}
		raw, _ := json.Marshal(args)
		id := fmt.Sprintf("navigation-%d", step)
		item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": name, "arguments": string(raw)}
		writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
		writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
		writeAskUserIntegrationCompletedResponse(w, flush, id)
	}))
	defer provider.Close()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", State: "stopped"}); err != nil {
		t.Fatal(err)
	}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	configureBrowserFixture(t, host)
	defer host.Close()
	state := t.TempDir()
	t.Logf("owned runtime pid=%d provider=%s site=%s state=%s", os.Getpid(), provider.URL, site.URL, state)
	options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini", InputModalities: []string{"text", "image"}}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, RunMaxWallTime: 30 * time.Second, RunIdleTimeout: 30 * time.Second}
	svc, err := NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Navigation recovery", "openai/gpt-5-mini", "full_access", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "navigation", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Inspect the local page and recover from the navigation failure."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return view.RunStatus == "success" || view.RunStatus == "failed" || view.WaitingPrompt != nil
	})
	if view.RunStatus != "success" || view.WaitingPrompt != nil || view.ApprovalPendingCount != 0 || steps.Load() != 6 || forbidden.Load() != 0 {
		t.Fatalf("turn stopped or script replayed: status=%s error=%s steps=%d suffix=%d", view.RunStatus, view.RunError, steps.Load(), forbidden.Load())
	}
	check := func() {
		t.Helper()
		history, err := svc.threadRuntime.History(t.Context(), identity.ThreadID(thread.ThreadID), "", 100)
		if err != nil {
			t.Fatal(err)
		}
		failures := 0
		for _, item := range history.Items {
			if item.Activity == nil || item.Activity.ToolID != "navigation-3" {
				continue
			}
			failures++
			activity := publicActivityItem(*item.Activity)
			if activity.Status != observation.ActivityStatusError || activity.Presentation.Label != "Check navigation failure" {
				t.Fatalf("incorrect failure presentation: %+v", activity)
			}
			payload := activity.Presentation.Payload.(fltools.StructuredActivityPayload)
			details, _ := json.Marshal(payload.Rows)
			if !strings.Contains(string(details), "ERR_SSL_PROTOCOL_ERROR") || !strings.Contains(string(details), "navigation_stage: response") || !strings.Contains(string(details), `navigate\nobserve`) {
				t.Fatalf("navigation diagnosis or prefix missing from Activity: %s", details)
			}
			if len(payload.Inputs) != 1 || payload.Inputs[0].Content != code {
				t.Fatal("script intent lost")
			}
		}
		if failures != 1 {
			t.Fatalf("failed invocation count=%d", failures)
		}
		if directory := os.Getenv("REDEVEN_TOOL_ACTIVITY_EVIDENCE_DIR"); directory != "" {
			if err := os.MkdirAll(directory, 0700); err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(history)
			if err := os.WriteFile(filepath.Join(directory, "navigation-history.json"), body, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	check()
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err = NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	check()
	if steps.Load() != 6 || forbidden.Load() != 0 {
		t.Fatal("restart replayed the script")
	}
}
