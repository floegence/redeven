package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/session"
)

func TestFloretHostLabelsIncludeExplicitTargetContext(t *testing.T) {
	r := newRun(runOptions{
		EndpointID:       "env_1",
		ToolTargetPolicy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
	})
	labels := floretHostLabelsForRun(r)
	if labels["endpoint_id"] != "env_1" || labels["engine"] != "redeven" {
		t.Fatalf("base labels = %#v", labels)
	}
	if labels["target_id"] != "provider:https%3A%2F%2Fredeven.test:env:target_1" ||
		labels["current_target_id"] != "provider:https%3A%2F%2Fredeven.test:env:target_1" ||
		labels["primary_target_id"] != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("target labels = %#v", labels)
	}
}

func TestApplyFloretHostContextToToolArgsInjectsOnlyTargetScopedTools(t *testing.T) {
	host := map[string]string{"target_id": "provider:https%3A%2F%2Fredeven.test:env:target_1"}
	targetArgs := applyFloretHostContextToToolArgs("terminal.exec", map[string]any{"command": "pwd"}, host)
	if targetArgs["target_id"] != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("target args = %#v", targetArgs)
	}
	if targetIDFromToolArgs(targetArgs) != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("target id not readable from args: %#v", targetArgs)
	}

	explicitArgs := applyFloretHostContextToToolArgs("file.read", map[string]any{"path": "README.md", "target_id": "model-selected"}, host)
	if explicitArgs["target_id"] != "model-selected" {
		t.Fatalf("explicit target should remain explicit: %#v", explicitArgs)
	}

	localArgs := applyFloretHostContextToToolArgs("web.search", map[string]any{"query": "redeven"}, host)
	if _, ok := localArgs["target_id"]; ok {
		t.Fatalf("non-target tool should not receive target id: %#v", localArgs)
	}
}

func TestFloretToolDefinitionKeepsSchemaIndependentFromHostContext(t *testing.T) {
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
	if _, ok := properties["target_id"]; !ok {
		t.Fatalf("target_id schema should remain explicit: %#v", properties)
	}
	required, ok := def.InputSchema["required"].([]any)
	if !ok {
		t.Fatalf("required=%#v, want array", def.InputSchema["required"])
	}
	if !containsAnyString(required, "target_id") || !containsAnyString(required, "command") {
		t.Fatalf("schema required fields changed: %#v", required)
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
	if activity.Payload["command"] != "npm run build -- --mode production" || activity.Payload["cwd"] != "/workspace/app" {
		t.Fatalf("payload=%#v, want command and cwd", activity.Payload)
	}
	if _, ok := activity.Payload["stdin"]; ok {
		t.Fatalf("terminal activity payload must not include stdin: %#v", activity.Payload)
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
	if edit.Payload["operation"] != "edit" || edit.Payload["file_path"] != "internal/ai/run.go" || edit.Payload["replace_all"] != true {
		t.Fatalf("edit payload=%#v", edit.Payload)
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
	if write.Payload["operation"] != "write" || write.Payload["file_path"] != "internal/ai/run.go" {
		t.Fatalf("write payload=%#v", write.Payload)
	}
	if _, ok := write.Payload["content_utf8"]; ok {
		t.Fatalf("write activity payload must not include content_utf8: %#v", write.Payload)
	}
	if _, ok := write.Payload["content"]; ok {
		t.Fatalf("write activity payload must not include content: %#v", write.Payload)
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
	for _, key := range []string{"patch_sha256", "patch_bytes", "patch_lines", "files_changed", "hunks", "additions", "deletions"} {
		if _, ok := activity.Payload[key]; !ok {
			t.Fatalf("apply_patch call payload missing %s: %#v", key, activity.Payload)
		}
	}
}

func TestFloretToolResultActivityCarriesExpandableTerminalDetailsWithoutCallOnlyFields(t *testing.T) {
	t.Parallel()

	activity := floretActivityForToolResult(ToolResult{
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

func TestFloretToolResultActivityCarriesApplyPatchMutations(t *testing.T) {
	t.Parallel()

	activity := floretActivityForToolResult(ToolResult{
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
				FilePath:   "/workspace/app.ts",
				NewPath:    "/workspace/app.ts",
				ChangeType: "update",
				StructuredDiff: []DiffHunkView{{
					OldStart:    1,
					OldLines:    1,
					NewStart:    1,
					NewLines:    1,
					Before:      []string{"old"},
					After:       []string{"new"},
					BeforeKinds: []string{"removed"},
					AfterKinds:  []string{"added"},
				}},
				OriginalFile: "old\n",
				UpdatedFile:  "new\n",
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
	if anyToString(mutation["file_path"]) != "/workspace/app.ts" || anyToString(mutation["change_type"]) != "update" {
		t.Fatalf("mutation=%#v, want path and change type", mutation)
	}
	if len(toAnySlice(mutation["structured_diff"])) != 1 {
		t.Fatalf("structured_diff=%#v, want one hunk", mutation["structured_diff"])
	}
	hunks := toAnySlice(mutation["structured_diff"])
	hunk, _ := hunks[0].(map[string]any)
	if len(toAnySlice(hunk["before_kinds"])) != 1 || len(toAnySlice(hunk["after_kinds"])) != 1 {
		t.Fatalf("structured diff must carry line kinds: %#v", hunk)
	}
	if anyToString(mutation["original_file"]) != "old\n" || anyToString(mutation["updated_file"]) != "new\n" {
		t.Fatalf("mutation file bodies=%#v", mutation)
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

func TestFloretToolRegistryInjectsRunHostTargetContext(t *testing.T) {
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
