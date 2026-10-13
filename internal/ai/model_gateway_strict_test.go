package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// The provider fixture enforces the wire contract instead of accepting every
// schema and returning a scripted success for an invalid production request.
func checkStrictWireSchema(schema map[string]any) error {
	if properties, ok := schema["properties"].(map[string]any); ok {
		if schema["additionalProperties"] != false {
			return fmt.Errorf("object must reject additional properties")
		}
		required, _ := schema["required"].([]any)
		if len(required) != len(properties) {
			return fmt.Errorf("all properties must be required")
		}
		for name, child := range properties {
			if !slices.Contains(required, any(name)) {
				return fmt.Errorf("%s must be required", name)
			}
			if err := checkStrictWireSchema(child.(map[string]any)); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
	}
	if child, ok := schema["items"].(map[string]any); ok {
		if err := checkStrictWireSchema(child); err != nil {
			return err
		}
	}
	for _, key := range []string{"anyOf", "oneOf", "allOf"} {
		if children, ok := schema[key].([]any); ok {
			for _, child := range children {
				if err := checkStrictWireSchema(child.(map[string]any)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func TestOpenAIStrictWireAcceptsFlowerToolset(t *testing.T) {
	for _, route := range []string{"openai-responses", "openai-chat-completions", "chatgpt"} {
		t.Run(route, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Tools []map[string]any `json:"tools"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				var functions []map[string]any
				for _, tool := range body.Tools {
					if nested, ok := tool["tools"].([]any); ok {
						for _, child := range nested {
							functions = append(functions, child.(map[string]any))
						}
					} else if fn, ok := tool["function"].(map[string]any); ok {
						functions = append(functions, fn)
					} else {
						functions = append(functions, tool)
					}
				}
				if len(functions) < 20 {
					t.Fatalf("real Flower toolset missing: %d tools", len(functions))
				}
				for _, fn := range functions {
					if fn["strict"] != true {
						t.Errorf("tool %s disabled strict mode", fn["name"])
					}
					if err := checkStrictWireSchema(fn["parameters"].(map[string]any)); err != nil {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusBadRequest)
						fmt.Fprintf(w, `{"error":{"message":%q,"code":null,"param":"tools"}}`, err.Error())
						return
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if strings.HasSuffix(r.URL.Path, "chat/completions") {
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				} else {
					fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response-1\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"id\":\"answer\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello.\",\"annotations\":[]}] }]}}\n\n")
				}
			}))
			defer server.Close()
			strict := true
			gateway, err := newProviderAdapter("openai", server.URL+"/v1", "fixture", &strict)
			if err != nil {
				t.Fatal(err)
			}
			protocol := route
			if route == "chatgpt" {
				provider := gateway.(*openAIProvider)
				provider.chatGPT, provider.requireTerminal = true, true
				provider.chatGPTToken = func(context.Context) (string, error) { return "fixture", nil }
				protocol = "openai-responses"
			}
			result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "gpt-6.1-sol", Protocol: protocol, Tools: builtInToolDefinitions(), Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}, nil)
			if err != nil || result.Text != "Hello." {
				t.Fatalf("Flower request rejected: text=%q error=%v", result.Text, err)
			}
		})
	}
}

func strictFixtureTool() ToolDef {
	return ToolDef{Name: "inspect", Strict: true, InputSchema: json.RawMessage(`{"type":"object","properties":{"required":{"type":"string"},"optional":{"type":"integer"},"nullable":{"type":["string","null"]},"choice":{"type":"string","enum":["a","b"]},"items":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"flag":{"type":"boolean"}},"required":["id"],"additionalProperties":false}},"zero":{"type":"integer"},"empty":{"type":"string"},"false":{"type":"boolean"}},"required":["required"],"additionalProperties":false}`)}
}

func TestStrictSchemaPreservesCanonicalArgumentSemantics(t *testing.T) {
	def := strictFixtureTool()
	original := string(def.InputSchema)
	wire, aliases, err := prepareOpenAIToolSchemas([]ToolDef{def}, true)
	if err != nil {
		t.Fatal(err)
	}
	if string(def.InputSchema) != original {
		t.Fatal("canonical schema was mutated")
	}
	var schema map[string]any
	if err := json.Unmarshal(wire[0].InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	if err := checkStrictWireSchema(schema); err != nil {
		t.Fatal(err)
	}
	validator, err := compileArgumentSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	args := parseProviderToolArguments(`{"required":"ok","optional":null,"nullable":null,"choice":null,"items":[{"id":"one","flag":null},{"id":"two","flag":false}],"zero":0,"empty":"","false":false}`)
	if err := validator.Validate(args); err != nil {
		t.Fatal(err)
	}
	restored := aliases.restoreArguments("inspect", args)
	want := parseProviderToolArguments(`{"required":"ok","nullable":null,"items":[{"id":"one"},{"id":"two","flag":false}],"zero":0,"empty":"","false":false}`)
	if !reflect.DeepEqual(restored, want) {
		t.Fatalf("restored=%#v want=%#v", restored, want)
	}
	var canonical map[string]any
	_ = json.Unmarshal(def.InputSchema, &canonical)
	canonicalValidator, err := compileArgumentSchema(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if err := canonicalValidator.Validate(restored); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`{"required":null}`, `{"required":2}`, `{"required":"ok","unknown":true}`, `{"required":"ok","choice":"invalid"}`, `{}`} {
		args := aliases.restoreArguments("inspect", parseProviderToolArguments(raw))
		if canonicalValidator.Validate(args) == nil {
			t.Fatalf("invalid canonical arguments accepted: %s", raw)
		}
	}
	for _, raw := range []string{`{`, `[]`, `null`, ``, `{"required":"ok","optional":}`} {
		if parseProviderToolArguments(raw) != nil {
			t.Fatalf("malformed arguments accepted: %q", raw)
		}
	}
}

func TestStrictSchemasFailBeforeDispatchAndHonorExplicitIntent(t *testing.T) {
	for _, raw := range []string{`null`, `{`, `{"type":"string"}`, `{"type":"object","properties":{},"additionalProperties":true}`, `{"type":"object","properties":{"x":{"$ref":"https://private.invalid/schema"}},"additionalProperties":false}`, `{"type":"object","required":null,"additionalProperties":false}`, `{"type":"object","required":["missing"],"additionalProperties":false}`, `{"type":"object","properties":{"x":{}},"additionalProperties":false}`} {
		if _, _, err := prepareOpenAIToolSchemas([]ToolDef{{Name: "invalid", Strict: true, InputSchema: json.RawMessage(raw)}}, true); err == nil {
			t.Fatalf("invalid strict schema accepted: %s", raw)
		}
	}
	def := strictFixtureTool()
	for _, policy := range []bool{true, false} {
		def.Strict = false
		wire, aliases, err := prepareOpenAIToolSchemas([]ToolDef{def}, policy)
		if err != nil {
			t.Fatal(err)
		}
		if string(wire[0].InputSchema) != string(def.InputSchema) || len(aliases.argumentRules) != 0 {
			t.Fatal("non-strict definition was compiled")
		}
		if buildOpenAITools(wire, policy, aliases)[0].OfFunction.Strict.Value {
			t.Fatal("non-strict definition became strict")
		}
	}
}

func TestStrictArgumentsFrozenWithPreparedRequest(t *testing.T) {
	for _, route := range []string{"responses-stream", "responses-final", "chatgpt-stream", "chatgpt-final", "chat"} {
		t.Run(route, func(t *testing.T) {
			rawArgs := `{"required":"ok","optional":null,"nullable":null,"choice":null,"items":[{"id":"one","flag":null}],"zero":0,"empty":"","false":false}`
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if route == "chat" {
					fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call\",\"type\":\"function\",\"function\":{\"name\":\"inspect\",\"arguments\":%q}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", rawArgs)
					return
				}
				item := fmt.Sprintf(`{"type":"function_call","id":"item","call_id":"call","name":"inspect","namespace":"redeven","arguments":%q,"status":"completed"}`, rawArgs)
				if strings.HasSuffix(route, "stream") {
					fmt.Fprintf(w, "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":%s}\n\n", item)
					fmt.Fprintf(w, "data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"item\",\"arguments\":%q}\n\n", rawArgs)
				}
				fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response\",\"status\":\"completed\",\"output\":[%s]}}\n\n", item)
			}))
			defer server.Close()
			gateway, _ := newProviderAdapter("openai", server.URL, "fixture", nil)
			provider := gateway.(*openAIProvider)
			provider.strictToolSchema = true
			provider.chatGPT = strings.HasPrefix(route, "chatgpt")
			req := ModelGatewayRequest{Model: "gpt-6.1-sol", Tools: []ToolDef{strictFixtureTool()}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "inspect"}}}}}
			if route == "chat" {
				req.Protocol = "openai-chat-completions"
			}
			prepared, err := provider.prepareTurn(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			// Mutation after preparation must not change this request's schema/rules.
			req.Tools[0].InputSchema = json.RawMessage(`{"type":"object","properties":{"optional":{"type":["integer","null"]}},"additionalProperties":false}`)
			var ends []map[string]any
			result, err := prepared.StreamTurn(t.Context(), func(ev StreamEvent) {
				if ev.Type == StreamEventToolCallEnd {
					ends = append(ends, ev.ToolCall.Arguments)
				}
			})
			if err != nil {
				t.Fatal(err)
			}
			want := parseProviderToolArguments(`{"required":"ok","nullable":null,"items":[{"id":"one"}],"zero":0,"empty":"","false":false}`)
			if len(ends) != 1 || len(result.ToolCalls) != 1 || !reflect.DeepEqual(ends[0], want) || !reflect.DeepEqual(result.ToolCalls[0].Args, want) {
				t.Fatalf("ends=%#v result=%#v", ends, result.ToolCalls)
			}
			if provider.chatGPT && !strings.Contains(result.ProviderState.Attributes["native_output"], `optional\":null`) {
				t.Fatal("native output lost original wire arguments")
			}
		})
	}
}
