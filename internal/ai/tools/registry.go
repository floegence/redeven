package tools

import (
	"fmt"
	"strings"
)

type presentationOption func(*ToolPresentationSpec)

func presentation(kind ToolPresentationKind, risk string, renderer string, groupKey string, detailKinds ...string) ToolPresentationSpec {
	spec := ToolPresentationSpec{
		Kind:     kind,
		Risk:     strings.TrimSpace(risk),
		Renderer: strings.TrimSpace(renderer),
		Grouping: ToolGroupingPolicy{
			Enabled:        strings.TrimSpace(groupKey) != "",
			GroupKey:       strings.TrimSpace(groupKey),
			MergeWindowMS:  2500,
			MaxInlineItems: 4,
		},
		DetailKinds:    append([]string(nil), detailKinds...),
		SummaryVersion: 1,
	}
	return spec
}

func withPresentationOptions(spec ToolPresentationSpec, options ...presentationOption) ToolPresentationSpec {
	for _, option := range options {
		if option != nil {
			option(&spec)
		}
	}
	return spec
}

func operation(value string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.Operation = strings.TrimSpace(value)
	}
}

func labelFields(fields ...string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.ActivityLabelFields = cleanStringList(fields)
	}
}

func callPayloadFields(fields ...string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.CallPayloadFields = cleanStringList(fields)
	}
}

func resultPayloadFields(fields ...string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.ResultPayloadFields = cleanStringList(fields)
	}
}

func chipFields(fields ...string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.ChipFields = cleanStringList(fields)
	}
}

func callFallback(value string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.CallLabelFallback = strings.TrimSpace(value)
	}
}

func resultFallback(value string) presentationOption {
	return func(spec *ToolPresentationSpec) {
		spec.ResultLabelFallback = strings.TrimSpace(value)
	}
}

func cleanStringList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

