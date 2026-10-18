package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestParentEventActivityPreservesReturnedSources(t *testing.T) {
	for _, action := range []string{"list", "read"} {
		t.Run(action, func(t *testing.T) {
			activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "subagent_events", Status: "success", activityInput: map[string]any{"action": action}, Data: flruntime.ParentEventPage{ThreadID: "parent", Events: []flruntime.ParentEvent{
				{ID: "one", ParentThreadID: "parent", SourceTurnID: "turn", SourceRunID: "run", SourceThreadID: "child-a", Message: "Private report body"}, {ID: "two", ParentThreadID: "parent", SourceTurnID: "turn", SourceRunID: "run", SourceThreadID: "child-a"}, {ID: "three", ParentThreadID: "parent", SourceTurnID: "turn", SourceRunID: "run", SourceThreadID: "child-b"},
			}}})
			if err != nil {
				t.Fatal(err)
			}
			want := []fltools.ActivityTargetRef{{Kind: "subagent", Label: "child-a", ResourceRef: "child-a"}, {Kind: "subagent", Label: "child-b", ResourceRef: "child-b"}}
			if !reflect.DeepEqual(activity.TargetRefs, want) {
				t.Fatalf("sources=%+v want=%+v", activity.TargetRefs, want)
			}
			payload := activity.Payload.(fltools.StructuredActivityPayload)
			if payload.Operation != action || len(payload.Rows) != 0 {
				t.Fatalf("payload=%+v", payload)
			}
			body, err := json.Marshal(activity)
			if err != nil {
				t.Fatal(err)
			}
			var restored fltools.ActivityPresentation
			if err := json.Unmarshal(body, &restored); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(restored.TargetRefs, want) {
				t.Fatalf("persisted sources=%+v", restored.TargetRefs)
			}
			public := publicActivityItem(observation.ActivityItem{ItemID: "activity", ToolID: "call", ToolName: "subagent_events", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess, Presentation: activity})
			if public.Presentation == nil || !reflect.DeepEqual(public.Presentation.TargetRefs, want) {
				t.Fatalf("public sources=%+v", public.Presentation)
			}
		})
	}
}

func TestParentEventActivityHistoricalCanonicalSources(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Reports", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"subagent_events", "report_to_parent"} {
		t.Run(name, func(t *testing.T) {
			data := map[string]any{"events": []any{map[string]any{"id": "event", "parent_thread_id": thread.ThreadID, "source_thread_id": "historical-child", "source_turn_id": "child-turn", "source_run_id": "child-run"}}}
			if name == "report_to_parent" {
				data = map[string]any{"accepted": true, "event_id": "event", "parent_thread_id": thread.ThreadID}
			}
			body, _ := json.Marshal(map[string]any{"status": "success", "data": data})
			record := threadquery.Record{Ref: "result", ThreadID: identity.ThreadID(thread.ThreadID), TurnID: "turn", RunID: "run", ToolCallID: "call", ToolName: name, Status: "success"}
			query := &fileTargetQueryRuntime{records: []threadquery.Record{record}, bodies: map[threadquery.RecordRef]string{"result": string(body)}}
			svc.threadRuntime = query
			item := flruntime.ThreadItem{ID: "item", Kind: flruntime.ThreadItemTool, TurnID: "turn", RunID: "run", Activity: &observation.ActivityItem{ItemID: "activity", ToolID: "call", ToolName: name, Status: observation.ActivityStatusSuccess, Presentation: &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererStructured, Label: "read", Payload: fltools.StructuredActivityPayload{}}}}
			before, _ := json.Marshal(item)
			got, err := svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, []flruntime.ThreadItem{item})
			if err != nil {
				t.Fatal(err)
			}
			if len(got[0].Activity.Presentation.TargetRefs) != 1 {
				t.Fatalf("missing canonical identity: %+v", got[0].Activity.Presentation)
			}
			after, _ := json.Marshal(item)
			if string(before) != string(after) {
				t.Fatal("canonical source mutated")
			}
			_, err = svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, got)
			if err != nil || query.queries != 1 || query.reads != 1 {
				t.Fatalf("hydrated twice: %v %+v", err, query)
			}
		})
	}
}

func TestParentReportActivityRequiresAcceptedReceipt(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "report_to_parent", Status: "success", Data: flruntime.ParentEventReceipt{Accepted: accepted, EventID: "parent-event:0123456789abcdef0123456789abcdef", ParentThreadID: "parent"}})
		if err != nil {
			t.Fatal(err)
		}
		if accepted {
			public := publicActivityItem(observation.ActivityItem{ItemID: "activity", ToolID: "call", ToolName: "report_to_parent", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess, Presentation: activity})
			if public.Presentation == nil || len(public.Presentation.TargetRefs) != 1 || public.Presentation.TargetRefs[0].ResourceRef != "parent-event:0123456789abcdef0123456789abcdef" {
				t.Fatalf("receipt lost in public projection: %+v", public)
			}
		}
		if (len(activity.TargetRefs) == 1) != accepted {
			t.Fatalf("accepted=%v refs=%+v", accepted, activity.TargetRefs)
		}
	}
}

func TestParentReportActivityPreservesCompleteInput(t *testing.T) {
	message := "  " + strings.Repeat("x", 8190)
	for _, result := range []bool{false, true} {
		activity := floretActivityForToolCall("report_to_parent", map[string]any{"message": message})
		if result {
			var err error
			activity, err = floretActivityForToolResult(nil, ToolResult{ToolName: "report_to_parent", Status: "success", activityInput: map[string]any{"message": message}})
			if err != nil {
				t.Fatal(err)
			}
		}
		rows := activity.Payload.(fltools.StructuredActivityPayload).Inputs
		if len(rows) != 1 || rows[0].Content != message || rows[0].Truncated {
			t.Fatal("complete submitted report was truncated")
		}
		if _, err := json.Marshal(activity); err != nil {
			t.Fatal(err)
		}
	}
}
