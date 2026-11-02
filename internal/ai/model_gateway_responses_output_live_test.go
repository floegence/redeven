package ai

import (
	"bytes"
	"context"
	"encoding/json"
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