var builtinDefinitions = map[string]Definition{
	"file.read": {
		Name:             "file.read",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "file", "context", "args", "result"),
			operation("read"),
			labelFields("display_name"),
			callPayloadFields("offset", "limit"),
			resultPayloadFields("display_name", "file_action_id", "content", "line_offset", "line_count", "total_lines", "truncated"),
			chipFields("operation", "display_name", "truncated"),
		),
	},
	"read_file": {
		Name:             "read_file",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "file", "context", "args", "result"),
			operation("read"),
			labelFields("display_name", "path"),
			callPayloadFields("path", "offset", "limit"),
			resultPayloadFields("display_name", "path", "content", "line_offset", "line_count", "total_lines", "truncated"),
			chipFields("operation", "display_name", "path", "truncated"),
		),
	},
	"read_files": {
		Name:             "read_files",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "file", "context", "args", "result"),
			operation("read_files"),
			callPayloadFields("paths", "limit"),
			resultPayloadFields("files", "summary", "truncated"),
			chipFields("operation", "file_count", "truncated"),
		),
	},
	"rgrep": {
		Name:             "rgrep",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "args", "result"),
			operation("rgrep"),
			labelFields("query"),
			callPayloadFields("query", "paths", "glob", "max_matches", "context_lines"),
			resultPayloadFields("query", "matches", "truncated"),
			chipFields("operation", "match_count", "truncated"),
		),
	},
	"find": {
		Name:             "find",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
			operation("find"),
			labelFields("root", "name"),
			callPayloadFields("root", "name", "type", "max_results", "max_depth"),
			resultPayloadFields("root", "results", "truncated"),
			chipFields("operation", "result_count", "truncated"),
		),
	},
	"web_fetch": {
		Name:             "web_fetch",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_fetch", "args"),
			operation("web_fetch"),
			labelFields("url"),
			callPayloadFields("url", "format", "timeout_seconds"),
			resultPayloadFields("url", "final_url", "content_type", "body", "truncated"),
			chipFields("operation", "content_type", "truncated"),
		),
	},
	"file.edit": {
		Name:             "file.edit",
		Mutating:         true,
		RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationMutation, "approval", "file", "mutation", "args", "result", "error"),
			operation("edit"),
			labelFields("display_name"),
			callPayloadFields("replace_all"),
			resultPayloadFields("display_name", "file_action_id", "change_type", "additions", "deletions", "truncated", "unified_diff"),
			chipFields("operation", "display_name", "change_type", "truncated"),
		),
	},
	"file.write": {
		Name:             "file.write",
		Mutating:         true,
		RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationMutation, "approval", "file", "mutation", "args", "result", "error"),
			operation("write"),
			labelFields("display_name"),
			resultPayloadFields("display_name", "file_action_id", "change_type", "additions", "deletions", "truncated", "unified_diff"),
			chipFields("operation", "display_name", "change_type", "truncated"),
		),
	},
	"apply_patch": {
		Name:             "apply_patch",
		Mutating:         true,
		RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationMutation, "approval", "patch", "mutation", "args", "result", "error"),
			operation("apply_patch"),
			callPayloadFields("files_changed", "hunks", "additions", "deletions"),
			resultPayloadFields("files_changed", "hunks", "additions", "deletions", "input_format", "normalized_format", "mutations", "truncated"),
			chipFields("operation", "files_changed", "additions", "deletions", "truncated"),
		),
	},
	"terminal.exec": {
		Name:             "terminal.exec",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			labelFields("command"),
			resultFallback(""),
			callPayloadFields("command", "yield_ms", "description"),
			resultPayloadFields("status", "process_id", "command", "exit_code", "duration_ms", "output", "execution_location", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"),
			chipFields("execution_location", "process_id", "exit_code", "duration_ms", "truncated"),
		),
	},
	"terminal.read": {
		Name:             "terminal.read",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			labelFields("description"),
			callPayloadFields("process_id", "after_seq"),
			resultPayloadFields("status", "process_id", "command", "exit_code", "duration_ms", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"),
			chipFields("process_id", "last_seq", "truncated"),
		),
	},
	"terminal.write": {
		Name:             "terminal.write",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			labelFields("process_id"),
			resultFallback("terminal.write"),
			callPayloadFields("process_id"),
			resultPayloadFields("status", "process_id", "input_bytes", "last_seq", "truncated"),
			chipFields("process_id", "input_bytes"),
		),
	},
	"terminal.terminate": {
		Name:             "terminal.terminate",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "approval", "terminal", "terminal", "terminal", "error"),
			labelFields("description"),
			callPayloadFields("process_id"),
			resultPayloadFields("status", "process_id", "terminated", "exit_code", "duration_ms", "output", "first_seq", "last_seq", "latest_seq", "total_bytes", "truncated"),
			chipFields("process_id", "terminated"),
		),
	},
	"web.search": {
		Name:             "web.search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_search", "args"),
			labelFields("query"),
			callPayloadFields("query", "count", "provider"),
			resultPayloadFields("query", "provider", "results", "sources", "truncated"),
			chipFields("provider", "results_count", "source_count", "truncated"),
		),
	},
	"sources": {
		Name:             "sources",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_search"),
			labelFields("query"),
			resultPayloadFields("query", "sources", "truncated"),
			chipFields("source_count", "truncated"),
		),
	},
	"okf.index": {
		Name:             "okf.index",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf.index"),
			labelFields("section"),
			callFallback("OKF knowledge"),
			resultFallback("OKF index"),
			callPayloadFields("section"),
			resultPayloadFields("okf_version", "total_sections", "sections", "truncated"),
			chipFields("total_sections", "truncated"),
		),
	},
	"okf.search": {
		Name:             "okf.search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf.search"),
			labelFields("query"),
			callFallback("OKF knowledge"),
			resultFallback("OKF knowledge"),
			callPayloadFields("query", "max_results", "type", "tags"),
			resultPayloadFields("query", "filters", "total_concepts", "total_matches", "match_count", "max_results", "has_more", "omitted_count", "matches", "truncated"),
			chipFields("match_count", "total_matches", "has_more", "truncated"),
		),
	},
	"okf.open": {
		Name:             "okf.open",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf.open"),
			labelFields("concept_title", "concept_id", "path"),
			callFallback("OKF concept"),
			resultFallback("OKF concept"),
			callPayloadFields("concept_id", "path", "section", "include_evidence", "body_offset", "body_limit"),
			resultPayloadFields("concept_title", "concept", "summary", "section_id", "section_title", "sections", "evidence", "evidence_omitted", "body_offset", "body_length", "returned_body_length", "concept_body_length", "link_count", "backlink_count", "links", "backlinks", "truncated"),
			chipFields("link_count", "backlink_count", "truncated"),
		),
	},
	"write_todos": {
		Name:             "write_todos",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationTodo, "readonly", "todos", "todo", "result"),
			callPayloadFields("expected_version", "explanation"),
			callFallback("Update todos"),
			resultFallback("Update todos"),
			resultPayloadFields("version", "summary", "todos", "truncated"),
			chipFields("total", "pending", "in_progress", "completed", "cancelled", "truncated"),
		),
	},
	"task_complete": {
		Name:             "task_complete",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationSignal, "blocking", "completion", "interaction", "args", "result"),
			callFallback("Complete task"),
			resultFallback("Complete task"),
			resultPayloadFields("result", "evidence_refs", "remaining_risks", "next_actions"),
		),
	},
	"ask_user": {
		Name:             "ask_user",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationInteraction, "blocking", "question", "interaction", "args", "result"),
			callFallback("Ask user"),
			resultFallback("Ask user"),
			resultPayloadFields("reason_code", "required_from_user", "evidence_refs", "questions", "question"),
		),
	},
	"use_skill": {
		Name:             "use_skill",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
			operation("use_skill"),
			labelFields("name"),
			callPayloadFields("name"),
			resultPayloadFields("name", "skill", "instructions", "truncated"),
			chipFields("name", "truncated"),
		),
	},
	"subagents": {
		Name:             "subagents",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationDelegation, "readonly", "structured", "delegation", "args", "result", "error"),
			operation("subagents"),
			labelFields("task_name", "title", "action"),
			callPayloadFields("action", "task_name", "task_description", "agent_type", "context_mode", "target", "thread_id", "ids", "interrupt", "limit", "running_only"),
			resultPayloadFields("action", "status", "task_name", "task_description", "title", "agent_type", "context_mode", "accepted", "closed", "stopped", "closed_count", "stopped_count", "agent_count", "total", "running_only", "counts", "final_handoff_report", "progress_summary", "requested_count", "found_count", "missing_count", "items", "timed_out", "truncated", "omitted_count"),
			chipFields("action", "agent_type", "status", "agent_count", "total", "timed_out", "closed_count", "truncated"),
		),
	},
}

