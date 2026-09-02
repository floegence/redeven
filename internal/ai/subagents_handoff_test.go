package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type subagentHandoffTestRuntime struct {
	flruntime.ThreadService
	summaries []flruntime.ThreadSummary
	views     map[identity.ThreadID]flruntime.ThreadView
	viewErrs  map[identity.ThreadID]error
}

func (runtime *subagentHandoffTestRuntime) List(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	return append([]flruntime.ThreadSummary(nil), runtime.summaries...), nil
}

func (runtime *subagentHandoffTestRuntime) View(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
	if err := ctx.Err(); err != nil {
		return flruntime.ThreadView{}, err
	}
	if err := runtime.viewErrs[threadID]; err != nil {
		return flruntime.ThreadView{}, err
	}
	return runtime.views[threadID], nil
}

func completedSubagentTestSummary(threadID, taskName, preview string, updatedAt time.Time) flruntime.ThreadSummary {
	outcome := flruntime.TurnOutcomeCompleted
	return flruntime.ThreadSummary{
		ID: identity.ThreadID(threadID), ParentThreadID: "thread-parent", ParentTurnID: "turn-parent",
		TaskName: taskName, HostProfileRef: subagentAgentTypeExplore,
		CreatedAt: updatedAt.Add(-time.Second), UpdatedAt: updatedAt,
		Activity: flruntime.ThreadActivityIdle, LastOutcome: &outcome,
		TurnID: "turn-" + identity.TurnID(threadID), RunID: "run-" + identity.RunID(threadID),
		LastItemPreview: preview,
	}
}

func completedSubagentTestView(summary flruntime.ThreadSummary, content string) flruntime.ThreadView {
	return flruntime.ThreadView{
		ThreadID: summary.ID, TurnID: summary.TurnID, RunID: summary.RunID,
		Activity: flruntime.ThreadActivityIdle, LastOutcome: summary.LastOutcome,
		Items: []flruntime.ThreadItem{
			{ID: "old", TurnID: "turn-old", RunID: "run-old", Kind: flruntime.ThreadItemAssistant, Text: "old report"},
			{ID: "final", TurnID: summary.TurnID, RunID: summary.RunID, Kind: flruntime.ThreadItemAssistant, Text: content},
			{ID: "live", TurnID: summary.TurnID, RunID: summary.RunID, Kind: flruntime.ThreadItemAssistant, Text: "unfinished", Live: true},
		},
	}
}

func newSubagentHandoffTestAdapter(t *testing.T, summaries []flruntime.ThreadSummary, views map[identity.ThreadID]flruntime.ThreadView) (*floretSubagentRuntime, *subagentHandoffTestRuntime) {
	t.Helper()
	service := newSendTurnTestService(t)
	threadRuntime := &subagentHandoffTestRuntime{
		ThreadService: service.threadRuntime,
		summaries:     summaries,
		views:         views,
		viewErrs:      map[identity.ThreadID]error{},
	}
	service.threadRuntime = threadRuntime
	return newServiceFloretSubagentRuntime(service, &run{threadID: "thread-parent", turnID: "turn-parent"}), threadRuntime
}

func subagentHandoffRecords(t *testing.T, result map[string]any) []map[string]any {
	t.Helper()
	records, ok := result["handoffs"].([]map[string]any)
	if !ok {
		t.Fatalf("handoffs = %#v, want []map[string]any", result["handoffs"])
	}
	return records
}

