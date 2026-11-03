package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/tools"
)

// Verify the published owner through Redeven's real bounded history adapter.
// Only fixture identities and timing are normalized; content, locators and
// canonical membership originate from public Floret output.
func TestFlowerCanonicalWhitespacePreview(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Bounded text contract", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	tool := tools.Define[struct{}](tools.Definition{
		Name: "inspect_preview", ReadOnly: true, InputSchema: tools.StrictObject(map[string]any{}, nil),
		Permission: tools.PermissionSpec{Mode: tools.PermissionAllow},
	}, nil, nil, func(context.Context, tools.Invocation[struct{}]) (tools.Result, error) {
		return tools.Result{Text: "Inspected."}, nil
	})
	var calls atomic.Int32
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 3)
		switch calls.Add(1) {
		case 1:
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: strings.Repeat("\n", 2048) + "Intermediate observation."}
			events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "preview-call", Name: "inspect_preview", Args: "{}"}}}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
		case 2:
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: strings.Repeat("\n", 2048) + "Final answer."}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		default:
			t.Error("unexpected provider replay")
		}
		close(events)
		return events, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile: flconfig.AgentProfile{ID: "preview-assistant", Name: "Preview assistant"}, SystemPrompt: "Inspect, then answer.",
		Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(
		func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
			return effect(ctx, flruntime.EffectAuthorizationProof{
				EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint,
				ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID,
				PolicyRevision: "test-policy", AuditReference: "test-audit", AuditHash: "test-audit-hash", AuthorizedAt: time.Now().UTC(),
			})
		})))
	if err != nil {
		t.Fatal(err)
	}
	const requestKey = "bounded-preview"
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), requestKey, floretEffectRequest{agent: agent, meta: *meta,
		req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	subscription, err := svc.threadRuntime.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if _, err = svc.threadRuntime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), Input: flruntime.UserInput{Text: "Inspect the preview."}, RequestKey: requestKey}); err != nil {
		t.Fatal(err)
	}
	for {
		view, err := subscription.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if view.ThreadID.String() == thread.ThreadID && view.LastOutcome != nil && view.Activity == flruntime.ThreadActivityIdle {
			if *view.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("unexpected outcome: %s", *view.LastOutcome)
			}
			break
		}
	}
	detail, err := svc.GetFlowerThreadHistory(ctx, meta, thread.ThreadID, FlowerHistoryRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("provider calls=%d", calls.Load())
	}
	if len(detail.Current.Turns) != 1 {
		t.Fatalf("turns=%d", len(detail.Current.Turns))
	}
	turn := detail.Current.Turns[0]
	if len(turn.IntermediateItemIDs) != 1 || len(turn.FinalItemIDs) != 1 {
		t.Fatalf("membership: %+v", turn)
	}
	ids := map[string]string{turn.IntermediateItemIDs[0]: "intermediate", turn.FinalItemIDs[0]: "final"}
	items := []map[string]any{}
	for _, item := range detail.Current.Items {
		id, ok := ids[item.ID]
		if !ok {
			continue
		}
		if strings.TrimSpace(item.Text) != "" || len(item.Text) != 1024 || item.Body == nil || item.Body.Bytes <= len(item.Text) || item.Body.PreviewBytes != len(item.Text) || item.Body.SourceID != item.ID {
			t.Fatalf("bounded canonical text contract violated: %+v", item)
		}
		chunk, err := svc.GetFlowerHistoryBody(ctx, meta, thread.ThreadID, FlowerHistoryBodyRequest{
			ItemID: item.ID, SourceID: item.Body.SourceID, RunID: item.Body.RunID, Field: item.Body.Field,
			ThroughBytes: item.Body.Bytes, OffsetBytes: item.Body.PreviewBytes,
		})
		if err != nil {
			t.Fatal(err)
		}
		expectedText := "Intermediate observation."
		if id == "final" {
			expectedText = "Final answer."
		}
		if strings.TrimSpace(chunk.Text) != expectedText || chunk.OffsetBytes+len(chunk.Text) != item.Body.Bytes {
			t.Fatalf("canonical suffix was not readable: %+v", chunk)
		}
		items = append(items, map[string]any{"id": id, "kind": item.Kind, "ordinal": item.Ordinal, "canonical_ordinal": item.CanonicalOrdinal,
			"turn_id": "turn", "run_id": "run", "text": item.Text,
			"body": map[string]any{"source_id": id, "field": item.Body.Field, "bytes": item.Body.Bytes, "preview_bytes": item.Body.PreviewBytes}})
	}
	if len(items) != 2 {
		t.Fatalf("assistant items=%d", len(items))
	}
	fixture := map[string]any{"thread_id": "thread", "turn_id": "turn", "run_id": "run", "activity": "idle", "last_outcome": "completed", "view_version": 1, "items": items,
		"turns": []map[string]any{{"turn_id": "turn", "run_id": "run", "started_at": "2026-11-03T00:00:00Z", "ended_at": "2026-11-03T00:00:01Z",
			"outcome": turn.Outcome, "elapsed_ms": 1000, "waiting_ms": 0, "work_duration_ms": 1000, "final_boundary_complete": turn.FinalBoundaryComplete,
			"final_item_ids": []string{"final"}, "intermediate_item_ids": []string{"intermediate"}}}}
	raw, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	path := filepath.Join("..", "flower_ui", "src", "testdata", "boundedWhitespaceCurrentView.json")
	if os.Getenv("UPDATE_FLOWER_PREVIEW_FIXTURE") == "1" {
		if err := os.WriteFile(path, raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(expected) != string(raw) {
		t.Fatal("published bounded-preview fixture changed; review with UPDATE_FLOWER_PREVIEW_FIXTURE=1")
	}
}