func LookupDefinition(toolName string) (Definition, bool) {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return Definition{}, false
	}
	def, ok := builtinDefinitions[name]
	if !ok {
		return Definition{}, false
	}
	return def, true
}

func RequiresApproval(toolName string) bool {
	def, ok := LookupDefinition(toolName)
	return ok && def.RequiresApproval
}

func IsMutating(toolName string) bool {
	def, ok := LookupDefinition(toolName)
	return ok && def.Mutating
}

func PresentationSpec(toolName string) (ToolPresentationSpec, bool) {
	def, ok := LookupDefinition(toolName)
	if !ok || ValidatePresentationSpec(toolName, def.Presentation) != nil {
		return ToolPresentationSpec{}, false
	}
	return def.Presentation, true
}

func MustPresentationSpec(toolName string) ToolPresentationSpec {
	spec, ok := PresentationSpec(toolName)
	if !ok {
		panic(fmt.Sprintf("missing presentation spec for tool %q", strings.TrimSpace(toolName)))
	}
	return spec
}

func ValidatePresentationSpec(toolName string, spec ToolPresentationSpec) error {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if spec.Kind == "" {
		return fmt.Errorf("tool %s missing presentation kind", name)
	}
	if strings.TrimSpace(spec.Renderer) == "" {
		return fmt.Errorf("tool %s missing presentation renderer", name)
	}
	if strings.TrimSpace(spec.Grouping.GroupKey) == "" {
		return fmt.Errorf("tool %s missing presentation group key", name)
	}
	if spec.SummaryVersion <= 0 {
		return fmt.Errorf("tool %s missing presentation summary version", name)
	}
	return nil
}

func RequiresApprovalForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal.exec" {
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	if name == "subagents" {
		return false
	}
	return RequiresApproval(name)
}

func IsMutatingForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal.exec" {
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	if name == "subagents" {
		return false
	}
	return IsMutating(name)
}

func IsDangerousInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return false
	}
	profile := InvocationCommandProfile(name, args)
	return profile.Risk == TerminalCommandRiskDangerous
}

func InvocationRiskLabel(toolName string, args map[string]any) string {
	risk, _ := InvocationRiskInfo(toolName, args)
	return risk
}

func InvocationCommandProfile(toolName string, args map[string]any) TerminalCommandProfile {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return TerminalCommandProfile{}
	}
	command := commandFromArgs(args)
	return ProfileTerminalCommand(command)
}

func InvocationRiskInfo(toolName string, args map[string]any) (string, string) {
	if strings.TrimSpace(toolName) == "subagents" {
		return "delegation", subagentInvocationAction(args)
	}
	profile := InvocationCommandProfile(toolName, args)
	if profile.Risk == "" {
		return "", ""
	}
	return string(profile.Risk), profile.NormalizedCommand
}

func subagentInvocationAction(args map[string]any) string {
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(args["action"])))
}
