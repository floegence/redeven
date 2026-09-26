package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

func TestComputerScriptNavigationFailurePreservesPrefixAndTarget(t *testing.T) {
	for _, code := range []string{"NAVIGATION_FAILED", "NAVIGATION_TIMEOUT"} {
		t.Run(code, func(t *testing.T) {
			var calls []string
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
				calls = append(calls, call.ToolName)
				if call.ToolName == "browser.navigate" {
					payload := map[string]any{"action_executed": true, "navigation_stage": "load"}
					if code == "NAVIGATION_FAILED" {
						payload["navigation_stage"], payload["network_error"] = "response", "ERR_TUNNEL_CONNECTION_FAILED"
					}
					result, err, _ := computerBrowserFailure(call, false, code, payload, "fixture")
					return result, err
				}
				return TargetToolResult{Result: map[string]any{"action_executed": computerCallMutates(call), "observation": map[string]any{"nodes": []any{map[string]any{"name": "current page"}}}}}, nil
			})
			target, _ := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
			target.Kind, target.Ready, target.State = "browser.connected", true, "ready"
			if err := runtime.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			result, err := executeTestScript(t.Context(), runtime, call, `await ui.click(1,2); await ui.observe(); log('old observation'); try { await browser.navigate('https://example.test'); } catch {} await ui.click(3,4);`)
			var failure *computerNavigationError
			if !errors.As(err, &failure) || string(failure.code) != code {
				t.Fatalf("lost navigation error: %v", err)
			}
			payload := result.Result.(map[string]any)
			if !reflect.DeepEqual(calls, []string{"computer.action", "computer.observe", "browser.navigate"}) || !reflect.DeepEqual(payload["completed_actions"], []string{"pointer_click", "observe"}) {
				t.Fatalf("incorrect prefix or replay: calls=%v result=%+v", calls, payload)
			}
			if payload["completed"] != false || payload["action_executed"] != true || payload["script_error"] != code || payload["observation"] != nil || payload["logs"] != nil || len(result.Attachments) != 0 {
				t.Fatalf("unsafe partial navigation: %+v", result)
			}
			target, _ = runtime.registry.ResolveTarget(t.Context(), call.TargetID)
			if !target.Ready || target.State != "ready" {
				t.Fatalf("healthy target disabled: %+v", target)
			}
			observed, err := executeTestScript(t.Context(), runtime, call, `await ui.observe();`)
			if err != nil || observed.Result.(map[string]any)["completed"] != true || len(calls) != 4 {
				t.Fatalf("next call failed: %+v %v", observed, err)
			}
		})
	}
}

