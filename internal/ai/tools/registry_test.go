package tools

import (
	"reflect"
	"testing"
)

func TestBuiltInDefinitions_AllHaveValidPresentationSpecs(t *testing.T) {
	t.Parallel()

	for name, def := range builtinDefinitions {
		if err := ValidatePresentationSpec(name, def.Presentation); err != nil {
			t.Fatalf("builtin %s presentation spec invalid: %v", name, err)
		}
		if def.Name != name {
			t.Fatalf("builtin key=%q has definition name=%q", name, def.Name)
		}
	}
}

func TestMustPresentationSpec_PanicsForUnknownTool(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatalf("MustPresentationSpec did not panic for unknown tool")
		}
	}()
	_ = MustPresentationSpec("unknown.tool")
}

func TestBuiltInPresentationSpecsCarryProjectionFacts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		toolName            string
		operation           string
		labelFields         []string
		callPayloadFields   []string
		callLabelFallback   string
		resultLabelFallback string
		resultPayloadFields []string
	}{
		{
			toolName:          "terminal.exec",
			labelFields:       []string{"command"},
			callPayloadFields: []string{"command", "timeout_ms", "description"},
		},
		{
			toolName:          "file.read",
			operation:         "read",
			labelFields:       []string{"display_name"},
			callPayloadFields: []string{"offset", "limit"},
		},
		{
			toolName:          "file.edit",
			operation:         "edit",
			labelFields:       []string{"display_name"},
			callPayloadFields: []string{"replace_all"},
		},
		{
			toolName:          "web.search",
			labelFields:       []string{"query"},
			callPayloadFields: []string{"query", "count", "provider"},
		},
		{
			toolName:            "okf.search",
			operation:           "okf.search",
			labelFields:         []string{"query"},
			callPayloadFields:   []string{"query", "count", "provider"},
			callLabelFallback:   "OKF knowledge",
			resultLabelFallback: "OKF knowledge",
		},
		{
			toolName:            "write_todos",
			callPayloadFields:   []string{"expected_version", "explanation"},
			callLabelFallback:   "Update todos",
			resultLabelFallback: "Update todos",
		},
		{
			toolName:            "exit_plan_mode",
			callLabelFallback:   "Exit plan mode",
			resultLabelFallback: "Exit plan mode",
			resultPayloadFields: []string{"summary", "allowed_prompts"},
		},
		{
			toolName:            "task_complete",
			callLabelFallback:   "Complete task",
			resultLabelFallback: "Complete task",
			resultPayloadFields: []string{"result", "evidence_refs", "remaining_risks", "next_actions"},
		},
		{
			toolName:            "ask_user",
			callLabelFallback:   "Ask user",
			resultLabelFallback: "Ask user",
			resultPayloadFields: []string{"reason_code", "required_from_user", "evidence_refs", "questions", "question"},
		},
		{
			toolName:          "use_skill",
			operation:         "use_skill",
			labelFields:       []string{"name"},
			callPayloadFields: []string{"name"},
		},
		{
			toolName:            "subagents",
			operation:           "subagents",
			labelFields:         []string{"task_name", "title", "action"},
			callPayloadFields:   []string{"action", "task_name", "agent_type", "target", "thread_id", "ids", "interrupt", "limit", "running_only"},
			resultPayloadFields: []string{"action", "status", "subagent_id", "thread_id", "task_id", "task_name", "title", "agent_type", "target", "target_ids", "ids", "accepted", "closed", "closed_count", "affected_ids", "agent_count", "total", "running_only", "queued", "running", "waiting_input", "completed", "failed", "canceled", "timed_out", "requested_ids", "requested_count", "found_count", "missing_count", "missing_ids", "snapshot", "subagent", "items", "subagents", "snapshots", "snapshots_by_id", "truncated"},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.toolName, func(t *testing.T) {
			t.Parallel()
			spec := MustPresentationSpec(tc.toolName)
			if spec.Operation != tc.operation {
				t.Fatalf("operation=%q, want %q", spec.Operation, tc.operation)
			}
			if !reflect.DeepEqual(spec.ActivityLabelFields, tc.labelFields) {
				t.Fatalf("label fields=%#v, want %#v", spec.ActivityLabelFields, tc.labelFields)
			}
			if !reflect.DeepEqual(spec.CallPayloadFields, tc.callPayloadFields) {
				t.Fatalf("call payload fields=%#v, want %#v", spec.CallPayloadFields, tc.callPayloadFields)
			}
			if tc.resultPayloadFields != nil && !reflect.DeepEqual(spec.ResultPayloadFields, tc.resultPayloadFields) {
				t.Fatalf("result payload fields=%#v, want %#v", spec.ResultPayloadFields, tc.resultPayloadFields)
			}
			if spec.CallLabelFallback != tc.callLabelFallback {
				t.Fatalf("call fallback=%q, want %q", spec.CallLabelFallback, tc.callLabelFallback)
			}
			if spec.ResultLabelFallback != tc.resultLabelFallback {
				t.Fatalf("result fallback=%q, want %q", spec.ResultLabelFallback, tc.resultLabelFallback)
			}
		})
	}
}
