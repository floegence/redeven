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

	"github.com/floegence/redeven/internal/config"
)

func TestComputerScriptEmitsEveryRequestedObservation(t *testing.T) {
	reads := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		if inner.ToolName != "computer_observe" {
			return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
		}
		reads++
		value := []string{"first page", "second page", "third page"}[reads-1]
		return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText(value)}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.snapshot(); await ui.click(1,2); await ui.snapshot(); await ui.snapshot();`)
	if err != nil {
		t.Fatal(err)
	}
	p := result.Result.(map[string]any)
	emissions, ok := p["observations"].([]any)
	if !ok || len(emissions) != 3 {
		t.Fatalf("requested observations lost: %+v", p)
	}
	for i, phrase := range []string{"first page", "second page", "third page"} {
		body, _ := json.Marshal(emissions[i])
		if !strings.Contains(string(body), phrase) {
			t.Fatalf("observation %d lost: %s", i, body)
		}
	}
	if p["observation"] == nil {
		t.Fatal("legacy current observation missing")
	}
}

func TestComputerScriptEmittedPrefixSurvivesReadFailure(t *testing.T) {
	reads := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		reads++
		if reads == 1 {
			return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed prefix")}}, nil
		}
		return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "semantic_read"}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.snapshot(); await ui.snapshot();`)
	if err == nil {
		t.Fatal("expected read failure")
	}
	p := result.Result.(map[string]any)
	emissions, _ := p["observations"].([]any)
	if len(emissions) != 1 || p["observation"] != nil {
		t.Fatalf("prefix/current boundary: %+v", p)
	}
}

func TestComputerScriptOrderedOutputReachesModelEncoder(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("complete source fact")}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, "log('before'); await ui.snapshot(); log('between'); await ui.snapshot({full:true}); log('after');")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := encodeModelToolResult(ToolResult{ToolID: "call", ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: result.Result})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err = json.Unmarshal(encoded.text, &payload); err != nil {
		t.Fatal(err)
	}
	data := payload["data"].(map[string]any)
	if len(data["observations"].([]any)) != 2 {
		t.Fatal("model boundary lost observation")
	}
	order := data["output_order"].([]any)
	want := []string{"log", "observation", "log", "observation", "log"}
	if len(order) != len(want) {
		t.Fatalf("order=%v", order)
	}
	for i, kind := range want {
		if order[i].(map[string]any)["kind"] != kind {
			t.Fatalf("order=%v", order)
		}
	}
}

func TestComputerScriptOutputBudgetPreservesDeliveredPrefix(t *testing.T) {
	reads := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		reads++
		tree := semanticFixtureText("full source fact")
		nodes := []any{}
		for i := 0; i < 120; i++ {
			nodes = append(nodes, semanticFixtureNode(fmt.Sprint(i), "text", strings.Repeat("x", 2000)))
		}
		tree["nodes"] = nodes
		return TargetToolResult{Result: map[string]any{"observation": tree}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({full:true}); await ui.snapshot({full:true});")
	if err == nil || reads != 2 {
		t.Fatalf("unbounded read: %v %d", err, reads)
	}
	p := result.Result.(map[string]any)
	if len(p["observations"].([]any)) != 1 || p["script_error"] != "SCRIPT_OUTPUT_LIMIT" {
		t.Fatalf("prefix missing: %v", p)
	}
}

func TestComputerMultipleObservationsReachProviderRequest(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("provider visible complete fact")}}, nil
	})
	code := "log('before'); await ui.snapshot(); log('between'); await ui.snapshot({full:true});"
	result, err := executeTestScript(t.Context(), runtime, call, code)
	if err != nil {
		t.Fatal(err)
	}
	var verified atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if defs, _ := body["tools"].([]any); len(defs) > 0 {
			found := false
			for _, raw := range body["input"].([]any) {
				item, _ := raw.(map[string]any)
				if item["type"] != "function_call_output" || item["call_id"] != "emissions" {
					continue
				}
				found = true
				output, ok := item["output"].(string)
				if !ok {
					t.Error("missing text output")
					continue
				}
				var payload map[string]any
				if err := json.Unmarshal([]byte(output), &payload); err != nil {
					t.Error(err)
					continue
				}
				data, _ := payload["data"].(map[string]any)
				observations, _ := data["observations"].([]any)
				order, _ := data["output_order"].([]any)
				if len(observations) != 2 || len(order) != 4 || !strings.Contains(output, "provider visible complete fact") {
					t.Errorf("provider lost output: %s", output)
				} else {
					verified.Store(true)
				}
			}
			if !found {
				args, _ := json.Marshal(map[string]any{"code": code, "description": "Read two observations"})
				writeEncodingIntegrationCall(w, "computer_exec", "emissions", string(args))
				return
			}
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Verified both observations.")
	}))
	defer provider.Close()
	options := encodingIntegrationOptions(t, provider.URL, scriptTestExecutor{fn: func(_ context.Context, c TargetToolCall) (TargetToolResult, error) { return result, nil }})
	svc, err := NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "emissions", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "ordered", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Read both observations."}, Options: RunOptions{ToolAllowlist: legacyComputerFixtureTools(), PermissionType: config.AIPermissionFullAccess}})
	if err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
	if !verified.Load() {
		t.Fatal("provider never received both observations")
	}
}

func TestComputerOrderedObservationActivityKeepsBothPages(t *testing.T) {
	rows := computerActivityResultRows("computer_exec", map[string]any{
		"observations": []any{map[string]any{"observation": semanticFixtureText("first observed page")}, map[string]any{"observation": semanticFixtureText("second observed page")}},
		"logs":         []any{[]any{"between pages"}},
		"output_order": []any{map[string]any{"kind": "observation", "index": 0}, map[string]any{"kind": "log", "index": 0}, map[string]any{"kind": "observation", "index": 1}},
	})
	body, _ := json.Marshal(rows)
	text := string(body)
	if !(strings.Index(text, "first observed page") >= 0 && strings.Index(text, "first observed page") < strings.Index(text, "between pages") && strings.Index(text, "between pages") < strings.Index(text, "second observed page")) {
		t.Fatalf("activity lost ordered evidence: %s", text)
	}
}

func TestComputerHistoricalImageSurvivesLaterReadFailure(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		if c.ToolName == "computer_capture_screenshot" {
			attachment.ResourceRef = "computer://" + c.TargetID + "/" + attachment.SHA256
			return TargetToolResult{TargetID: c.TargetID, frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{"frame_geometry": map[string]any{"frame": attachment.ResourceRef, "document_id": "fixture:1"}}}, nil
		}
		return computerObservationFailure(c, map[string]any{"observation_stage": "semantic_read"}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.screenshot(); await ui.snapshot();")
	if err == nil || len(result.Attachments) != 1 {
		t.Fatalf("historical image lost: %v %+v", err, result)
	}
	order := result.Result.(map[string]any)["output_order"].([]any)
	if len(order) != 1 || order[0].(map[string]any)["kind"] != "image" {
		t.Fatalf("image order lost: %v", order)
	}
}
