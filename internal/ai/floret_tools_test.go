package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
)

func mustFloretToolResultActivity(t *testing.T, r *run, result ToolResult) *observation.ActivityPresentation {
	t.Helper()
	activity, err := floretActivityForToolResult(r, result)
	if err != nil {
		t.Fatalf("floretActivityForToolResult: %v", err)
	}
	if activity == nil {
		t.Fatal("activity is nil")
	}
	return activity
}

func TestFloretHostLabelsExcludeTargetContext(t *testing.T) {
	r := newRun(runOptions{
		EndpointID:       "env_1",
		ToolTargetPolicy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
	})
	labels := floretHostLabelsForRun(r)
	if labels["endpoint_id"] != "env_1" || labels["engine"] != "redeven" {
		t.Fatalf("base labels = %#v", labels)
	}
	for _, key := range []string{"target_id", "current_target_id", "primary_target_id"} {
		if _, ok := labels[key]; ok {
			t.Fatalf("Floret host labels must not include Redeven target key %q: %#v", key, labels)
		}
	}
}

func TestFloretToolDefinitionStripsRedevenTargetSchema(t *testing.T) {
	def, err := floretToolDefinition(ToolDef{
		Name: "terminal.exec",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"target_id":{"type":"string"},"command":{"type":"string"}},"required":["target_id","command"],"additionalProperties":false}`,
		),
	})
	if err != nil {
		t.Fatalf("floretToolDefinition: %v", err)
	}

	properties, ok := def.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("properties=%#v, want object", def.InputSchema["properties"])
	}
	if _, ok := properties["target_id"]; ok {
		t.Fatalf("Floret tool schema must not expose Redeven target_id: %#v", properties)
	}
	required, ok := def.InputSchema["required"].([]any)
	if !ok {
		t.Fatalf("required=%#v, want array", def.InputSchema["required"])
	}
	if containsAnyString(required, "target_id") || !containsAnyString(required, "command") {
		t.Fatalf("schema required fields changed: %#v", required)
	}
	if def.Permission.Mode != fltools.PermissionAllow {
		t.Fatalf("permission=%q, want allow because Redeven owns tool authorization", def.Permission.Mode)
	}
}

func TestFloretToolDefinitionRejectsInvalidSchema(t *testing.T) {
	t.Parallel()

	_, err := floretToolDefinition(ToolDef{
		Name:        "terminal.exec",
		InputSchema: json.RawMessage(`{"type":"object"`),
	})
	if err == nil || !strings.Contains(err.Error(), "invalid input schema") {
		t.Fatalf("error=%v, want invalid input schema", err)
	}
}

func TestFloretActivityForTerminalCallUsesCommandAsLabel(t *testing.T) {
	t.Parallel()

	activity := floretActivityForToolCall("terminal.exec", map[string]any{
		"command":    "npm run build -- --mode production",
		"cwd":        "/workspace/app",
		"timeout_ms": 120000,
		"stdin":      "secret\nvalue",
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if activity.Label != "npm run build -- --mode production" {
		t.Fatalf("label=%q, want command", activity.Label)
	}
	if activity.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("renderer=%q, want terminal", activity.Renderer)
	}
	if activity.Payload["command"] != "npm run build -- --mode production" {
		t.Fatalf("payload=%#v, want command", activity.Payload)
	}
	if _, ok := activity.Payload["cwd"]; ok {
		t.Fatalf("terminal activity payload must not include cwd: %#v", activity.Payload)
	}
	if _, ok := activity.Payload["workdir"]; ok {
		t.Fatalf("terminal activity payload must not include workdir: %#v", activity.Payload)
	}
	if _, ok := activity.Payload["stdin"]; ok {
		t.Fatalf("terminal activity payload must not include stdin: %#v", activity.Payload)
	}
}

func TestFloretActivityForTerminalCallTrimsLabelToContract(t *testing.T) {
	t.Parallel()

	longCommand := "printf " + strings.Repeat("x", 260)
	activity := floretActivityForToolCall("terminal.exec", map[string]any{
		"command": longCommand,
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if len([]rune(activity.Label)) > activityPresentationLabelLimit {
		t.Fatalf("label length=%d, want <= %d", len([]rune(activity.Label)), activityPresentationLabelLimit)
	}
	if !strings.HasSuffix(activity.Label, "...") {
		t.Fatalf("label=%q, want truncated suffix", activity.Label)
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_1"}, []observation.Event{{
		Type:     observation.EventTypeToolCall,
		ToolID:   "tool_long",
		ToolName: "terminal.exec",
		Activity: activity,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestFloretActivityForFileCallsOmitsSensitiveEditAndWriteBodies(t *testing.T) {
	t.Parallel()

	edit := floretActivityForToolCall("file.edit", map[string]any{
		"file_path":   "internal/ai/run.go",
		"old_string":  "secret old text",
		"new_string":  "secret new text",
		"replace_all": true,
	})
	if edit == nil {
		t.Fatal("edit activity is nil")
	}
	if edit.Payload["operation"] != "edit" || edit.Payload["display_name"] != "run.go" || edit.Payload["replace_all"] != true {
		t.Fatalf("edit payload=%#v", edit.Payload)
	}
	if _, ok := edit.Payload["file_path"]; ok {
		t.Fatalf("edit activity payload must not include file_path: %#v", edit.Payload)
	}
	if _, ok := edit.Payload["old_string"]; ok {
		t.Fatalf("edit activity payload must not include old_string: %#v", edit.Payload)
	}
	if _, ok := edit.Payload["new_string"]; ok {
		t.Fatalf("edit activity payload must not include new_string: %#v", edit.Payload)
	}

	write := floretActivityForToolCall("file.write", map[string]any{
		"file_path":    "internal/ai/run.go",
		"content_utf8": "secret body",
	})
	if write == nil {
		t.Fatal("write activity is nil")
	}
	if write.Payload["operation"] != "write" || write.Payload["display_name"] != "run.go" {
		t.Fatalf("write payload=%#v", write.Payload)
	}
	if _, ok := write.Payload["file_path"]; ok {
		t.Fatalf("write activity payload must not include file_path: %#v", write.Payload)
	}
	if _, ok := write.Payload["content_utf8"]; ok {
		t.Fatalf("write activity payload must not include content_utf8: %#v", write.Payload)
	}
	if _, ok := write.Payload["content"]; ok {
		t.Fatalf("write activity payload must not include content: %#v", write.Payload)
	}
}

func TestFloretActivityForFileCallKeepsDisplayNameWithinContract(t *testing.T) {
	t.Parallel()

	longName := strings.Repeat("x", activityPayloadStringLimit+200) + ".txt"
	activity := floretActivityForToolCall("file.read", map[string]any{
		"file_path": "/workspace/" + longName,
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	assertContractSafeActivityPayload(t, activity.Payload, 0)
	if len([]rune(anyToString(activity.Payload["display_name"]))) > activityPayloadStringLimit {
		t.Fatalf("display_name length=%d exceeds contract", len([]rune(anyToString(activity.Payload["display_name"]))))
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_long_display_name"}, []observation.Event{{
		Type:     observation.EventTypeToolCall,
		ToolID:   "tool_long_display_name",
		ToolName: "file.read",
		Activity: activity,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestFloretActivityForApplyPatchCallOmitsPatchBody(t *testing.T) {
	t.Parallel()

	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Update File: internal/ai/run.go",
		"@@",
		"-old",
		"+new",
		"*** End Patch",
	}, "\n")
	activity := floretActivityForToolCall("apply_patch", map[string]any{"patch": patch})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if activity.Renderer != observation.ActivityRendererPatch {
		t.Fatalf("renderer=%q, want patch", activity.Renderer)
	}
	if _, ok := activity.Payload["patch"]; ok {
		t.Fatalf("apply_patch call payload must not include full patch: %#v", activity.Payload)
	}
	for _, key := range []string{"files_changed", "hunks", "additions", "deletions"} {
		if _, ok := activity.Payload[key]; !ok {
			t.Fatalf("apply_patch call payload missing %s: %#v", key, activity.Payload)
		}
	}
	for _, key := range []string{"patch_sha256", "patch_bytes", "patch_lines"} {
		if _, ok := activity.Payload[key]; ok {
			t.Fatalf("apply_patch call payload must not include %s: %#v", key, activity.Payload)
		}
	}
}

func TestFloretActivityForOKFCallUsesKnowledgeLookupPresentation(t *testing.T) {
	t.Parallel()

	activity := floretActivityForToolCall("okf.search", map[string]any{})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if activity.Label != okfKnowledgeActivityLabel {
		t.Fatalf("label=%q, want %q", activity.Label, okfKnowledgeActivityLabel)
	}
	if activity.Renderer != observation.ActivityRendererStructured {
		t.Fatalf("renderer=%q, want structured", activity.Renderer)
	}
	if activity.Payload["operation"] != "okf.search" {
		t.Fatalf("operation payload=%v, want okf.search", activity.Payload["operation"])
	}
	if activity.Label == "okf.search" || activity.Label == "Search OKF" {
		t.Fatalf("label=%q keeps search-engine wording", activity.Label)
	}

	withQuery := floretActivityForToolCall("okf.search", map[string]any{"query": "Workbench wheel ownership"})
	if withQuery == nil {
		t.Fatal("query activity is nil")
	}
	if withQuery.Label != "Workbench wheel ownership" {
		t.Fatalf("query label=%q, want query", withQuery.Label)
	}
	if withQuery.Payload["operation"] != "okf.search" || withQuery.Payload["query"] != "Workbench wheel ownership" {
		t.Fatalf("query payload=%#v", withQuery.Payload)
	}
}

func TestFloretToolResultActivityCarriesExpandableTerminalDetailsWithoutCallOnlyFields(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_terminal_1",
		ToolName: "terminal.exec",
		Status:   toolResultStatusSuccess,
		Summary:  "command completed",
		Data: map[string]any{
			"stdout":      "ok\n",
			"stderr":      "",
			"exit_code":   0,
			"duration_ms": 42,
			"timed_out":   false,
			"truncated":   false,
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if activity.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("renderer=%q, want terminal", activity.Renderer)
	}
	if strings.TrimSpace(activity.Label) != "" {
		t.Fatalf("result-only label=%q, want empty until call/result merge supplies command", activity.Label)
	}
	if _, ok := activity.Payload["command"]; ok {
		t.Fatalf("result-only payload should not invent command: %#v", activity.Payload)
	}
	if got := anyToString(activity.Payload["stdout"]); got != "ok\n" {
		t.Fatalf("stdout=%q", got)
	}
	if len(activity.Chips) == 0 || activity.Chips[0].Kind != "exit_code" || activity.Chips[0].Value != "0" {
		t.Fatalf("chips=%#v, want exit code chip", activity.Chips)
	}
}

func TestFloretToolResultActivityForOKFUsesKnowledgeLookupFallback(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_okf",
		ToolName: "okf.search",
		Status:   toolResultStatusSuccess,
		Summary:  toolSuccessSummary("okf.search"),
		Data: map[string]any{
			"total_concepts": 12,
		},
	})
	if activity.Label != okfKnowledgeActivityLabel {
		t.Fatalf("label=%q, want %q", activity.Label, okfKnowledgeActivityLabel)
	}
	if activity.Renderer != observation.ActivityRendererStructured {
		t.Fatalf("renderer=%q, want structured", activity.Renderer)
	}
	if activity.Payload["operation"] != "okf.search" {
		t.Fatalf("operation payload=%v, want okf.search", activity.Payload["operation"])
	}
	if activity.Payload["summary"] != "okf.knowledge.lookup" {
		t.Fatalf("summary payload=%v, want okf.knowledge.lookup", activity.Payload["summary"])
	}
	if activity.Label == "okf.search" || activity.Label == "Search OKF" {
		t.Fatalf("label=%q keeps search-engine wording", activity.Label)
	}
	if activity.Payload["summary"] == "okf.search" || activity.Payload["summary"] == "Search OKF" {
		t.Fatalf("summary payload=%q keeps search-engine wording", activity.Payload["summary"])
	}

	withQuery := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_okf_query",
		ToolName: "okf.search",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"query":          "Workbench wheel ownership",
			"total_concepts": 12,
		},
	})
	if withQuery.Label != "Workbench wheel ownership" {
		t.Fatalf("query label=%q, want query", withQuery.Label)
	}
	if withQuery.Payload["operation"] != "okf.search" || withQuery.Payload["query"] != "Workbench wheel ownership" {
		t.Fatalf("query payload=%#v", withQuery.Payload)
	}
}

func TestFloretToolResultActivityUsesContractSafeErrorPayload(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_terminal_timeout",
		ToolName: "terminal.exec",
		Status:   toolResultStatusTimeout,
		Summary:  "TIMEOUT",
		Details:  "Tool execution timed out after 30000 ms",
		Data: map[string]any{
			"command":     "curl -sL https://example.test",
			"exit_code":   124,
			"duration_ms": 30000,
			"timed_out":   true,
		},
		Error: &aitools.ToolError{
			Code:      aitools.ErrorCodeTimeout,
			Message:   "Tool execution timed out after 30000 ms",
			Retryable: true,
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	errorPayload, ok := activity.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error payload=%#v, want map", activity.Payload["error"])
	}
	if errorPayload["code"] != "TIMEOUT" || errorPayload["message"] != "Tool execution timed out after 30000 ms" || errorPayload["retryable"] != true {
		t.Fatalf("error payload=%#v", errorPayload)
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_1"}, []observation.Event{{
		Type:     observation.EventTypeToolCall,
		ToolID:   "tool_timeout",
		ToolName: "terminal.exec",
		Activity: floretActivityForToolCall("terminal.exec", map[string]any{"command": "curl -sL https://example.test"}),
	}, {
		Type:     observation.EventTypeToolResult,
		ToolID:   "tool_timeout",
		ToolName: "terminal.exec",
		Error:    "Tool execution timed out after 30000 ms",
		Activity: activity,
	}}, 2000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
	item := timeline.Items[0]
	if item.Status != observation.ActivityStatusError || item.EndedAtUnixMS == 0 {
		t.Fatalf("item=%+v, want closed error item", item)
	}
}

func TestFloretToolResultActivityTrimsTerminalLabelToContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_terminal_long_result",
		ToolName: "terminal.exec",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"command": "printf " + strings.Repeat("x", 260),
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if len([]rune(activity.Label)) > activityPresentationLabelLimit {
		t.Fatalf("label length=%d, want <= %d", len([]rune(activity.Label)), activityPresentationLabelLimit)
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_1"}, []observation.Event{{
		Type:     observation.EventTypeToolResult,
		ToolID:   "tool_long_result",
		ToolName: "terminal.exec",
		Activity: activity,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestFloretToolResultActivitySanitizesStructuredTodoResults(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_todos",
		ToolName: "write_todos",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"summary": TodoSummary{Total: 1, Completed: 1},
			"todos": []TodoItem{{
				ID:      "todo_1",
				Content: "Verify activity timeline",
				Status:  TodoStatusCompleted,
			}},
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	items := toAnySlice(activity.Payload["todos"])
	if len(items) != 1 {
		t.Fatalf("todos=%#v, want one item", activity.Payload["todos"])
	}
	if _, ok := items[0].(map[string]any); !ok {
		t.Fatalf("todo item=%T, want JSON-safe map", items[0])
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_1"}, []observation.Event{{
		Type:     observation.EventTypeToolResult,
		ToolID:   "tool_todos",
		ToolName: "write_todos",
		Activity: activity,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestFloretToolResultActivityPayloadsAreJSONSafe(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	cases := []struct {
		toolName string
		activity *observation.ActivityPresentation
	}{
		{toolName: "terminal.exec", activity: mustFloretToolResultActivity(t, r, ToolResult{
			ToolID:   "call_terminal_timeout",
			ToolName: "terminal.exec",
			Status:   toolResultStatusTimeout,
			Data: map[string]any{
				"command": "curl -sL https://example.test/slow",
			},
			Error: &aitools.ToolError{
				Code:    aitools.ErrorCodeTimeout,
				Message: "Tool execution timed out after 30000 ms",
			},
		})},
		{toolName: "write_todos", activity: mustFloretToolResultActivity(t, r, ToolResult{
			ToolID:   "call_todos",
			ToolName: "write_todos",
			Status:   toolResultStatusSuccess,
			Data: map[string]any{
				"summary": TodoSummary{Total: 1, Completed: 1},
				"todos": []TodoItem{{
					ID:      "todo_1",
					Content: "Verify activity payloads",
					Status:  TodoStatusCompleted,
				}},
			},
		})},
		{toolName: "apply_patch", activity: mustFloretToolResultActivity(t, r, ToolResult{
			ToolID:   "call_patch",
			ToolName: "apply_patch",
			Status:   toolResultStatusSuccess,
			Data: ApplyPatchResult{
				FilesChanged: 1,
				Mutations: []FileMutationResult{{
					FilePath:    "/workspace/app.ts",
					DisplayName: "app.ts",
					ChangeType:  "update",
					Additions:   1,
					Deletions:   1,
					UnifiedDiff: "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new",
				}},
			},
		})},
	}

	for _, tt := range cases {
		if tt.activity == nil {
			t.Fatal("activity is nil")
		}
		assertContractSafeActivityPayload(t, tt.activity.Payload, 0)
		timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_json_safe"}, []observation.Event{{
			Type:     observation.EventTypeToolResult,
			ToolID:   "tool_json_safe",
			ToolName: tt.toolName,
			Activity: tt.activity,
		}}, 1000)
		if err := observation.ValidateActivityTimeline(timeline); err != nil {
			t.Fatalf("ValidateActivityTimeline(%#v): %v", tt.activity.Payload, err)
		}
	}
}

func TestFloretToolResultActivityPayloadsMeetFullContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_contract_payload",
		ToolName: "terminal.exec",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"command": "printf ok",
			"stdout":  strings.Repeat("o", activityPayloadStringLimit+400),
			"bad key / with spaces": map[string]any{
				"level1": map[string]any{
					"level2": map[string]any{
						"level3": map[string]any{
							"level4": map[string]any{
								"level5": map[string]any{
									"level6": "too deep",
								},
							},
						},
					},
				},
			},
		},
	})
	assertContractSafeActivityPayload(t, activity.Payload, 0)
	if _, ok := activity.Payload["bad key / with spaces"]; ok {
		t.Fatalf("payload kept invalid key: %#v", activity.Payload)
	}
	if _, ok := activity.Payload["bad_key_with_spaces"]; !ok {
		t.Fatalf("payload missing normalized key: %#v", activity.Payload)
	}
	if len([]rune(anyToString(activity.Payload["stdout"]))) > activityPayloadStringLimit {
		t.Fatalf("stdout length=%d, want <= %d", len([]rune(anyToString(activity.Payload["stdout"]))), activityPayloadStringLimit)
	}
	if activity.Payload["truncated"] != true {
		t.Fatalf("payload truncated flag=%#v, want true", activity.Payload["truncated"])
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_contract_payload"}, []observation.Event{{
		Type:     observation.EventTypeToolResult,
		ToolID:   "tool_contract_payload",
		ToolName: "terminal.exec",
		Activity: activity,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestFloretToolResultFromFlowerUsesContractSafeStructuredAndText(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	result, err := floretToolResultFromFlower(r, ToolResult{
		ToolID:   "call_todos_error",
		ToolName: "write_todos",
		Status:   toolResultStatusError,
		Summary:  "permission_denied",
		Details:  "Denied",
		Data: map[string]any{
			"todos": []TodoItem{{
				ID:      "todo_1",
				Content: "Do the thing",
				Status:  TodoStatusPending,
			}},
		},
		Error: &aitools.ToolError{
			Code:           aitools.ErrorCodePermissionDenied,
			Message:        "Denied",
			Retryable:      false,
			SuggestedFixes: []string{"legacy field must not leak"},
			Meta:           map[string]any{"secret": "old envelope"},
		},
	})
	if err != nil {
		t.Fatalf("floretToolResultFromFlower: %v", err)
	}
	if !result.IsError {
		t.Fatal("IsError=false, want true")
	}
	assertContractSafeActivityPayload(t, result.Structured, 0)
	errorPayload, ok := result.Structured["error"].(map[string]any)
	if !ok {
		t.Fatalf("structured error=%#v, want map", result.Structured["error"])
	}
	if _, ok := errorPayload["suggested_fixes"]; ok {
		t.Fatalf("structured error kept old envelope: %#v", errorPayload)
	}
	data, ok := result.Structured["data"].(map[string]any)
	if !ok {
		t.Fatalf("structured data=%#v, want map", result.Structured["data"])
	}
	todos := toAnySlice(data["todos"])
	if len(todos) != 1 {
		t.Fatalf("structured todos=%#v, want one", data["todos"])
	}
	if _, ok := todos[0].(map[string]any); !ok {
		t.Fatalf("structured todo item=%T, want map", todos[0])
	}
	var textPayload map[string]any
	if err := json.Unmarshal([]byte(result.Text), &textPayload); err != nil {
		t.Fatalf("unmarshal result text: %v", err)
	}
	if strings.Contains(result.Text, "suggested_fixes") || strings.Contains(result.Text, "legacy field") || strings.Contains(result.Text, "Meta") {
		t.Fatalf("result text kept old error envelope: %s", result.Text)
	}
	assertContractSafeActivityPayload(t, textPayload, 0)
}

func TestFloretToolResultFromFlowerSanitizesNestedLegacyErrorEnvelope(t *testing.T) {
	t.Parallel()

	result, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
		ToolID:   "call_nested_error",
		ToolName: "terminal.exec",
		Status:   toolResultStatusError,
		Data: map[string]any{
			"envelope": aitools.ToolResultEnvelope{
				Status: aitools.ResultStatusError,
				Error: &aitools.ToolError{
					Code:           aitools.ErrorCodePermissionDenied,
					Message:        "Denied",
					Retryable:      false,
					SuggestedFixes: []string{"old fix"},
					Meta:           map[string]any{"debug": "old meta"},
				},
			},
			"direct_error": &aitools.ToolError{
				Code:           aitools.ErrorCodeTimeout,
				Message:        "Timed out",
				Retryable:      true,
				NormalizedArgs: map[string]any{"command": "old"},
			},
		},
	})
	if err != nil {
		t.Fatalf("floretToolResultFromFlower: %v", err)
	}
	if strings.Contains(result.Text, "suggested_fixes") || strings.Contains(result.Text, "normalized_args") || strings.Contains(result.Text, "meta") {
		t.Fatalf("result text kept old nested error envelope: %s", result.Text)
	}
	data := result.Structured["data"].(map[string]any)
	envelope := data["envelope"].(map[string]any)
	nestedError := envelope["error"].(map[string]any)
	if nestedError["code"] != "PERMISSION_DENIED" || nestedError["message"] != "Denied" {
		t.Fatalf("nested error payload=%#v", nestedError)
	}
	directError := data["direct_error"].(map[string]any)
	if directError["code"] != "TIMEOUT" || directError["message"] != "Timed out" || directError["retryable"] != true {
		t.Fatalf("direct error payload=%#v", directError)
	}
	assertContractSafeActivityPayload(t, result.Structured, 0)
}

func TestFloretToolResultFromFlowerRejectsInvalidStatus(t *testing.T) {
	t.Parallel()

	_, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
		ToolID:   "call_invalid",
		ToolName: "terminal.exec",
		Status:   "",
	})
	if err == nil || !strings.Contains(err.Error(), "status is required") {
		t.Fatalf("error=%v, want missing status rejection", err)
	}
}

func TestFloretToolResultActivityCarriesApplyPatchMutations(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_patch_1",
		ToolName: "apply_patch",
		Status:   toolResultStatusSuccess,
		Summary:  "patch applied",
		Data: ApplyPatchResult{
			FilesChanged:     1,
			Hunks:            1,
			Additions:        1,
			Deletions:        1,
			InputFormat:      "begin_patch",
			NormalizedFormat: "begin_patch",
			Mutations: []FileMutationResult{{
				FilePath:    "/workspace/app.ts",
				DisplayName: "app.ts",
				NewPath:     "/workspace/app.ts",
				ChangeType:  "update",
				Additions:   1,
				Deletions:   1,
				UnifiedDiff: "--- a/workspace/app.ts\n+++ b/workspace/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
			}},
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if activity.Renderer != observation.ActivityRendererPatch {
		t.Fatalf("renderer=%q, want patch", activity.Renderer)
	}
	mutations := toAnySlice(activity.Payload["mutations"])
	if len(mutations) != 1 {
		t.Fatalf("mutations=%#v, want one mutation", activity.Payload["mutations"])
	}
	mutation, ok := mutations[0].(map[string]any)
	if !ok {
		t.Fatalf("mutation=%#v, want map", mutations[0])
	}
	if anyToString(mutation["change_type"]) != "update" || anyToString(mutation["display_name"]) != "app.ts" {
		t.Fatalf("mutation=%#v, want display name and change type", mutation)
	}
	if _, ok := mutation["file_path"]; ok {
		t.Fatalf("mutation activity payload must not include file_path: %#v", mutation)
	}
	if _, ok := mutation["preview_path"]; ok {
		t.Fatalf("mutation activity payload must not include preview_path: %#v", mutation)
	}
	if _, ok := mutation["directory_path"]; ok {
		t.Fatalf("mutation activity payload must not include directory_path: %#v", mutation)
	}
	actionID := anyToString(mutation["file_action_id"])
	if actionID == "" {
		t.Fatalf("mutation file_action_id=%#v, want action id", mutation)
	}
	if strings.Contains(actionID, "workspace") || strings.Contains(actionID, "app") {
		t.Fatalf("file_action_id=%q must be opaque", actionID)
	}
	action := r.activityFileActions[actionID]
	if action.DisplayName != "app.ts" || action.PreviewPath != "/workspace/app.ts" || action.DirectoryPath != "/workspace" {
		t.Fatalf("registered file action=%#v", action)
	}
	if diff := anyToString(mutation["unified_diff"]); !strings.Contains(diff, "@@ -1,1 +1,1 @@") || !strings.Contains(diff, "-old") || !strings.Contains(diff, "+new") {
		t.Fatalf("unified_diff=%q", diff)
	}
	if _, ok := mutation["original_file"]; ok {
		t.Fatalf("mutation must not carry old file body: %#v", mutation)
	}
}

func TestFloretControlDefinitionsRejectInvalidSchema(t *testing.T) {
	t.Parallel()

	_, err := floretControlDefinitionsFromTools([]ToolDef{{
		Name:        "task_complete",
		InputSchema: json.RawMessage(`{"type":"object"`),
	}})
	if err == nil || !strings.Contains(err.Error(), "invalid input schema") {
		t.Fatalf("error=%v, want invalid control schema", err)
	}
}

func TestFloretToolRegistryDoesNotInjectRunTargetContext(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:         "env_test",
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: executor,
	})
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name:        "terminal.exec",
		Description: "Execute a shell command.",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`,
		),
		Source:    "builtin",
		Namespace: "builtin.terminal",
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	result := registry.Run(context.Background(), fltools.ToolCall{
		ID:   "call_1",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, nil)
	if result.IsError {
		t.Fatalf("registry result error text=%q structured=%#v", result.Text, result.Structured)
	}
	if executor.call.TargetID != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("target_id=%q", executor.call.TargetID)
	}
	var forwarded map[string]any
	if err := json.Unmarshal(executor.call.Arguments, &forwarded); err != nil {
		t.Fatalf("unmarshal forwarded args: %v", err)
	}
	if forwarded["command"] != "pwd" {
		t.Fatalf("forwarded command=%#v", forwarded["command"])
	}
	if _, ok := forwarded["target_id"]; ok {
		t.Fatalf("forwarded target tool args must not include target_id: %#v", forwarded)
	}
}

func containsAnyString(values []any, want string) bool {
	for _, value := range values {
		if raw, ok := value.(string); ok && raw == want {
			return true
		}
	}
	return false
}

func assertContractSafeActivityPayload(t *testing.T, value any, depth int) {
	t.Helper()
	if depth > activityPayloadMaxDepth {
		t.Fatalf("payload depth=%d exceeds contract", depth)
	}
	switch typed := value.(type) {
	case nil, bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return
	case string:
		if len([]rune(typed)) > activityPayloadStringLimit {
			t.Fatalf("payload string length=%d exceeds contract", len([]rune(typed)))
		}
		return
	case map[string]any:
		for key, item := range typed {
			if contractSafePayloadKey(key) != key {
				t.Fatalf("payload key %q is not contract-safe", key)
			}
			assertContractSafeActivityPayload(t, item, depth+1)
		}
	case []any:
		for _, item := range typed {
			assertContractSafeActivityPayload(t, item, depth+1)
		}
	default:
		t.Fatalf("payload value type %T is not contract-safe: %#v", value, value)
	}
}
