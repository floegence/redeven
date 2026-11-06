package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

// Inspect the sent request: canonical optional fields and strict wire nulls
// must remain usable without inventing target IDs or resource identities.
func TestToolContractClarityAtProviderBoundary(t *testing.T) {
	for _, route := range []string{"deepseek", "openai-responses", "openai-chat-completions", "chatgpt"} {
		t.Run(route, func(t *testing.T) {
			provider := "openai"
			if route == "deepseek" {
				provider = route
			}
			var wire map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
					t.Error(err)
				}
				writeToolNameGuidanceResponse(w, r, provider, route == "chatgpt")
			}))
			defer server.Close()
			strict := provider == "openai"
			gateway, err := newProviderAdapter(provider, server.URL+"/v1", "fixture", &strict)
			if err != nil {
				t.Fatal(err)
			}
			if route == "chatgpt" {
				p := gateway.(*openAIProvider)
				p.chatGPT = true
				p.chatGPTToken = func(context.Context) (string, error) { return "fixture", nil }
			}
			wanted := map[string]bool{"terminal.exec": true, "computer.exec": true, "tessiven.action": true, "tessiven.runtime.action": true, "image.read": true, "web_fetch": true, "subagents": true}
			var defs []ToolDef
			for _, def := range builtInModelCapabilityDefinitions() {
				if wanted[def.Name] {
					defs = append(defs, def)
				}
			}
			req := ModelGatewayRequest{Model: "fixture", Protocol: route, Tools: defs, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect tool contracts."}}}}}
			if route == "deepseek" {
				req.Model, req.Protocol = "deepseek-flash", ""
			} else if route == "chatgpt" {
				req.Model, req.Protocol = "gpt-6.1-sol", "openai-responses"
			}
			if _, err := gateway.StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			functions := map[string]map[string]any{}
			var collect func([]any)
			collect = func(items []any) {
				for _, item := range items {
					fn := item.(map[string]any)
					if nested, ok := fn["tools"].([]any); ok {
						collect(nested)
						continue
					}
					if nested, ok := fn["function"].(map[string]any); ok {
						fn = nested
					}
					functions[fn["name"].(string)] = fn
				}
			}
			collect(wire["tools"].([]any))
			if functions["web_search_tool"] != nil || strings.Contains(fmt.Sprint(functions["web_fetch"]["description"]), "Use web search") {
				t.Error("standalone fetch implies an absent search capability")
			}
			for name, phrases := range map[string][]string{
				"terminal_exec": {fmt.Sprintf("%d-minute runtime limit", int(terminalProcessMaxRuntime/time.Minute)), "terminal.terminate", "Service shutdown", "read/search files", "computer.targets"},
				"computer_exec": {"SCRIPT_OPERATION_LIMIT", "completed effects"},
				"image_read":    {"width", "height", "10 MiB", "32 megapixels"},
				"web_fetch":     {"known URL"},
				"subagents":     {"send_input requires target and message", "close requires target", "status/inspect require target or ids", "wait requires ids"},
			} {
				for _, phrase := range phrases {
					if !strings.Contains(strings.ToLower(fmt.Sprint(functions[name]["description"])), strings.ToLower(phrase)) {
						t.Errorf("%s omits %q", name, phrase)
					}
				}
			}
			subagentsSchema := functions["subagents"]["parameters"].(map[string]any)
			for _, keyword := range []string{"oneOf", "anyOf", "if", "then"} {
				if _, exists := subagentsSchema[keyword]; exists {
					t.Errorf("subagents gained provider-dependent root %s", keyword)
				}
			}
			for field, phrase := range map[string]string{"task_name": "Required for spawn", "task_description": "Required for spawn", "message": "4000 UTF-8 bytes", "target": "Required for send_input and close", "ids": "required for wait"} {
				property := subagentsSchema["properties"].(map[string]any)[field].(map[string]any)
				if !strings.Contains(fmt.Sprint(property["description"]), phrase) {
					t.Errorf("subagents.%s omits %q", field, phrase)
				}
			}
			for _, tc := range []struct{ name, field string }{{"computer_exec", "target"}, {"tessiven_action", "generation"}, {"tessiven_runtime_action", "identity"}} {
				schema := functions[tc.name]["parameters"].(map[string]any)
				property := schema["properties"].(map[string]any)[tc.field].(map[string]any)
				required := false
				for _, name := range schema["required"].([]any) {
					required = required || name == tc.field
				}
				validator, err := compileArgumentSchema(property)
				if err != nil {
					t.Fatal(err)
				}
				if strict {
					if !required || validator.Validate(nil) != nil || !strings.Contains(fmt.Sprint(property["description"]), "Use null to omit this optional argument") {
						t.Errorf("%s.%s has no clear strict omission contract: %#v", tc.name, tc.field, property)
					}
				} else if required {
					t.Errorf("%s.%s became required on DeepSeek", tc.name, tc.field)
				}
			}
		})
	}
}

func TestSearchDisabledGuidanceThroughFlowerRuntime(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		defs, _ := body["tools"].([]any)
		if len(defs) > 0 {
			requests.Add(1)
			found := map[string]bool{}
			for _, raw := range defs {
				def := raw.(map[string]any)
				name := fmt.Sprint(def["name"])
				found[name] = true
				switch name {
				case "web_fetch":
					if !strings.Contains(fmt.Sprint(def["description"]), "known URL") || strings.Contains(fmt.Sprint(def["description"]), "Use web search") {
						t.Error("runtime lost standalone fetch guidance")
					}
				case "terminal_exec":
					if !strings.Contains(fmt.Sprint(def["description"]), "30-minute runtime limit") {
						t.Error("runtime lost terminal lifetime guidance")
					}
				case "computer_exec":
					schema := def["parameters"].(map[string]any)
					for _, field := range schema["required"].([]any) {
						if field == "target" {
							t.Error("DeepSeek runtime requires an optional target")
						}
					}
				}
			}
			if found["web_search_tool"] || !found["web_fetch"] || !found["terminal_exec"] || !found["computer_exec"] {
				t.Errorf("incorrect configured tool surface: %#v", found)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "done", "Contracts inspected.")
	}))
	defer server.Close()
	opts := encodingIntegrationOptions(t, server.URL, nil)
	opts.Config = &config.AIConfig{CurrentModelID: "openai/deepseek-flash", Providers: []config.AIProvider{{ID: "openai", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-flash"}}, WebSearch: &config.AIProviderWebSearch{Enabled: false, Source: "native"}}}}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Tool contracts", "openai/deepseek-flash", config.AIPermissionFullAccess, opts.AgentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "contracts", Input: RunInput{Text: "Inspect the available tool descriptions."}}); err != nil {
		t.Fatal(err)
	}
	final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
	if final.RunStatus != "success" || requests.Load() != 1 {
		t.Fatalf("runtime acceptance: status=%s requests=%d", final.RunStatus, requests.Load())
	}
}

func TestComputerOperationLimitRetainsConfirmedPrefix(t *testing.T) {
	calls := 0
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "for (let i=0;i<51;i++) await ui.click(1,2);")
	p := result.Result.(map[string]any)
	completed, _ := p["completed_actions"].([]string)
	if err == nil || calls != 50 || p["completed"] != false || p["script_error"] != "SCRIPT_OPERATION_LIMIT" || p["budget_exhausted"] != "operations" || p["context_reset"] != true || len(completed) != 50 {
		t.Fatalf("operation limit lost confirmed effects: calls=%d result=%#v err=%v", calls, p, err)
	}
}
