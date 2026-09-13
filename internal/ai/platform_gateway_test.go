package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlatformGatewayProviderStreamsSanitizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/ai/v1/runs" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var request platformGatewayRunRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.GrantToken != "grant" {
			t.Errorf("grant token = %q", request.GrantToken)
		}
		if request.ModelID != "openai/test" {
			t.Errorf("model id = %q", request.ModelID)
		}
		if request.AttemptID == "" {
			t.Error("attempt id is empty")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(platformGatewayRunResponse{Text: "hello", BasicUnitsUsed: 0.25, Status: "completed"})
	}))
	defer server.Close()

	provider, err := newPlatformGatewayProvider(server.URL, "grant", "openai/test")
	if err != nil {
		t.Fatal(err)
	}
	var events []StreamEvent
	result, err := provider.StreamTurn(context.Background(), ModelGatewayRequest{RunID: "run-1", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}, Budgets: TurnBudgets{MaxOutputToken: 32}}, func(event StreamEvent) { events = append(events, event) })
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "hello" || result.FinishReason != "stop" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(events) != 2 || events[0].Type != StreamEventTextDelta {
		t.Fatalf("unexpected events: %+v", events)
	}
}

func TestPlatformGatewayProviderDoesNotExposeGrantInError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"GRANT_REJECTED","message":"grant rejected"}}`))
	}))
	defer server.Close()
	provider, err := newPlatformGatewayProvider(server.URL, "secret-grant", "openai/test")
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.StreamTurn(context.Background(), ModelGatewayRequest{RunID: "run-2", Budgets: TurnBudgets{MaxOutputToken: 1}}, nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "secret-grant") {
		t.Fatalf("grant leaked in error: %v", err)
	}
}
