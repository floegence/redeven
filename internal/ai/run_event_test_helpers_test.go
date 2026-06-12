package ai

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func findRunEventPayload(t *testing.T, events []RunEventView, eventType string) map[string]any {
	t.Helper()
	for _, event := range events {
		if event.EventType == eventType {
			if event.Payload == nil {
				return map[string]any{}
			}
			payload, ok := event.Payload.(map[string]any)
			if !ok {
				t.Fatalf("run event %q payload type=%T, want map[string]any", eventType, event.Payload)
			}
			return payload
		}
	}
	t.Fatalf("missing run event %q", eventType)
	return nil
}

func writeOpenAISSEJSON(w io.Writer, f http.Flusher, payload any) {
	b, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}
