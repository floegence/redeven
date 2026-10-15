package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFloretSubagentReadsExposeCanonicalFailuresToModel(t *testing.T) {
	tests := []struct {
		id      string
		outcome flruntime.TurnOutcome
		failure *flruntime.ThreadTurnFailure
	}{
		{id: "provider", outcome: flruntime.TurnOutcomeFailed, failure: &flruntime.ThreadTurnFailure{
			Code: flruntime.ThreadTurnFailureProvider, Message: "provider unavailable: " + strings.Repeat("detail ", 1_500),
		}},
		{id: "unknown-effect", outcome: flruntime.TurnOutcomeFailed, failure: &flruntime.ThreadTurnFailure{
			Code: flruntime.ThreadTurnFailureEffectOutcomeUnknown, Message: "tool effect outcome is unknown",
		}},
		{id: "interrupted", outcome: flruntime.TurnOutcomeInterrupted, failure: &flruntime.ThreadTurnFailure{
			Code: flruntime.ThreadTurnFailureInterrupted, Message: "execution interrupted by restart",
		}},
		{id: "no-reason", outcome: flruntime.TurnOutcomeFailed},
		{id: "cancelled", outcome: flruntime.TurnOutcomeCancelled},
		{id: "completed", outcome: flruntime.TurnOutcomeCompleted},
	}
	for _, action := range []string{subagentActionList, subagentActionWait, subagentActionInspect} {
		t.Run(action, func(t *testing.T) {
			now := time.Now()
			summaries := make([]flruntime.ThreadSummary, 0, len(tests))
			targets := make([]any, 0, len(tests))
			views := map[identity.ThreadID]flruntime.ThreadView{}
			for _, test := range tests {
				summary := completedSubagentTestSummary("thread-"+test.id, test.id, "last message before termination", now)
				summary.LastOutcome, summary.Failure = &test.outcome, test.failure
				summaries = append(summaries, summary)
				targets = append(targets, summary.ID.String())
				if test.outcome == flruntime.TurnOutcomeCompleted {
					views[summary.ID] = completedSubagentTestView(summary, "verified report")
				}
			}
			adapter, _ := newSubagentHandoffTestAdapter(t, summaries, views)
			data, err := adapter.manage(t.Context(), "tool-read", map[string]any{
				"action": action, "ids": targets, "timeout_ms": 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			result, err := floretToolResultFromFlower(nil, ToolResult{
				ToolID: "tool-read", ToolName: "subagents", Status: toolResultStatusSuccess, Data: data,
			})
			if err != nil {
				t.Fatal(err)
			}
			var model struct {
				Truncated bool `json:"truncated"`
				Data      struct {
					Items []struct {
						ThreadID string                       `json:"thread_id"`
						Failure  *flruntime.ThreadTurnFailure `json:"failure"`
					} `json:"items"`
				} `json:"data"`
			}
			if err := json.Unmarshal([]byte(result.Text), &model); err != nil {
				t.Fatal(err)
			}
			if len(model.Data.Items) != len(tests) || model.Truncated {
				t.Fatalf("model result has %d children, truncated=%t", len(model.Data.Items), model.Truncated)
			}
			for index, test := range tests {
				item := model.Data.Items[index]
				if item.ThreadID != "thread-"+test.id || !reflect.DeepEqual(item.Failure, test.failure) {
					t.Errorf("child %q did not preserve the canonical failure for %q", item.ThreadID, test.id)
				}
				if test.failure == nil {
					if _, exists := data["items"].([]map[string]any)[index]["failure"]; exists {
						t.Errorf("child %q has a fabricated failure", item.ThreadID)
					}
				}
			}
			if action != subagentActionList {
				handoffs := subagentHandoffRecords(t, data)
				if len(handoffs) != 1 || handoffs[0]["content"] != "verified report" {
					t.Fatalf("handoffs = %#v, want only the completed child's report", handoffs)
				}
			}
		})
	}
}

func TestFloretSubagentRetryDoesNotRetainFailure(t *testing.T) {
	summary := completedSubagentTestSummary("thread-child", "Research", "old preview", time.Now())
	outcome := flruntime.TurnOutcomeFailed
	summary.LastOutcome = &outcome
	summary.Failure = &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: "old provider error"}
	adapter, threads := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{summary}, nil)
	first, err := adapter.inspect(t.Context(), map[string]any{"target": summary.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if first["items"].([]map[string]any)[0]["failure"] == nil {
		t.Fatal("failed child has no failure")
	}
	threads.summaries[0].Activity = flruntime.ThreadActivityActive
	threads.summaries[0].LastOutcome = nil
	threads.summaries[0].Failure = nil
	after, err := adapter.inspect(t.Context(), map[string]any{"target": summary.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	item := after["items"].([]map[string]any)[0]
	if _, exists := item["failure"]; exists || item["status"] != subagentStatusRunning {
		t.Fatalf("running child retained the previous failure: %#v", item)
	}
}
