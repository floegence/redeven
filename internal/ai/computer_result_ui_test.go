package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

// Opt-in browser acceptance uses the real Service, canonical persistence, wire
// projection, production adapter and FlowerSurface, with a deterministic executor.
func TestComputerResultFlowerUI(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_RESULT_UI") != "1" {
		t.Skip("explicit browser qualification only")
	}
	var requests atomic.Int32
	var requireInput atomic.Bool
	var offline atomic.Bool
	var registry *TargetRegistry
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if defs, _ := body["tools"].([]any); len(defs) > 0 {
			requests.Add(1)
			output := false
			observed := false
			answered := false
			for _, raw := range body["input"].([]any) {
				item, _ := raw.(map[string]any)
				if item["type"] == "function_call_output" {
					output = true
					if item["call_id"] == "choose-target" {
						answered = true
					}
					if item["call_id"] == "observe" {
						observed = true
					}
				}
			}
			if !output {
				writeEncodingIntegrationCall(w, "computer_exec", "effect", "{\"code\":\"await ui.click(1,1);\",\"description\":\"Update fixture once\"}")
				return
			}
			if !observed {
				if offline.Load() {
					registry.remove("browser-main")
				}
				writeEncodingIntegrationCall(w, "computer_observe", "observe", "{\"description\":\"Inspect current state before proceeding\"}")
				return
			}
			if requireInput.Load() && !answered {
				args := "{\"reason_code\":\"missing_external_input\",\"required_from_user\":[\"Choose a destination.\"],\"evidence_refs\":[],\"questions\":[{\"id\":\"destination\",\"header\":\"Destination\",\"question\":\"Which destination should I use?\",\"response_mode\":\"select_or_write\",\"is_secret\":false,\"choices_exhaustive\":false,\"choices\":[{\"choice_id\":\"fixture\",\"label\":\"Fixture destination\",\"kind\":\"select\"}]}]}"
				writeEncodingIntegrationCall(w, "ask_user", "choose-target", args)
				return
			}
		}
		message := "Current state checked; completed action was not replayed."
		if offline.Load() {
			message = "Observation unavailable; completed action was not replayed."
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", message)
	}))
	defer provider.Close()
	executor := &encodingComputerExecutor{}
	options := encodingIntegrationOptions(t, provider.URL, executor)
	registry = options.TargetResolver.(*TargetRegistry)
	svc, err := NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	var mu sync.Mutex
	failResponse := false
	mux := http.NewServeMux()
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, req *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fail := func(err error) { http.Error(w, err.Error(), 500) }
		switch req.URL.Query().Get("op") {
		case "start":
			mode := req.URL.Query().Get("mode")
			requireInput.Store(mode == "user" || mode == "stop")
			offline.Store(mode == "offline")
			thread, err := svc.CreateThread(req.Context(), meta, "Computer result recovery", "openai/gpt-5-mini", "", "")
			if err != nil {
				fail(err)
				return
			}
			if err := svc.SetThreadPermissionType(req.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				fail(err)
				return
			}
			_, err = svc.SendUserTurn(req.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "ui-effect-" + thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Update fixture once."}, Options: RunOptions{ToolAllowlist: legacyComputerFixtureTools(), PermissionType: config.AIPermissionFullAccess}})
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"thread_id": thread.ThreadID})
		case "list":
			value, err := svc.ListThreads(req.Context(), meta, 200, "")
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "detail":
			value, err := svc.GetFlowerThreadDetail(req.Context(), meta, req.URL.Query().Get("id"))
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "fail-response":
			failResponse = true
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		case "respond":
			if failResponse {
				failResponse = false
				http.Error(w, "Injected pre-admission submission failure", http.StatusServiceUnavailable)
				return
			}
			var input struct {
				ThreadID string
				Response RequestUserInputResponse
			}
			var raw map[string]json.RawMessage
			if err := json.NewDecoder(req.Body).Decode(&raw); err != nil {
				fail(err)
				return
			}
			_ = json.Unmarshal(raw["thread_id"], &input.ThreadID)
			_ = json.Unmarshal(raw["prompt_id"], &input.Response.PromptID)
			_ = json.Unmarshal(raw["answers"], &input.Response.Answers)
			value, err := svc.SubmitRequestUserInputResponse(req.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: input.ThreadID, Response: input.Response})
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"thread_id": input.ThreadID, "consumed_prompt_id": value.ConsumedWaitingPromptID, "current": value.Current})
		case "stop":
			value, err := svc.StopThread(req.Context(), meta, req.URL.Query().Get("id"))
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "restart":
			if err := svc.Close(); err != nil {
				fail(err)
				return
			}
			svc, err = NewService(options)
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		case "offline":
			options.TargetResolver.(*TargetRegistry).remove("browser-main")
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		case "counts":
			_ = json.NewEncoder(w).Encode(map[string]int32{"effects": executor.effects.Load(), "observations": executor.observations.Load(), "requests": requests.Load()})
		default:
			http.NotFound(w, req)
		}
	})
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dist := t.TempDir()
	mux.Handle("/", http.FileServer(http.Dir(dist)))
	server := httptest.NewServer(mux)
	defer server.Close()
	commit, _ := exec.Command("git", "rev-parse", "HEAD").Output()
	t.Logf("owned UI runtime commit=%s pid=%d url=%s state=%s", strings.TrimSpace(string(commit)), os.Getpid(), server.URL, options.StateDir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "scripts/check_computer_result_ui.mjs"), "--url="+server.URL, "--dist="+dist)
	command.Dir = root
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
}
