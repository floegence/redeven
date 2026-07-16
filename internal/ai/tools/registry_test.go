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
			toolName:            "terminal.exec",
			labelFields:         []string{"command"},
			callPayloadFields:   []string{"command", "yield_ms", "description"},
			resultPayloadFields: []string{"status", "process_id", "command", "exit_code", "duration_ms", "output", "execution_location", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"},
		},
		{
			toolName:            "terminal.read",
			labelFields:         []string{"description"},
			callPayloadFields:   []string{"process_id", "after_seq"},
			resultPayloadFields: []string{"status", "process_id", "command", "exit_code", "duration_ms", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"},
		},
		{
			toolName:            "terminal.terminate",
			labelFields:         []string{"description"},
			callPayloadFields:   []string{"process_id"},
			resultPayloadFields: []string{"status", "process_id", "terminated", "exit_code", "duration_ms", "output", "first_seq", "last_seq", "latest_seq", "total_bytes", "truncated"},
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
			toolName:            "okf.index",
			operation:           "okf.index",
			labelFields:         []string{"section"},
			callPayloadFields:   []string{"section"},
			callLabelFallback:   "OKF knowledge",
			resultLabelFallback: "OKF index",
			resultPayloadFields: []string{"okf_version", "total_sections", "sections", "truncated"},
		},
		{
			toolName:            "okf.search",
			operation:           "okf.search",
			labelFields:         []string{"query"},
			callPayloadFields:   []string{"query", "max_results", "type", "tags"},
			callLabelFallback:   "OKF knowledge",
			resultLabelFallback: "OKF knowledge",
			resultPayloadFields: []string{"query", "filters", "total_concepts", "total_matches", "match_count", "max_results", "has_more", "omitted_count", "matches", "truncated"},
		},
		{
			toolName:            "okf.open",
			operation:           "okf.open",
			labelFields:         []string{"concept_title", "concept_id", "path"},
			callPayloadFields:   []string{"concept_id", "path", "body_offset", "body_limit"},
			callLabelFallback:   "OKF concept",
			resultLabelFallback: "OKF concept",
			resultPayloadFields: []string{"concept_title", "concept", "body_offset", "body_length", "returned_body_length", "link_count", "backlink_count", "links", "backlinks", "truncated"},
		},
		{
			toolName:            "write_todos",
			callPayloadFields:   []string{"expected_version", "explanation"},
			callLabelFallback:   "Update todos",
			resultLabelFallback: "Update todos",
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
			callPayloadFields:   []string{"action", "task_name", "task_description", "agent_type", "context_mode", "target", "thread_id", "ids", "interrupt", "limit", "running_only"},
			resultPayloadFields: []string{"action", "status", "task_name", "task_description", "title", "agent_type", "context_mode", "accepted", "closed", "stopped", "closed_count", "stopped_count", "agent_count", "total", "running_only", "counts", "final_handoff_report", "progress_summary", "requested_count", "found_count", "missing_count", "items", "timed_out", "truncated", "omitted_count"},
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
