package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

// Exercise provider dispatch, canonical tool execution, durable canvas writes,
// and unknown-effect settlement together without touching a user's services.
func TestTessivenCanonicalRuntimeSaveAndUnknownEffect(t *testing.T) {
	for _, scenario := range []string{"save", "populate_selected_canvas", "unknown_action"} {
		t.Run(scenario, func(t *testing.T) {
			action := scenario == "unknown_action"
			state := t.TempDir()
			library, err := tessiven.Open(filepath.Join(state, "canvases.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer library.Close()
			document := "apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Commerce}\nnodes: [{id: host, name: Fixture, runtimeRef: 'ssh:fixture'}]\nservices: [{id: api, name: Orders, kind: api}]\ninstances: [{id: orders, nodeRef: host, serviceRef: api, role: standalone, binding: {owner: managed_service, resourceId: fixture}}]\n"
			var effects, providerCalls atomic.Int32
			resources := &tessiven.ResourceBackend{Library: library, Remote: func(_ context.Context, meta *session.Meta, req tessiven.ResourceRequest) (tessiven.ResourceResult, error) {
				if req.RuntimeRef != "ssh:fixture" || req.Binding.ResourceID != "fixture" || !meta.CanExecute {
					t.Error("resource authority lost")
				}
				effects.Add(1)
				return tessiven.ResourceResult{}, tessiven.ErrOutcomeUnknown
			}}
			name := "tessiven_save"
			args := map[string]any{"request_id": "provider-save", "expected_version": 0, "document_yaml": document, "summary": "Observed fixture"}
			var selectedID string
			if scenario == "populate_selected_canvas" {
				empty, err := library.Create(t.Context(), "ui-create", "Untitled canvas")
				if err != nil {
					t.Fatal(err)
				}
				selectedID = empty.Canvas.ID
				args["canvas_id"] = selectedID
				args["expected_version"] = 1
			}
			if action {
				saved, err := library.Save(t.Context(), tessiven.SaveRequest{RequestID: "seed", DocumentYAML: document}, "manual")
				if err != nil {
					t.Fatal(err)
				}
				name = "tessiven_action"
				args = map[string]any{"canvas_id": saved.Canvas.ID, "version_id": 1, "instance_id": "orders", "runtime_ref": "ssh:fixture", "action": "start", "request_id": "provider-start", "identity": "fixture:1"}
			}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil {
					t.Error("invalid provider body")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flush := w.(http.Flusher)
				available := false
				for _, raw := range toAnySlice(body["tools"]) {
					tool, _ := raw.(map[string]any)
					if anyToString(tool["name"]) == name {
						available = true
					}
				}
				if !available {
					writeAskUserIntegrationTextResponse(w, flush, "title", "Commerce canvas")
					return
				}
				if providerCalls.Add(1) == 1 {
					raw, _ := json.Marshal(args)
					item := map[string]any{"type": "function_call", "id": "canvas-tool", "call_id": "canvas-tool", "name": name, "arguments": string(raw)}
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeAskUserIntegrationCompletedResponse(w, flush, "canvas-tool")
					return
				}
				outputs := collectOpenAIFunctionOutputs(body["input"])
				if len(outputs) != 1 || !strings.Contains(outputs[0].Output, "surface=tessiven") {
					t.Errorf("saved canvas link missing: %+v", outputs)
				}
				writeAskUserIntegrationTextResponse(w, flush, "done", "The canvas has been saved.")
			}))
			defer provider.Close()
			options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Tessiven: library, TessivenResources: resources, Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, RunMaxWallTime: 8 * time.Second, RunIdleTimeout: 8 * time.Second}
			svc, err := NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Commerce", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err = svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			terminal, runErr := runTypedTurnForTest(t, t.Context(), svc, meta, "tessiven-fixture", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Map the fixture and save the canvas; use the authorized instance for a service action when requested."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
			if providerCalls.Load() == 0 {
				t.Fatal("Tessiven tool was not exposed to the provider")
			}
			if action {
				if effects.Load() != 1 || runErr == nil || terminal.Failure == nil || terminal.Failure.Code != flruntime.ThreadTurnFailureEffectOutcomeUnknown {
					t.Fatalf("unknown effect did not settle once: effects=%d error=%v terminal=%+v", effects.Load(), runErr, terminal.Failure)
				}
				if _, err := svc.threadRuntime.Retry(t.Context(), flruntime.RetryInput{ThreadID: terminal.ThreadID, SourceTurnID: terminal.TurnID, RequestKey: "never-repeat"}); !errors.Is(err, flruntime.ErrEffectOutcomeUnknown) {
					t.Fatalf("unknown mutation allowed retry: %v", err)
				}
			} else {
				if runErr != nil {
					t.Fatal(runErr)
				}
				canvases, err := library.List(t.Context(), "Commerce", "", false)
				var generated []tessiven.Canvas
				for _, canvas := range canvases.Canvases {
					if canvas.Title == "Commerce" {
						generated = append(generated, canvas)
					}
				}
				if err != nil || len(generated) != 1 {
					t.Fatal("provider did not save one canvas", canvases, err)
				}
				version := int64(1)
				if selectedID != "" {
					version = 2
					if generated[0].ID != selectedID {
						t.Fatal("Flower must populate the selected canvas")
					}
					prior, err := library.Version(t.Context(), selectedID, 1)
					if err != nil || prior.Document.Metadata.Title != "Untitled canvas" || len(prior.Document.Nodes) != 0 {
						t.Fatal("original version changed")
					}
				}
				v, err := library.Version(t.Context(), generated[0].ID, version)
				if err != nil || v.Source != "flower" || v.Document.Metadata.Title != "Commerce" {
					t.Fatal("saved version lost", v, err)
				}
			}
		})
	}
}
