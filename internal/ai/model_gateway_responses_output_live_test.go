package ai

import (
	"bytes"
	"context"
	"encoding/json"
	flprovider "github.com/floegence/floret/v7/provider"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
)

// Explicit qualification only: synthetic prompts, no tools and no product store.
// Credentials and native response bodies stay in process memory.
func TestResponsesLiveOutputReconciliation(t *testing.T) {
	endpoint := os.Getenv("REDEVEN_RESPONSES_QUALIFY_ENDPOINT")
	if endpoint == "" {
		t.Skip("set REDEVEN_RESPONSES_QUALIFY_ENDPOINT for isolated live acceptance")
	}
	key, model := os.Getenv("REDEVEN_RESPONSES_QUALIFY_KEY"), os.Getenv("REDEVEN_RESPONSES_QUALIFY_MODEL")
	if key == "" || model == "" {
		t.Fatal("explicit live key and model are required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	var bodies [][]byte
	makeAdapter := func() *openAIProvider {
		adapter, err := newProviderAdapter("openai", endpoint, key, nil)
		if err != nil {
			t.Fatal(err)
		}
		p := adapter.(*openAIProvider)
		p.client = openai.NewClient(ooption.WithAPIKey(key), ooption.WithBaseURL(endpoint), ooption.WithMaxRetries(0), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
			response, err := next(r)
			if err != nil {
				return response, err
			}
			body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
			_ = response.Body.Close()
			if err != nil {
				return nil, err
			}
			bodies = append(bodies, body)
			response.Body = io.NopCloser(bytes.NewReader(body))
			return response, nil
		}))
		return p
	}
	req := ModelGatewayRequest{Model: model, Protocol: "openai-responses", Budgets: TurnBudgets{MaxOutputToken: 2048}, ProviderControls: ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}, ReasoningCapability: config.AIReasoningCapabilityForModel("openai", model)}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Find the smallest positive integer n such that n mod 7 = 3, n mod 11 = 5, and n mod 13 = 7. Give only the integer, without an explanation."}}}}}
	var visible strings.Builder
	first, err := makeAdapter().StreamTurn(ctx, req, func(event StreamEvent) {
		if event.Type == StreamEventTextDelta {
			visible.WriteString(event.Text)
		}
	})
	if err != nil {
		t.Fatalf("live adapter failed: %v", err)
	}
	if first.Text == "" || visible.String() != first.Text || first.ProviderState == nil {
		t.Fatal("completed answer or native history missing")
	}
	if len(bodies) != 1 {
		t.Fatal("unexpected first-turn attempts")
	}
	done := map[int64]map[string]any{}
	var snapshot []any
	for _, line := range strings.Split(string(bodies[0]), "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var event map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &event) != nil {
			continue
		}
		if event["type"] == "response.output_item.done" {
			if item, ok := event["item"].(map[string]any); ok {
				done[int64(event["output_index"].(float64))] = item
			}
		}
		if event["type"] == "response.completed" {
			response, _ := event["response"].(map[string]any)
			snapshot, _ = response["output"].([]any)
		}
	}
	stateJSON, err := json.Marshal(first.ProviderState)
	if err != nil {
		t.Fatal(err)
	}
	conflicts := 0
	for index, raw := range snapshot {
		item, ok := raw.(map[string]any)
		if !ok || item["type"] != "reasoning" {
			continue
		}
		previous := done[int64(index)]
		a, _ := previous["encrypted_content"].(string)
		b, _ := item["encrypted_content"].(string)
		if a == "" || b == "" || a == b {
			continue
		}
		delete(previous, "encrypted_content")
		delete(item, "encrypted_content")
		if !reflect.DeepEqual(previous, item) {
			t.Fatal("live sample has an additional non-opaque conflict")
		}
		if !bytes.Contains(stateJSON, []byte(a)) || bytes.Contains(stateJSON, []byte(b)) {
			t.Fatal("history did not retain only completed-item ciphertext")
		}
		conflicts++
	}
	if conflicts == 0 {
		t.Fatal("live provider did not reproduce the ciphertext difference; acceptance is inconclusive")
	}
	var restored ModelGatewayState
	if err = json.Unmarshal(stateJSON, &restored); err != nil {
		t.Fatal(err)
	}
	req.PreviousState = &restored
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Reply with exactly: CONTINUED"}}})
	next, err := makeAdapter().StreamTurn(ctx, req, nil)
	if err != nil {
		t.Fatalf("live continuation failed: %v", err)
	}
	if strings.TrimSpace(next.Text) != "CONTINUED" || len(bodies) != 2 {
		t.Fatal("continuation or attempt count failed")
	}
	t.Logf("accepted %d ciphertext-only difference(s); displayed answer; retained completed-item native state; recreated adapter continued successfully in two requests", conflicts)
}

