package ai

import (
	"encoding/json"
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

	"github.com/floegence/redeven/internal/config"
)

// Search the provider's actual input, including JSON tool-result text. This test
// obtains candidate references through Floret, never through a side-channel bind.
func computerProviderObjects(value any, visit func(map[string]any)) {
	switch value := value.(type) {
	case map[string]any:
		visit(value)
		for _, child := range value {
			computerProviderObjects(child, visit)
		}
	case []any:
		for _, child := range value {
			computerProviderObjects(child, visit)
		}
	case string:
		if strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[") {
			var decoded any
			if json.Unmarshal([]byte(value), &decoded) == nil {
				computerProviderObjects(decoded, visit)
			}
		}
	}
}

func TestComputerAutonomousProductionToolLoop(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires pinned Chromium")
	}
	for _, stale := range []bool{false, true} {
		name := "new_task"
		if stale {
			name = "lost_page"
		}
		t.Run(name, func(t *testing.T) { testComputerAutonomousProductionToolLoop(t, stale) })
	}
}

func testComputerAutonomousProductionToolLoop(t *testing.T, stale bool) {
	var opened atomic.Int32
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/child" {
			opened.Add(1)
			_, _ = io.WriteString(w, `<title>Completed details</title><h1>Verified child page</h1>`)
			return
		}
		_, _ = io.WriteString(w, `<title>Start</title><button onclick="window.open('/child')">Details</button>`)
	}))
	defer site.Close()
	var steps atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if defs, _ := body["tools"].([]any); len(defs) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Browser task")
			return
		}
		var defaultRef, childRef string
		popup, observed := false, false
		computerProviderObjects(body["input"], func(value map[string]any) {
			if ref, _ := value["default_candidate_ref"].(string); ref != "" {
				defaultRef = ref
			}
			if value["url"] == site.URL+"/child" {
				childRef, _ = value["candidate_ref"].(string)
			}
			if value["target_changed"] == true && value["action_executed"] == true {
				popup = true
			}
			raw, _ := json.Marshal(value)
			if strings.Contains(string(raw), "Verified child page") {
				observed = true
			}
		})
		step := steps.Add(1)
		name, args := "", map[string]any{}
		sequence := step
		if stale {
			sequence--
		}
		switch sequence {
		case 0:
			name = "computer_observe"
		case 1:
			name = "computer_targets"
		case 2:
			if defaultRef == "" {
				t.Error("provider received no default page candidate")
			}
			name, args = "computer_select_target", map[string]any{"candidate_ref": defaultRef}
		case 3:
			name, args = "browser_navigate", map[string]any{"url": site.URL}
		case 4:
			name, args = "computer_exec", map[string]any{"description": "Open details once", "code": `await ui.getByRole('button',{name:'Details'}).click(); await ui.getByRole('button',{name:'Details'}).click();`}
		case 5:
			if !popup {
				t.Error("provider did not receive successful popup progress")
			}
			name = "computer_targets"
		case 6:
			if childRef == "" {
				t.Error("provider received no child candidate")
			}
			name, args = "computer_select_target", map[string]any{"candidate_ref": childRef}
		case 7:
			name = "computer_observe"
		default:
			if !observed {
				t.Error("provider did not observe child page")
			}
			writeAskUserIntegrationTextResponse(w, flusher, "done", "Verified the child page.")
			return
		}
		raw, _ := json.Marshal(args)
		id := string(rune('a' + step))
		item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": name, "arguments": string(raw)}
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
		writeAskUserIntegrationCompletedResponse(w, flusher, id)
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
	defer host.Close()
	state := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini", InputModalities: []string{"text", "image"}}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, RunMaxWallTime: 30 * time.Second, RunIdleTimeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Autonomous browser", "openai/gpt-5-mini", "full_access", "")
	if err != nil {
		t.Fatal(err)
	}
	if stale {
		if err := svc.snapshotThreadStore().SetComputerTarget(t.Context(), thread.ThreadID, "retired-page"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "browser-task", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Open the website and verify its details page."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(35 * time.Second)
	for {
		view, err := svc.GetThread(t.Context(), meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if view.WaitingPrompt != nil || view.ApprovalPendingCount != 0 {
			t.Fatalf("ordinary full-access task required user intervention: %+v", view)
		}
		if view.RunStatus == "failed" {
			t.Fatalf("tool loop failed: %s", view.RunError)
		}
		if view.RunStatus == "success" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("browser loop timed out")
		}
		time.Sleep(20 * time.Millisecond)
	}
	wantSteps := int32(8)
	if stale {
		wantSteps++
	}
	if steps.Load() != wantSteps || opened.Load() != 1 {
		t.Fatalf("steps=%d popup navigations=%d", steps.Load(), opened.Load())
	}
}
