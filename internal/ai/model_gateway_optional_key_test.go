package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEndpointOptionalAuthentication(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "unrelated-host-key")
	for _, kind := range []string{"ollama", "openai_compatible"} {
		for _, rawKey := range []string{"", "  ", " endpoint-key "} {
			key := strings.TrimSpace(rawKey)
			t.Run(fmt.Sprintf("%s/key=%q", kind, rawKey), func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					wantAuth := ""
					if key != "" {
						wantAuth = "Bearer " + key
					}
					if r.Header.Get("Authorization") != wantAuth || key == "" && len(r.Header.Values("Authorization")) != 0 {
						t.Error("request did not use the endpoint's explicit authentication policy")
					}
					if r.URL.Path != "/v1/chat/completions" {
						t.Errorf("unexpected endpoint: %s", r.URL.Path)
					}
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprint(w, "data: {\"id\":\"result\",\"object\":\"chat.completion.chunk\",\"model\":\"agent\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				}))
				defer server.Close()
				adapter, err := newProviderAdapter(kind, server.URL+"/v1", rawKey, nil)
				if err != nil {
					t.Fatal(err)
				}
				result, err := adapter.StreamTurn(context.Background(), ModelGatewayRequest{
					Model: "agent", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}},
				}, func(StreamEvent) {})
				if err != nil || result.Text != "ok" || calls != 1 {
					t.Fatalf("request failed: %+v, %v, calls=%d", result, err, calls)
				}
			})
		}
	}
}