// A fresh synthetic hosted-search task, never a retry of a production thread.
// The deterministic fixture tests enforce source-difference behavior; a live
// provider need not emit a difference on every call to qualify its complete path.
func TestResponsesLiveHostedSearchCompletion(t *testing.T) {
	endpoint := os.Getenv("REDEVEN_RESPONSES_QUALIFY_ENDPOINT")
	if endpoint == "" {
		t.Skip("set explicit endpoint, key and model for live acceptance")
	}
	key, model := os.Getenv("REDEVEN_RESPONSES_QUALIFY_KEY"), os.Getenv("REDEVEN_RESPONSES_QUALIFY_MODEL")
	if key == "" || model == "" {
		t.Fatal("explicit key and model required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Minute)
	defer cancel()
	requests := 0
	var replayInput []byte
	makeAdapter := func() *openAIProvider {
		a, err := newProviderAdapter("openai", endpoint, key, nil)
		if err != nil {
			t.Fatal(err)
		}
		p := a.(*openAIProvider)
		p.client = openai.NewClient(ooption.WithAPIKey(key), ooption.WithBaseURL(endpoint), ooption.WithMaxRetries(0), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
			requests++
			if requests == 2 {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					return nil, err
				}
				r.Body = io.NopCloser(bytes.NewReader(raw))
				var body map[string]json.RawMessage
				_ = json.Unmarshal(raw, &body)
				replayInput = body["input"]
			}
			return next(r)
		}))
		return p
	}
	req := ModelGatewayRequest{Model: model, Protocol: "openai-responses", WebSearchMode: providerWebSearchModeOpenAIResponsesBuiltin, Budgets: TurnBudgets{MaxOutputToken: 4096}, ProviderControls: ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelLow}, ReasoningCapability: config.AIReasoningCapabilityForModel("openai", model)}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Use web search to check current US news headlines and recent technology announcements with at least two searches. Give three short findings with citations. This is a synthetic integration check; do not use local tools."}}}}}
	results := map[string]*flprovider.HostedToolResult{}
	var shown strings.Builder
	result, err := makeAdapter().StreamTurn(ctx, req, func(e StreamEvent) {
		if e.Type == StreamEventTextDelta {
			shown.WriteString(e.Text)
		}
		if e.HostedToolEvent != nil && e.HostedToolEvent.Type == flprovider.EventHostedToolResult {
			id := e.HostedToolEvent.HostedToolCall.ID
			if _, ok := results[id]; ok {
				t.Error("duplicate hosted result")
			}
			results[id] = e.HostedToolEvent.HostedResult
		}
	})
	if err != nil {
		t.Fatalf("hosted-search qualification failed: %v", err)
	}
	if result.Text == "" || shown.String() != result.Text || len(results) == 0 || result.ProviderState == nil || len(result.Sources) == 0 || requests != 1 {
		t.Fatalf("incomplete final output: searches=%d citations=%d requests=%d", len(results), len(result.Sources), requests)
	}
	raw, err := json.Marshal(result.ProviderState)
	if err != nil {
		t.Fatal(err)
	}
	var restored ModelGatewayState
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	req.PreviousState = &restored
	req.WebSearchMode = providerWebSearchModeDisabled
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: result.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Do not search again. Reply with exactly: CONTINUED"}}})
	next, err := makeAdapter().StreamTurn(ctx, req, nil)
	if err != nil {
		t.Fatalf("restored continuation failed: %v", err)
	}
	if strings.TrimSpace(next.Text) != "CONTINUED" || requests != 2 {
		t.Fatal("continuation failed or request replayed")
	}
	var input []map[string]any
	if err = json.Unmarshal(replayInput, &input); err != nil {
		t.Fatal(err)
	}
	matched := 0
	for _, item := range input {
		if item["type"] != "web_search_call" {
			continue
		}
		id, _ := item["id"].(string)
		activity := results[id]
		if activity == nil {
			t.Fatal("unknown hosted history")
		}
		matched++
		action, _ := item["action"].(map[string]any)
		sources, _ := action["sources"].([]any)
		if len(sources) != len(activity.Results) {
			t.Fatal("Activity/history source count differs")
		}
		for i, raw := range sources {
			source, _ := raw.(map[string]any)
			if source["url"] != activity.Results[i].URL {
				t.Fatal("Activity/history source identity differs")
			}
		}
	}
	if matched != len(results) {
		t.Fatal("restored history lost hosted records")
	}
	differences := 0
	if d, ok := result.RawProviderDiag["output_reconciliation"].([]responsesOutputDiagnostic); ok {
		differences = len(d)
	}
	t.Logf("live product adapter: %d hosted results, %d answer citations, %d accepted source variations; identical Activity/native search records; final answer and recreated-adapter continuation succeeded in %d requests", len(results), len(result.Sources), differences, requests)
}
