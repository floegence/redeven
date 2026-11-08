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

func redaction(value ToolRedactionSpec) presentationOption {
	return func(spec *ToolPresentationSpec) { spec.Redaction = value }
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
	"thread_query": {Name: "thread_query", Presentation: withPresentationOptions(presentation(ToolPresentationResearch, "readonly", "structured", "research"), operation("thread_query"))},
	"thread_read":  {Name: "thread_read", Presentation: withPresentationOptions(presentation(ToolPresentationResearch, "readonly", "structured", "research"), operation("thread_read"))},
	// Historical presentation only; this tool is no longer registered for execution.
	"threads.aggregate":         {Name: "threads.aggregate", Presentation: withPresentationOptions(presentation(ToolPresentationResearch, "readonly", "structured", "research"), operation("threads.aggregate"))},
	"plugin_author_get_status":  {Name: "plugin_author_get_status", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "plugin_author", "args", "result"), operation("status"))},
	"plugin_author_initialize":  {Name: "plugin_author_initialize", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "plugin_author", "args", "result"), operation("initialize"))},
	"plugin_author_build":       {Name: "plugin_author_build", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "plugin_author", "args", "result"), operation("build"))},
	"plugin_author_capture":     {Name: "plugin_author_capture", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "plugin_author", "args", "result"), operation("capture"))},
	"plugin_author_rename":      {Name: "plugin_author_rename", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "plugin_author", "args", "result"), operation("rename"))},
	"tessiven_list_runtimes":    {Name: "tessiven_list_runtimes", Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("runtimes"))},
	"tessiven_inspect_runtime":  {Name: "tessiven_inspect_runtime", Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("runtime.inspect"))},
	"tessiven_manage_runtime":   {Name: "tessiven_manage_runtime", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "tessiven", "args", "result"), operation("runtime.action"))},
	"tessiven_read_schema":      {Name: "tessiven_read_schema", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("schema"), labelFields("title", "summary"))},
	"tessiven_list_canvases":    {Name: "tessiven_list_canvases", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("list"), labelFields("title", "summary"))},
	"tessiven_read_canvas":      {Name: "tessiven_read_canvas", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("read"), labelFields("title"), resultPayloadFields("title", "version", "start_line", "end_line", "total_lines", "has_more"))},
	"tessiven_search_canvas":    {Name: "tessiven_search_canvas", Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("search"), labelFields("title"), callPayloadFields("query"), resultPayloadFields("title", "version", "next_line"))},
	"tessiven_edit_canvas":      {Name: "tessiven_edit_canvas", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "tessiven", "args", "result"), operation("edit"), labelFields("title", "summary"), callPayloadFields("summary", "edits"), resultPayloadFields("title", "version", "summary", "canvas_url"))},
	"tessiven_list_versions":    {Name: "tessiven_list_versions", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("versions"), labelFields("title", "summary"))},
	"tessiven_validate_canvas":  {Name: "tessiven_validate_canvas", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("validate"), resultPayloadFields("valid"))},
	"tessiven_save_canvas":      {Name: "tessiven_save_canvas", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "tessiven", "args", "result"), operation("save"), labelFields("title", "summary"), callPayloadFields("summary", "document_yaml"), resultPayloadFields("title", "version", "summary", "canvas_url"))},
	"tessiven_inspect_resource": {Name: "tessiven_inspect_resource", Mutating: false, RequiresApproval: false, Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "tessiven", "args", "result"), operation("inspect"), labelFields("title", "summary"))},
	"tessiven_manage_instance":  {Name: "tessiven_manage_instance", Mutating: true, RequiresApproval: true, Presentation: withPresentationOptions(presentation(ToolPresentationMutation, "approval", "structured", "tessiven", "args", "result"), operation("action"), labelFields("title", "summary"))},
	"computer_list_targets": {
		Name: "computer_list_targets", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "computer", "computer", "args", "result"), operation("discover"), resultPayloadFields("current_target_id", "default_candidate_ref", "candidates")),
	},
	"computer_select_target": {
		Name: "computer_select_target", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("select"), resultPayloadFields("target_id", "target_name", "target_kind")),
	},
	"computer_observe": {
		Name: "computer_observe", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "computer", "computer", "args", "result"), operation("observe"), labelFields("target_name", "target_id"), callPayloadFields("root_ref", "limit", "screenshot"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_exec": {
		Name: "computer_exec", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("execute"), labelFields("description", "target_name"), callPayloadFields("description", "code"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "completed_actions", "operations", "script_error", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_capture_screenshot": {
		Name: "computer_capture_screenshot", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "computer", "computer", "args", "result"), operation("screenshot"), labelFields("target_name", "target_id"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "before_frame", "after_frame", "screenshot"), chipFields("target_name", "execution_location")),
	},
	"computer_click": {
		Name: "computer_click", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("click"), labelFields("target_name", "target_id"), callPayloadFields("x", "y"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_double_click": {
		Name: "computer_double_click", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("double_click"), labelFields("target_name", "target_id"), callPayloadFields("x", "y"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_type_text": {
		Name: "computer_type_text", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("type"), labelFields("target_name", "target_id"), callPayloadFields("text"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location"), redaction(ToolRedactionSpec{ArgFields: []string{"text"}})),
	},
	"computer_press_key": {
		Name: "computer_press_key", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("key"), labelFields("target_name", "target_id"), callPayloadFields("key"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_scroll": {
		Name: "computer_scroll", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("scroll"), labelFields("target_name", "target_id"), callPayloadFields("x", "y", "delta_x", "delta_y"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_drag": {
		Name: "computer_drag", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "computer", "computer", "args", "result"), operation("drag"), labelFields("target_name", "target_id"), callPayloadFields("from_x", "from_y", "to_x", "to_y", "duration_ms"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"computer_wait": {
		Name: "computer_wait", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "readonly", "computer", "computer", "args", "result"), operation("wait"), labelFields("target_name", "target_id"), callPayloadFields("milliseconds"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"browser_navigate": {
		Name: "browser_navigate", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "browser", "browser", "args", "result"), operation("navigate"), labelFields("target_name", "target_id", "url"), callPayloadFields("url"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "url", "after_frame"), chipFields("target_name", "execution_location"), redaction(ToolRedactionSpec{ArgFields: []string{"url"}})),
	},
	"browser_go_back": {
		Name: "browser_go_back", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "browser", "browser", "args", "result"), operation("back"), labelFields("target_name", "target_id"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"browser_reload": {
		Name: "browser_reload", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(presentation(ToolPresentationInteraction, "approval", "browser", "browser", "args", "result"), operation("reload"), labelFields("target_name", "target_id"), resultPayloadFields("target_id", "target_name", "execution_location", "action_summary", "safety", "after_frame"), chipFields("target_name", "execution_location")),
	},
	"image_read": {
		Name: "image_read", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
			operation("read"), labelFields("display_name"),
			resultPayloadFields("display_name", "mime_type", "width", "height", "size_bytes", "first_frame"),
		),
	},
	"attachment_materialize": {
		Name: "attachment_materialize", Mutating: true, RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "write", "file", "context", "args", "result"),
			operation("write"), labelFields("display_name", "locator"), callPayloadFields("locator"),
			resultPayloadFields("file_path", "display_name", "mime_type", "size_bytes"),
		),
	},
	"attachment_read": {
		Name:             "attachment_read",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "file", "context", "args", "result"),
			operation("read"),
			labelFields("name", "locator"),
			callPayloadFields("locator", "max_bytes", "max_lines"),
			resultPayloadFields("name", "content", "start_byte", "end_byte_exclusive", "start_line", "end_line", "starts_mid_line", "ends_mid_line", "truncated"),
			chipFields("operation", "name", "truncated"),
		),
	},
	"file_read": {
		Name:             "file_read",
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
	"file_read_many": {
		Name:             "file_read_many",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
			operation("file_read_many"),
			callPayloadFields("paths", "limit"),
			resultPayloadFields("files", "summary", "truncated"),
			chipFields("operation", "file_count", "truncated"),
		),
	},
	"file_search": {
		Name:             "file_search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "args", "result"),
			operation("file_search"),
			labelFields("query"),
			callPayloadFields("query", "paths", "glob", "max_matches", "context_lines"),
			resultPayloadFields("query", "matches", "truncated"),
			chipFields("operation", "match_count", "truncated"),
		),
	},
	"path_find": {
		Name:             "path_find",
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
			presentation(ToolPresentationResearch, "readonly", "web_fetch", "research", "web_fetch", "error"),
			operation("web_fetch"),
			labelFields("url"),
			callPayloadFields("url", "format"),
			resultPayloadFields("url", "final_url", "status_code", "content_type", "format", "bytes_read", "truncated"),
			chipFields("operation", "status_code", "content_type", "format", "bytes_read", "truncated"),
		),
	},
	"file_present": {
		Name:         "file_present",
		Presentation: withPresentationOptions(presentation(ToolPresentationContext, "readonly", "structured", "file_delivery", "result", "error"), operation("present"), labelFields("title"), resultPayloadFields("title", "name", "mime", "size", "sha256", "endpoint_id")),
	},
	"file_write": {
		Name:             "file_write",
		Mutating:         true,
		RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationMutation, "approval", "file", "mutation", "args", "result", "error"),
			operation("write"),
			labelFields("display_name"),
			resultPayloadFields("display_name", "change_type", "additions", "deletions", "truncated", "unified_diff", "diff_unavailable_reason"),
			chipFields("truncated"),
		),
	},
	"file_apply_patch": {
		Name:             "file_apply_patch",
		Mutating:         true,
		RequiresApproval: true,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationMutation, "approval", "patch", "mutation", "args", "result", "error"),
			operation("file_apply_patch"),
			callPayloadFields("files_changed", "hunks", "additions", "deletions"),
			resultPayloadFields("files_changed", "hunks", "additions", "deletions", "input_format", "normalized_format", "mutations", "truncated"),
			chipFields("truncated"),
		),
	},
	"terminal_exec": {
		Name:             "terminal_exec",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			operation("exec"),
			labelFields("description"),
			resultFallback(""),
			callPayloadFields("command", "yield_ms", "description"),
			resultPayloadFields("status", "process_id", "command", "description", "exit_code", "duration_ms", "target_id", "execution_location", "timed_out", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"),
			chipFields("target_id", "execution_location", "process_id", "exit_code", "duration_ms", "truncated"),
		),
	},
	"terminal_read": {
		Name:             "terminal_read",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			operation("read"),
			labelFields("description"),
			callPayloadFields("process_id", "command", "after_seq", "description"),
			resultPayloadFields("status", "process_id", "command", "description", "exit_code", "duration_ms", "target_id", "execution_location", "timed_out", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated"),
			chipFields("target_id", "execution_location", "process_id", "last_seq", "truncated"),
		),
	},
	"terminal_write": {
		Name:             "terminal_write",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
			operation("write"),
			labelFields("description"),
			callPayloadFields("process_id", "command", "description"),
			resultPayloadFields("status", "process_id", "command", "description", "exit_code", "duration_ms", "target_id", "execution_location", "timed_out", "input_bytes"),
			chipFields("target_id", "execution_location", "process_id", "input_bytes"),
		),
	},
	"terminal_terminate": {
		Name:             "terminal_terminate",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationCommand, "approval", "terminal", "terminal", "terminal", "error"),
			operation("terminate"),
			labelFields("description"),
			callPayloadFields("process_id", "command", "description"),
			resultPayloadFields("status", "process_id", "command", "description", "exit_code", "duration_ms", "target_id", "execution_location", "timed_out", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "truncated", "terminated"),
			chipFields("target_id", "execution_location", "process_id", "terminated"),
		),
	},
	"web_search_pages": {
		Name:             "web_search_pages",
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
	"source_list": {
		Name:             "source_list",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_search"),
			labelFields("query"),
			resultPayloadFields("query", "sources", "truncated"),
			chipFields("source_count", "truncated"),
		),
	},
	"okf_get_index": {
		Name:             "okf_get_index",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf_get_index"),
			labelFields("section"),
			callFallback("OKF knowledge"),
			resultFallback("OKF index"),
			callPayloadFields("section"),
			resultPayloadFields("okf_version", "total_sections", "sections", "truncated"),
			chipFields("total_sections", "truncated"),
		),
	},
	"okf_search": {
		Name:             "okf_search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf_search"),
			labelFields("query"),
			callFallback("OKF knowledge"),
			resultFallback("OKF knowledge"),
			callPayloadFields("query", "max_results", "type", "tags"),
			resultPayloadFields("query", "filters", "total_concepts", "total_matches", "match_count", "max_results", "has_more", "omitted_count", "matches", "truncated"),
			chipFields("match_count", "total_matches", "has_more", "truncated"),
		),
	},
	"okf_open": {
		Name:             "okf_open",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
			operation("okf_open"),
			labelFields("concept_title", "concept_id", "path"),
			callFallback("OKF concept"),
			resultFallback("OKF concept"),
			callPayloadFields("concept_id", "path", "section", "include_evidence", "body_offset", "body_limit"),
			resultPayloadFields("concept_title", "concept", "summary", "section_id", "section_title", "sections", "evidence", "evidence_omitted", "body", "body_offset", "body_length", "returned_body_length", "concept_body_length", "link_count", "backlink_count", "links", "backlinks", "truncated"),
			chipFields("link_count", "backlink_count", "truncated"),
		),
	},
	"todo_write": {
		Name:             "todo_write",
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
	"user_ask": {
		Name:             "user_ask",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationInteraction, "blocking", "question", "interaction", "args", "result"),
			callFallback("Ask user"),
			resultFallback("Ask user"),
			resultPayloadFields("reason_code", "required_from_user", "evidence_refs", "questions", "question"),
		),
	},
	"skill_use": {
		Name:             "skill_use",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
			operation("skill_use"),
			labelFields("name"),
			callPayloadFields("name", "reason"),
			resultPayloadFields("name", "reason", "content", "truncated"),
			chipFields("truncated"),
		),
	},
	"subagent_report": {
		Name: "subagent_report", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationDelegation, "readonly", "structured", "delegation", "args", "result", "error"), operation("subagent_report"), callPayloadFields("message"), resultPayloadFields("accepted", "event_id", "parent_thread_id")),
	},
	"subagent_read_events": {
		Name: "subagent_read_events", Mutating: false, RequiresApproval: false,
		Presentation: withPresentationOptions(presentation(ToolPresentationDelegation, "readonly", "structured", "delegation", "args", "result", "error"), operation("subagent_read_events"), labelFields("action"), callPayloadFields("action", "event_id", "first_event_id", "last_event_id", "after_event_id", "limit"), resultPayloadFields("events", "first_event_id", "last_event_id", "next_after_event_id")),
	},
	"subagent_manage": {
		Name:             "subagent_manage",
		Mutating:         false,
		RequiresApproval: false,
		Presentation: withPresentationOptions(
			presentation(ToolPresentationDelegation, "readonly", "subagent_operation", "delegation", "args", "result", "error"),
			operation("subagents"),
			labelFields("task_name", "action"),
			callPayloadFields("action", "task_name", "task_description", "context_mode", "target", "thread_id", "ids", "limit", "running_only"),
			resultPayloadFields("action", "status", "task_name", "task_description", "context_mode", "target", "thread_id", "ids", "target_ids", "requested_ids", "affected_ids", "accepted", "closed", "stopped", "closed_count", "stopped_count", "agent_count", "total", "running_only", "counts", "requested_count", "found_count", "missing_count", "items", "timed_out"),
			chipFields("action", "status", "agent_count", "total", "timed_out", "closed_count"),
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
	if name == "terminal_exec" {
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	if name == "subagent_manage" {
		return false
	}
	return RequiresApproval(name)
}

func IsMutatingForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal_exec" {
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	if name == "subagent_manage" {
		return false
	}
	return IsMutating(name)
}

func IsDangerousInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name != "terminal_exec" {
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
	if name != "terminal_exec" {
		return TerminalCommandProfile{}
	}
	command := commandFromArgs(args)
	return ProfileTerminalCommand(command)
}

func InvocationRiskInfo(toolName string, args map[string]any) (string, string) {
	if strings.TrimSpace(toolName) == "subagent_manage" {
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
