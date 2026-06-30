package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func requireAssistantTimelineText(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string, want string) {
	t.Helper()
	texts := assistantTimelineTextsForTest(t, ctx, svc, meta, threadID)
	for _, got := range texts {
		if got == want {
			return
		}
	}
	t.Fatalf("assistant timeline texts=%q, want %q", texts, want)
}

func requireAssistantTimelineTextContains(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string, want string) {
	t.Helper()
	texts := assistantTimelineTextsForTest(t, ctx, svc, meta, threadID)
	for _, got := range texts {
		if strings.Contains(got, want) {
			return
		}
	}
	t.Fatalf("assistant timeline texts=%q, want one containing %q", texts, want)
}

func assistantTimelineTextsForTest(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string) []string {
	t.Helper()
	listed, err := svc.ListThreadMessages(ctx, meta, threadID, 50, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	texts := make([]string, 0, len(listed.Messages))
	for _, message := range listed.Messages {
		raw := threadMessageRawForTest(t, message)
		var rec struct {
			Role   string `json:"role"`
			Blocks []struct {
				Type    string `json:"type"`
				Content string `json:"content"`
			} `json:"blocks"`
		}
		if err := json.Unmarshal(raw, &rec); err != nil {
			t.Fatalf("decode timeline message %s: %v", string(raw), err)
		}
		if strings.TrimSpace(rec.Role) != "assistant" {
			continue
		}
		parts := make([]string, 0, len(rec.Blocks))
		for _, block := range rec.Blocks {
			if text := strings.TrimSpace(block.Content); text != "" {
				parts = append(parts, text)
			}
		}
		texts = append(texts, strings.Join(parts, "\n\n"))
	}
	return texts
}

func threadMessageRawForTest(t *testing.T, value any) json.RawMessage {
	t.Helper()
	switch v := value.(type) {
	case json.RawMessage:
		return append(json.RawMessage(nil), v...)
	case []byte:
		return append(json.RawMessage(nil), v...)
	case string:
		return json.RawMessage(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal timeline message %T: %v", value, err)
		}
		return b
	}
}