func TestBrowserNavigationOutcomeMapping(t *testing.T) {
	for _, transport := range []string{"managed", "cdp", "extension"} {
		for _, tc := range []struct {
			name, code, tool string
			payload          map[string]any
			unknown          bool
		}{
			{"tunnel", "NAVIGATION_FAILED", "browser.navigate", map[string]any{"action_executed": true, "navigation_stage": "response", "network_error": "ERR_TUNNEL_CONNECTION_FAILED"}, false},
			{"timeout", "NAVIGATION_TIMEOUT", "browser.reload", map[string]any{"action_executed": true, "navigation_stage": "load"}, false},
			{"back", "NAVIGATION_TIMEOUT", "browser.back", map[string]any{"action_executed": true, "navigation_stage": "load"}, false},
			{"missing", "NAVIGATION_FAILED", "browser.navigate", nil, true},
			{"wrong_type", "NAVIGATION_FAILED", "browser.navigate", map[string]any{"action_executed": "true", "navigation_stage": "response", "network_error": "ERR_CONNECTION_FAILED"}, true},
			{"unconfirmed", "NAVIGATION_FAILED", "browser.navigate", map[string]any{"action_executed": false, "navigation_stage": "response", "network_error": "ERR_CONNECTION_FAILED"}, true},
			{"wrong_stage", "NAVIGATION_TIMEOUT", "browser.navigate", map[string]any{"action_executed": true, "navigation_stage": "response"}, true},
			{"unsafe_reason", "NAVIGATION_FAILED", "browser.navigate", map[string]any{"action_executed": true, "navigation_stage": "response", "network_error": "private credentials"}, true},
			{"wrong_tool", "NAVIGATION_FAILED", "computer.click", map[string]any{"action_executed": true, "navigation_stage": "response", "network_error": "ERR_CONNECTION_FAILED"}, true},
			{"lost_ack", "EFFECT_OUTCOME_UNKNOWN", "browser.navigate", nil, true},
		} {
			t.Run(transport+"/"+tc.name, func(t *testing.T) {
				payload := cloneAnyMap(tc.payload)
				if payload == nil {
					payload = map[string]any{}
				}
				payload["observation"] = "private page"
				wire := map[string]any{"error": tc.code, "result": payload, "screenshot": map[string]any{"mime": "image/png", "data": "private pixels"}}
				var executor TargetToolExecutor
				var playwright *PlaywrightTargetExecutor
				if transport == "extension" {
					host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
						var request struct{ ID string }
						_ = json.NewDecoder(r.Body).Decode(&request)
						_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": wire})
					})
					executor = &extensionTargetExecutor{sourceHost: host, targetID: "fixture"}
				} else {
					playwright = newPlaywrightProtocolFixture(t)
					playwright.ManagedAttachment = transport == "managed"
					source, err := os.ReadFile(playwright.HelperPath)
					if err != nil {
						t.Fatal(err)
					}
					body, _ := json.Marshal(wire)
					script := strings.Replace(string(source), `"result":{"summary":"fixture"}`, string(body[1:len(body)-1]), 1)
					if err := os.WriteFile(playwright.HelperPath, []byte(script), 0600); err != nil {
						t.Fatal(err)
					}
					executor = playwright
				}
				result, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "fixture", ToolName: tc.tool})
				if tc.unknown {
					if !errors.Is(err, errComputerEffectUnknown) {
						t.Fatalf("uncertain result lost protection: %v", err)
					}
					return
				}
				if err == nil || errors.Is(err, errComputerEffectUnknown) {
					t.Fatalf("confirmed navigation misclassified: %v", err)
				}
				var invalid interface{ InvalidArgumentsCode() string }
				if errors.As(err, &invalid) {
					t.Fatalf("network failure classified as arguments: %v", err)
				}
				if !reflect.DeepEqual(result.Result, tc.payload) || len(result.Attachments) != 0 || len(result.frameBytes) != 0 {
					t.Fatalf("unsafe navigation outcome: %+v", result)
				}
				if playwright != nil && len(playwright.clients) != 1 {
					t.Fatal("known navigation result retired healthy client")
				}
			})
		}
	}
}

func TestBrowserNavigationReplyMustMatchInvocation(t *testing.T) {
	for _, channel := range []string{"managed", "extension"} {
		for _, damage := range []string{"identity", "type"} {
			t.Run(channel+"/"+damage, func(t *testing.T) {
				wire := map[string]any{"error": "NAVIGATION_FAILED", "result": map[string]any{"action_executed": true, "navigation_stage": "response", "network_error": "ERR_CONNECTION_FAILED"}}
				if damage == "type" {
					wire["error"] = true
				}
				var executor TargetToolExecutor
				if channel == "extension" {
					var dispatched atomic.Int32
					host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
						var request struct{ ID, Method string }
						_ = json.NewDecoder(r.Body).Decode(&request)
						if request.Method == "source.tool" {
							dispatched.Add(1)
							if damage == "identity" {
								request.ID = "wrong"
							}
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": wire})
					})
					executor = &extensionTargetExecutor{sourceHost: host, targetID: "fixture"}
					t.Cleanup(func() {
						if dispatched.Load() != 1 {
							t.Errorf("navigation dispatched %d times", dispatched.Load())
						}
					})
				} else {
					playwright := newPlaywrightProtocolFixture(t)
					source, err := os.ReadFile(playwright.HelperPath)
					if err != nil {
						t.Fatal(err)
					}
					body, _ := json.Marshal(wire)
					script := strings.Replace(string(source), `"result":{"summary":"fixture"}`, string(body[1:len(body)-1]), 1)
					if damage == "identity" {
						script = strings.Replace(script, `"id":"%s"`, `"id":"wrong-%s"`, 1)
					}
					if err := os.WriteFile(playwright.HelperPath, []byte(script), 0600); err != nil {
						t.Fatal(err)
					}
					executor = playwright
				}
				result, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "fixture", ToolName: "browser.navigate"})
				if !errors.Is(err, errComputerEffectUnknown) || result.Result != nil {
					t.Fatalf("invalid response claimed confirmed navigation: %+v %v", result, err)
				}
			})
		}
	}
}
