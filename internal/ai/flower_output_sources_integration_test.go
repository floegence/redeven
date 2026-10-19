package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// The suffix is a constructed boundary case. No historical SSE is reconstructed.
// Every observed runtime publication is checked, and sanitized stable checkpoints
// feed the same Flower mapper and browser used by the product.
func TestFlowerDeepSeekOutputSourceFixtures(t *testing.T) {
	labels := []string{"Correction one", "Correction two", "Inspect first", "Inspect second"}
	started := make(chan int, 4)
	release := make(chan struct{}, 4)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			http.Error(w, "bad fixture request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if len(extractOpenAIToolNames(request)) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Source order")
			return
		}
		step := int(calls.Add(1))
		if step > 4 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "final", "Inspection complete.")
			return
		}
		if step > 1 && step <= 3 && !requestContainsPairedToolHistory(request, "terminal_exec") {
			t.Error("correction lost its canonical call/result pair")
		}
		reasonID, callID := fmt.Sprintf("reason-%d", step), fmt.Sprintf("call-%d", step)
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.reasoning_text.delta", "item_id": reasonID, "output_index": 0, "content_index": 0, "delta": labels[step-1]})
		args := map[string]any{"description": labels[step-1], "command": "printf fixture-ok", "yield_ms": 10000}
		if step <= 2 {
			delete(args, "yield_ms")
			args["yield_time_ms"] = 10000
		}
		encoded, _ := json.Marshal(args)
		call := map[string]any{"type": "function_call", "id": "item-" + callID, "call_id": callID, "name": "terminal_exec", "arguments": string(encoded)}
		for _, kind := range []string{"response.output_item.added", "response.output_item.done"} {
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": kind, "output_index": 1, "item": call})
		}
		started <- step
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		reasoning := map[string]any{"type": "reasoning", "id": reasonID, "content": []any{map[string]any{"type": "reasoning_text", "text": labels[step-1] + " reasoning."}}}
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", step), "status": "completed", "output": []any{reasoning, call}}})
	}))
	defer func() { close(release); server.Close() }()
	stateDir := t.TempDir()
	open := func() *Service {
		svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
			Config:                       &config.AIConfig{PermissionType: config.AIPermissionFullAccess, CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}},
			ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 15 * time.Second, FirstOutputTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Source order", "deepseek/deepseek-v4-flash", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	subscription, err := svc.threadRuntime.Subscribe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	observeCtx, stopObserve := context.WithCancel(t.Context())
	defer stopObserve()
	observed := make(chan []flruntime.ThreadView, 1)
	go func() {
		var views []flruntime.ThreadView
		for {
			v, err := subscription.Next(observeCtx)
			if err != nil {
				observed <- views
				return
			}
			if v.ThreadID.String() == thread.ThreadID {
				views = append(views, v)
			}
		}
	}()
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "source-order", Input: RunInput{Text: "Inspect the fixture."}}); err != nil {
		t.Fatal(err)
	}
	var checkpoints []flruntime.ThreadView
	for step := 1; step <= 4; step++ {
		select {
		case got := <-started:
			if got != step {
				t.Fatalf("step=%d want %d", got, step)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("provider did not advance")
		}
		deadline := time.Now().Add(5 * time.Second)
		for {
			detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if len(detail.Current.Items) > 0 && detail.Current.Items[len(detail.Current.Items)-1].Text == labels[step-1] && !detail.Current.Items[len(detail.Current.Items)-1].Live {
				checkpoints = append(checkpoints, detail.Current)
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("streamed reasoning missing: %+v", detail.Current)
			}
			time.Sleep(time.Millisecond)
		}
		release <- struct{}{}
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	final, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	checkpoints = append(checkpoints, final.Current)
	stopObserve()
	views := <-observed
	views = append(views, checkpoints...)
	sources := map[string]string{}
	for _, view := range views {
		lastRank := -1
		seen := map[string]bool{}
		for i, item := range view.Items {
			if item.Ordinal != uint64(i+1) || seen[item.ID] {
				t.Fatalf("invalid published identity/order: %+v", view.Items)
			}
			seen[item.ID] = true
			rank := -1
			key := ""
			if item.Kind == flruntime.ThreadItemThinking {
				for n, label := range labels {
					if strings.HasPrefix(item.Text, label) {
						rank = n * 2
						key = label
						break
					}
				}
			}
			if item.Activity != nil {
				key = item.Activity.ToolID
				switch key {
				case "call-3":
					rank = 5
				case "call-4":
					rank = 7
				default:
					t.Fatalf("invalid tool became actionable: %+v", item)
				}
			}
			if item.Kind == flruntime.ThreadItemAssistant {
				rank = 8
				key = "answer"
			}
			if key != "" {
				if rank <= lastRank {
					t.Fatalf("reasoning moved behind tools: %+v", view.Items)
				}
				lastRank = rank
				if previous := sources[key]; previous != "" && previous != item.ID {
					t.Fatalf("source drift: %s", key)
				}
				sources[key] = item.ID
			}
			if strings.Contains(item.Text, "unexpected property") || strings.Contains(item.Text, "tool_validation_error") {
				t.Fatal("technical validation feedback leaked")
			}
		}
	}
	if len(final.Current.Items) != 8 || calls.Load() != 5 || len(sources) != 7 {
		t.Fatalf("final coverage: rows=%d requests=%d sources=%d", len(final.Current.Items), calls.Load(), len(sources))
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := open()
	defer reopened.Close()
	restored, err := reopened.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(publicFloretThreadView(final.Current).Items)
	after, _ := json.Marshal(publicFloretThreadView(restored.Current).Items)
	if string(before) != string(after) {
		t.Fatal("reopen changed public canonical source IDs, order or content")
	}

	// Normalize only fixture identities and runtime sampling. Text/order originate
	// from the actual HTTP provider -> DTO -> published runtime -> public mapping.
	ids := map[string]string{}
	var fixtures []flruntime.ThreadView
	for i, view := range checkpoints {
		normalized := flruntime.ThreadView{ThreadID: "source-thread", TurnID: "source-turn", RunID: "source-run", ViewVersion: uint64(i + 1), Activity: view.Activity, LastOutcome: view.LastOutcome}
		if view.RunProgress != nil {
			normalized.RunProgress = &flruntime.ThreadRunProgress{Phase: view.RunProgress.Phase}
		}
		for _, item := range view.Items {
			if ids[item.ID] == "" {
				ids[item.ID] = fmt.Sprintf("source-%d", len(ids)+1)
			}
			item.ID = ids[item.ID]
			item.TurnID = identity.TurnID("source-turn")
			item.RunID = identity.RunID("source-run")
			item.CreatedAt = time.Time{}
			if item.CanonicalOrdinal != 0 || item.Kind == flruntime.ThreadItemUser {
				item.CanonicalOrdinal = item.Ordinal
			}
			if item.Activity != nil {
				copy := *item.Activity
				copy.ItemID = item.ID
				copy.Metadata = nil
				copy.StartedAtUnixMS = 1
				copy.EndedAtUnixMS = 2
				if copy.Presentation != nil {
					presentation := *copy.Presentation
					presentation.Chips = nil
					payload, ok := presentation.Payload.(fltools.TerminalActivityPayload)
					if !ok {
						t.Fatalf("unexpected fixture activity payload: %T", presentation.Payload)
					}
					payload.ProcessID = "fixture-process"
					payload.DurationMS = 1
					presentation.Payload = payload
					copy.Presentation = &presentation
				}
				item.Activity = &copy
			}
			normalized.Items = append(normalized.Items, item)
		}
		encoded, err := flowerCurrentJSONAt(normalized, time.Time{})
		if err != nil {
			t.Fatal(err)
		}
		var public flruntime.ThreadView
		if err := json.Unmarshal(encoded, &public); err != nil {
			t.Fatal(err)
		}
		fixtures = append(fixtures, public)
	}
	raw, err := json.MarshalIndent(fixtures, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	fixturePath := filepath.Join("..", "flower_ui", "src", "testdata", "outputSourceCurrentViews.json")
	if os.Getenv("UPDATE_FLOWER_OUTPUT_FIXTURES") == "1" {
		if err := os.WriteFile(fixturePath, raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(expected) != string(raw) {
		t.Fatal("output source fixture changed; review and regenerate with UPDATE_FLOWER_OUTPUT_FIXTURES=1")
	}
	t.Logf("verified %d intermediate publications and %d browser checkpoints", len(views), len(fixtures))
}