func TestFloretSubagentWaitAndInspectReturnCompleteHandoffs(t *testing.T) {
	now := time.Now()
	specs := []struct {
		threadID string
		taskName string
		preview  string
		content  string
	}{
		{threadID: "thread-vendor", taskName: "Vendor News", preview: strings.Repeat("v", 160), content: strings.Repeat("V", 4_028)},
		{threadID: "thread-china", taskName: "China Ecosystem", preview: strings.Repeat("c", 160), content: strings.Repeat("C", 4_569)},
		{threadID: "thread-open-source", taskName: "Open Source", preview: strings.Repeat("o", 160), content: strings.Repeat("O", 5_458)},
		{threadID: "thread-research", taskName: "Research Community", preview: strings.Repeat("r", 160), content: strings.Repeat("R", 6_393)},
	}
	summaries := make([]flruntime.ThreadSummary, 0, len(specs))
	views := make(map[identity.ThreadID]flruntime.ThreadView, len(specs))
	targets := make([]any, 0, len(specs))
	wantHandoffs := make([]map[string]any, 0, len(specs))
	for index, spec := range specs {
		summary := completedSubagentTestSummary(spec.threadID, spec.taskName, spec.preview, now.Add(time.Duration(index)*time.Second))
		summaries = append([]flruntime.ThreadSummary{summary}, summaries...)
		views[summary.ID] = completedSubagentTestView(summary, spec.content)
		targets = append(targets, summary.ID.String())
		wantHandoffs = append(wantHandoffs, map[string]any{
			"thread_id": summary.ID.String(), "turn_id": summary.TurnID.String(), "run_id": summary.RunID.String(),
			"task_name": summary.TaskName, "agent_type": subagentAgentTypeExplore,
			"status": subagentStatusCompleted, "content": spec.content,
		})
	}
	adapter, _ := newSubagentHandoffTestAdapter(t, summaries, views)

	waitResult, err := adapter.wait(t.Context(), map[string]any{
		"ids": targets, "timeout_ms": 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitHandoffs := subagentHandoffRecords(t, waitResult)
	if !reflect.DeepEqual(waitHandoffs, wantHandoffs) {
		t.Fatalf("wait handoffs differ: got %#v", waitHandoffs)
	}
	waitItems := waitResult["items"].([]map[string]any)
	if waitItems[0]["last_message_preview"] != specs[0].preview || waitItems[0]["last_message"] != nil {
		t.Fatalf("wait item = %#v, want an explicit preview only", waitItems[0])
	}

	inspectResult, err := adapter.inspect(t.Context(), map[string]any{"target": specs[1].threadID})
	if err != nil {
		t.Fatal(err)
	}
	if got := subagentHandoffRecords(t, inspectResult); !reflect.DeepEqual(got, wantHandoffs[1:2]) {
		t.Fatalf("inspect handoffs = %#v, want %#v", got, wantHandoffs[1:2])
	}
}

func TestFloretSubagentTimedOutWaitReturnsOnlyCompletedHandoffs(t *testing.T) {
	now := time.Now()
	completed := completedSubagentTestSummary("thread-complete", "Complete", "complete preview", now)
	running := flruntime.ThreadSummary{
		ID: "thread-running", ParentThreadID: "thread-parent", ParentTurnID: "turn-parent",
		TaskName: "Running", HostProfileRef: subagentAgentTypeExplore,
		CreatedAt: now, UpdatedAt: now, Activity: flruntime.ThreadActivityActive,
		TurnID: "turn-running", RunID: "run-running", LastItemPreview: "running preview",
	}
	content := "complete:" + strings.Repeat("C", 4_000)
	adapter, _ := newSubagentHandoffTestAdapter(t,
		[]flruntime.ThreadSummary{running, completed},
		map[identity.ThreadID]flruntime.ThreadView{completed.ID: completedSubagentTestView(completed, content)},
	)

	result, err := adapter.wait(t.Context(), map[string]any{
		"ids": []any{completed.ID.String(), running.ID.String()}, "timeout_ms": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !readBoolField(result, "timed_out") {
		t.Fatalf("result = %#v, want timed_out", result)
	}
	handoffs := subagentHandoffRecords(t, result)
	if len(handoffs) != 1 || handoffs[0]["thread_id"] != completed.ID.String() || handoffs[0]["content"] != content {
		t.Fatalf("handoffs = %#v, want only completed report", handoffs)
	}
}

func TestFloretSubagentInspectKeepsActiveAndMissingTargetsStatusOnly(t *testing.T) {
	now := time.Now()
	running := flruntime.ThreadSummary{
		ID: "thread-running", ParentThreadID: "thread-parent", ParentTurnID: "turn-parent",
		TaskName: "Running", HostProfileRef: subagentAgentTypeExplore,
		CreatedAt: now, UpdatedAt: now, Activity: flruntime.ThreadActivityActive,
		TurnID: "turn-running", RunID: "run-running", LastItemPreview: "running preview",
	}
	adapter, _ := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{running}, nil)
	result, err := adapter.inspect(t.Context(), map[string]any{
		"ids": []any{running.ID.String(), "thread-missing"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "partial" || readIntField(result, "found_count") != 1 || readIntField(result, "missing_count") != 1 {
		t.Fatalf("result = %#v, want one active and one missing target", result)
	}
	if handoffs := subagentHandoffRecords(t, result); len(handoffs) != 0 {
		t.Fatalf("handoffs = %#v, want no handoff for an active child", handoffs)
	}
}

func TestFloretSubagentCompletedHandoffFailsClosed(t *testing.T) {
	now := time.Now()
	summary := completedSubagentTestSummary("thread-complete", "Complete", "preview", now)

	tests := []struct {
		name    string
		view    flruntime.ThreadView
		viewErr error
	}{
		{name: "view read", viewErr: errors.New("view unavailable")},
		{name: "identity mismatch", view: completedSubagentTestView(completedSubagentTestSummary("thread-other", "Other", "preview", now), "report")},
		{name: "missing final assistant", view: flruntime.ThreadView{ThreadID: summary.ID, TurnID: summary.TurnID, RunID: summary.RunID, Activity: flruntime.ThreadActivityIdle, LastOutcome: summary.LastOutcome}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter, threadRuntime := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{summary}, map[identity.ThreadID]flruntime.ThreadView{summary.ID: test.view})
			threadRuntime.viewErrs[summary.ID] = test.viewErr
			if _, err := adapter.inspect(t.Context(), map[string]any{"target": summary.ID.String()}); err == nil {
				t.Fatal("inspect succeeded without an exact completed handoff")
			}
		})
	}
}

func TestFloretSubagentModelResultPreservesLongHandoffAndBoundsActivity(t *testing.T) {
	content := "handoff:" + strings.Repeat("H", 9_000)
	result, err := floretToolResultFromFlower(nil, ToolResult{
		ToolID: "tool-wait", ToolName: "subagents", Status: toolResultStatusSuccess,
		Data: map[string]any{
			"action": "wait", "requested_count": 1,
			"items":    []map[string]any{{"thread_id": "thread-child", "task_name": "Research", "status": subagentStatusCompleted, "last_message_preview": "preview"}},
			"handoffs": []map[string]any{{"thread_id": "thread-child", "turn_id": "turn-child", "run_id": "run-child", "status": subagentStatusCompleted, "content": content}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(result.Text), &payload); err != nil {
		t.Fatal(err)
	}
	data := payload["data"].(map[string]any)
	handoffs := data["handoffs"].([]any)
	handoff := handoffs[0].(map[string]any)
	if handoff["content"] != content || readBoolField(payload, "truncated") {
		t.Fatalf("model payload truncated the handoff: content length=%d payload=%#v", len(anyToString(handoff["content"])), payload["truncated"])
	}
	activity, ok := result.Activity.Payload.(fltools.SubAgentOperationActivityPayload)
	if !ok || activity.RequestedCount != 1 || activity.CompletedCount != 1 {
		t.Fatalf("activity = %#v", result.Activity)
	}
	for _, chip := range result.Activity.Chips {
		if chip.Kind == "truncated" {
			t.Fatalf("activity has a false truncation chip: %#v", result.Activity.Chips)
		}
	}
	activityJSON, err := json.Marshal(result.Activity)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(activityJSON), content) || strings.Contains(string(activityJSON), "handoffs") {
		t.Fatalf("activity exposed the model-only handoff: %s", activityJSON)
	}
}

func TestSubagentPromptUsesOneHandoffContract(t *testing.T) {
	prompt := buildPromptSubagentSection(promptProfileSpec{}).render()
	if !strings.Contains(prompt, "handoffs[].content") || !strings.Contains(prompt, "last_message_preview") {
		t.Fatalf("prompt does not describe the handoff contract:\n%s", prompt)
	}
	for _, stale := range []string{"final_handoff_report", "progress_summary"} {
		if strings.Contains(prompt, stale) {
			t.Fatalf("prompt contains stale field %q:\n%s", stale, prompt)
		}
	}
}
