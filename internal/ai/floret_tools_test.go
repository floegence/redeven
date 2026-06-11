package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

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
