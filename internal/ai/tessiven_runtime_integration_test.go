package ai

import (
	"context"
	"encoding/json"
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
	for _, scenario := range []string{"save", "populate_selected_canvas", "invalid_placement", "unknown_action", "runtime_directory"} {
		t.Run(scenario, func(t *testing.T) {
			action := scenario == "unknown_action"
			directory := scenario == "runtime_directory"
			state := t.TempDir()
			library, err := tessiven.Open(filepath.Join(state, "canvases.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer library.Close()
			document := "apiVersion: redeven.io/tessiven/v1.0.0\nkind: ServiceCanvas\nmetadata: {title: Commerce}\nnodes: [{id: host, name: Fixture, runtimeRef: 'ssh:fixture'}]\nservices: [{id: api, name: Orders, kind: api}]\ninstances: [{id: orders, nodeRef: host, serviceRef: api, role: standalone, binding: {owner: managed_service, resourceId: fixture}}]\n"
			var effects, providerCalls atomic.Int32
			resources := &tessiven.ResourceBackend{Library: library, Remote: func(_ context.Context, meta *session.Meta, req tessiven.ResourceRequest) (tessiven.ResourceResult, error) {
				if req.RuntimeRef != "ssh:fixture" || req.Binding.ResourceID != "fixture" || !meta.CanExecute {
					t.Error("resource authority lost")
				}
				effects.Add(1)
				return tessiven.ResourceResult{}, tessiven.ErrOutcomeUnknown
			}}
			var observedSource atomic.Bool
			if directory {
				resources.Authorize = func(meta *session.Meta) *session.Meta {
					if meta.DesktopSource != "fresh-private-source" {
						t.Error("Flower lost fresh private source metadata")
					}
					observedSource.Store(true)
					return meta
				}
			}
			name := "tessiven_save"
			args := map[string]any{"request_id": "provider-save", "expected_version": 0, "document_yaml": document, "summary": "Observed fixture"}
			if directory {
				name = "tessiven_runtimes"
				args = map[string]any{}
			}
			if scenario == "invalid_placement" {
				args["document_yaml"] = strings.Split(document, "instances:")[0]
			}
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
				if scenario == "invalid_placement" {
					if len(outputs) != 1 {
						t.Errorf("missing failed save output: %+v", outputs)
						return
					}
					var result struct {
						Status    string                 `json:"status"`
						Truncated bool                   `json:"truncated"`
						Data      tessiven.Validation    `json:"data"`
						Error     *struct{ Code string } `json:"error"`
					}
					if err := json.Unmarshal([]byte(strings.TrimPrefix(outputs[0].Output, "ERROR: ")), &result); err != nil || result.Status != "error" || result.Truncated || len(result.Data.Diagnostics) != 1 || result.Data.Diagnostics[0].Path != "/services/0/id" || result.Error == nil || result.Error.Code != "INVALID_ARGUMENTS" {
						t.Errorf("model must receive structured placement diagnostics: %+v %v", result, err)
					}
					writeAskUserIntegrationTextResponse(w, flush, "repair", "The service needs a node placement before it can be saved.")
					return
				}
				if directory {
					if len(outputs) != 1 || !strings.Contains(outputs[0].Output, "desktop_source_required") || strings.Contains(outputs[0].Output, "fresh-private-source") {
						t.Error("directory result lost structured facts or leaked private source")
					}
					writeAskUserIntegrationTextResponse(w, flush, "done", "The authorized directory was inspected.")
					return
				}
				if len(outputs) != 1 || (!action && !strings.Contains(outputs[0].Output, "surface=tessiven")) || (action && !strings.Contains(outputs[0].Output, "External effect unconfirmed")) {
					t.Errorf("saved canvas link missing: %+v", outputs)
				}
				writeAskUserIntegrationTextResponse(w, flush, "done", "The canvas has been saved.")
			}))
			defer provider.Close()
			options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Tessiven: library, TessivenResources: resources, Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 8 * time.Second, FirstOutputTimeout: 8 * time.Second, IdleTimeout: 8 * time.Second}}
			svc, err := NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			if directory {
				meta.DesktopSource = "fresh-private-source"
			}
			thread, err := svc.CreateThread(t.Context(), meta, "Commerce", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err = svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			terminal, runErr := runTypedTurnForTest(t, t.Context(), svc, meta, "tessiven-fixture", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Map the fixture and save the canvas; use the authorized instance for a service action when requested."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
			if providerCalls.Load() == 0 {
				t.Fatalf("Tessiven tool was not exposed to the provider: %v", runErr)
			}
			if action {
				if effects.Load() != 1 || runErr != nil || terminal.Failure != nil || providerCalls.Load() != 2 {
					t.Fatalf("unconfirmed action did not continue: effects=%d err=%v failure=%+v requests=%d", effects.Load(), runErr, terminal.Failure, providerCalls.Load())
				}

			} else {
				if runErr != nil {
					t.Fatal(runErr)
				}
				if directory {
					if !observedSource.Load() || providerCalls.Load() != 2 {
						t.Fatal("Runtime discovery did not execute through canonical Flower tools")
					}
					return
				}
				canvases, err := library.List(t.Context(), "Commerce", "", false)
				var generated []tessiven.Canvas
				for _, canvas := range canvases.Canvases {
					if canvas.Title == "Commerce" {
						generated = append(generated, canvas)
					}
				}
				if scenario == "invalid_placement" {
					if err != nil || len(generated) != 0 || providerCalls.Load() != 2 {
						t.Fatalf("invalid placement must not save or retry: %+v %v calls=%d", generated, err, providerCalls.Load())
					}
					return
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
