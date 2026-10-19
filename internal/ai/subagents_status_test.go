package ai

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestSubagentStatusReturnsOnlyBoundedMetadataWithoutView(t *testing.T) {
	now := time.Now()
	completed := completedSubagentTestSummary("completed", strings.Repeat("界", 200), strings.Repeat("REPORT_SECRET", 10000), now)
	completed.TaskDescription = "TASK_DESCRIPTION_SECRET"
	failed := completedSubagentTestSummary("failed", "Failure", "FAILURE_PREVIEW_SECRET", now)
	outcome := flruntime.TurnOutcomeFailed
	failed.LastOutcome = &outcome
	failed.Failure = &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEffectOutcomeUnknown, Message: "FAILURE_BODY_SECRET"}
	waiting := completedSubagentTestSummary("waiting", "Waiting", "WAIT_PREVIEW_SECRET", now)
	waiting.Attention.InputCount = 1
	waiting.PendingInput = &flruntime.InputPresentation{Summary: "INPUT_BODY_SECRET"}
	cancelled := completedSubagentTestSummary("cancelled", "Cancelled", "CANCEL_PREVIEW_SECRET", now)
	cancelOutcome := flruntime.TurnOutcomeCancelled
	cancelled.LastOutcome = &cancelOutcome
	adapter, runtime := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{completed, failed, waiting, cancelled}, nil)
	result, err := adapter.manage(t.Context(), "status", map[string]any{"action": "status", "target": " completed ", "ids": []any{"waiting", "completed", "missing", "failed", "cancelled"}})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.viewCalls != 0 {
		t.Fatalf("status read %d complete views", runtime.viewCalls)
	}
	if result["status"] != "partial" || result["requested_count"] != 5 || result["found_count"] != 4 || result["missing_count"] != 1 {
		t.Fatalf("counts = %#v", result)
	}
	if !reflect.DeepEqual(result["missing_ids"], []string{"missing"}) {
		t.Fatalf("missing = %#v", result["missing_ids"])
	}
	items := result["items"].([]map[string]any)
	for i, want := range []string{"completed", "waiting", "failed", "cancelled"} {
		if items[i]["thread_id"] != want {
			t.Fatalf("order = %#v", items)
		}
		keys := []string{"thread_id", "task_name", "agent_type", "status", "latest_turn_id", "closed", "queued_inputs", "updated_at_ms"}
		expected := len(keys)
		if want == "failed" {
			expected++
		}
		if len(items[i]) != expected {
			t.Fatalf("unexpected fields = %#v", items[i])
		}
		for _, key := range keys {
			if _, ok := items[i][key]; !ok {
				t.Fatalf("missing %s", key)
			}
		}
	}
	if len([]rune(items[0]["task_name"].(string))) != 140 {
		t.Fatal("task name not bounded")
	}
	if items[1]["status"] != subagentStatusWaiting || items[2]["status"] != subagentStatusFailed || items[3]["status"] != subagentStatusCanceled {
		t.Fatalf("states = %#v", items)
	}
	if !reflect.DeepEqual(items[2]["failure"], map[string]any{"code": string(flruntime.ThreadTurnFailureEffectOutcomeUnknown)}) {
		t.Fatalf("failure = %#v", items[2]["failure"])
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"SECRET", "handoffs", "last_message_preview", "waiting_prompt", "task_description"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("status leaked %s", forbidden)
		}
	}
	if len(encoded) > 4000 {
		t.Fatalf("unexpected status size %d", len(encoded))
	}
}

func TestSubagentStatusRequiresBoundedExplicitTargets(t *testing.T) {
	adapter, runtime := newSubagentHandoffTestAdapter(t, nil, nil)
	ids := make([]any, 201)
	for i := range ids {
		ids[i] = fmt.Sprintf("child-%d", i)
	}
	for _, args := range []map[string]any{{"action": "status"}, {"action": "status", "ids": []any{" ", ""}}, {"action": "status", "ids": ids}} {
		if _, err := adapter.manage(t.Context(), "invalid-status", args); err == nil {
			t.Fatalf("accepted %#v", args)
		}
	}
	result, err := adapter.manage(t.Context(), "max-status", map[string]any{"action": "status", "ids": ids[:200], "target": ids[0]})
	if err != nil || result["requested_count"] != 200 || result["status"] != "not_found" {
		t.Fatalf("boundary = %#v, %v", result, err)
	}
	if runtime.viewCalls != 0 {
		t.Fatal("status read transcript")
	}
}

func TestSubagentStatusResourceReferencesIncludeEveryTarget(t *testing.T) {
	refs, err := floretToolResources(fltools.Invocation[map[string]any]{Name: "subagents", Args: map[string]any{"action": "status", "target": "one", "ids": []any{"two", "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, ref := range refs {
		if ref.Kind == "subagent_thread" {
			ids = append(ids, ref.Value)
		}
	}
	if !reflect.DeepEqual(ids, []string{"one", "two"}) {
		t.Fatalf("resources = %#v", refs)
	}
}

func TestSubagentStatusActivityPreservesRequestedOrderAndReturnedStates(t *testing.T) {
	args := map[string]any{"action": "status", "target": "one", "ids": []any{"two", "one", "missing"}}
	call := floretActivityForToolCall("subagents", args)
	result, err := floretActivityForToolResult(nil, ToolResult{ToolName: "subagents", Status: toolResultStatusSuccess, activityInput: args, Data: map[string]any{
		"action": "status", "status": "partial", "requested_ids": []string{"one", "two", "missing"}, "requested_count": 3, "missing_count": 1,
		"items": []map[string]any{{"thread_id": "one", "status": subagentStatusCompleted}, {"thread_id": "two", "status": subagentStatusFailed}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, activity := range []*fltools.ActivityPresentation{call, result} {
		payload := activity.Payload.(fltools.SubAgentOperationActivityPayload)
		if payload.Action != fltools.SubAgentOperationStatus || payload.RequestedCount != 3 || len(payload.Targets) != 3 {
			t.Fatalf("activity = %+v", payload)
		}
		for i, want := range []string{"one", "two", "missing"} {
			if payload.Targets[i].ThreadID.String() != want {
				t.Fatalf("target order = %+v", payload.Targets)
			}
		}
		encoded, err := json.Marshal(activity)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(encoded), "handoffs") {
			t.Fatal("status activity contains result bodies")
		}
	}
	payload := result.Payload.(fltools.SubAgentOperationActivityPayload)
	if payload.Targets[0].Status != subagentStatusCompleted || payload.Targets[1].Status != subagentStatusFailed || payload.Error != nil || payload.MissingCount != 1 {
		t.Fatalf("returned states = %+v", payload)
	}
}
