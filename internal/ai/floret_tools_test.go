package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
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

func floretToolDefinition(r *run, def ToolDef) (fltools.Definition, error) {
	if r == nil {
		return fltools.Definition{}, errors.New("missing Floret tool definition run")
	}
	permissionType := r.currentPermissionType()
	if permissionType == "" {
		permissionType = FlowerPermissionApprovalRequired
	}
	snapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(permissionType, []ToolDef{def}, nil), "tool_definition", "tool_definition", strings.TrimSpace(def.Name))
	return floretToolDefinitionForSnapshot(def, snapshot)
}

func presentationCallFallback(t *testing.T, toolName string) string {
	t.Helper()
	return aitools.MustPresentationSpec(toolName).CallLabelFallback
}

func presentationResultFallback(t *testing.T, toolName string) string {
	t.Helper()
	return aitools.MustPresentationSpec(toolName).ResultLabelFallback
}

func floretToolRegistryParentRunOptions(r *run, suffix string) fltools.DispatchOptions {
	suffix = strings.TrimSpace(suffix)
	if suffix == "" {
		suffix = "tool_registry"
	}
	if strings.TrimSpace(r.id) == "" {
		r.id = "run_" + suffix
	}
	if strings.TrimSpace(r.threadID) == "" {
		r.threadID = "thread_" + suffix
	}
	if strings.TrimSpace(r.turnID) == "" {
		r.turnID = "turn_" + suffix
	}
	if strings.TrimSpace(r.messageID) == "" {
		r.messageID = "msg_" + suffix
	}
	snapshot := r.currentPermissionSnapshot()
	return fltools.DispatchOptions{
		RunID:         strings.TrimSpace(r.id),
		ThreadID:      strings.TrimSpace(r.threadID),
		TurnID:        strings.TrimSpace(r.turnID),
		PromptScopeID: strings.TrimSpace(r.threadID),
		Step:          1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: strings.TrimSpace(snapshot.SnapshotID),
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    strings.TrimSpace(r.threadID),
		},
		EffectDispatcher: floretToolRegistryTestEffectDispatcher(r),
	}
}

func floretToolRegistryTestEffectDispatcher(r *run) fltools.EffectDispatcher {
	return func(ctx context.Context, req fltools.EffectDispatchRequest, invoke func(context.Context) fltools.Result) fltools.Result {
		if r == nil || r.effectAuthorizations == nil {
			return fltools.Result{CallID: req.CallID, Name: req.Name, IsError: true, DispatchErr: errors.New("test effect authorization unavailable")}
		}
		argumentHash := floretEffectArgumentHash(req.RawArgs)
		fingerprint := floretEffectArgumentHash(strings.Join([]string{req.ThreadID, req.TurnID, req.RunID, req.CallID, req.Name, argumentHash}, "\x00"))
		var result fltools.Result
		err := r.withAuthorizedFloretEffect(ctx, flruntime.EffectAuthorizationRequest{
			EffectAttemptID: "test_effect:" + strings.TrimSpace(req.CallID), RequestFingerprint: fingerprint,
			ThreadID: flruntime.ThreadID(req.ThreadID), TurnID: flruntime.TurnID(req.TurnID), RunID: flruntime.RunID(req.RunID),
			ToolCallID: req.CallID, ToolName: req.Name, ArgumentHash: argumentHash,
			Step: req.Step, BatchIndex: req.BatchIndex, BatchSize: req.BatchSize,
			Labels: req.Labels, HostContext: req.HostContext, Resources: req.Resources, Effects: req.Effects,
			Permission: req.Permission, ReadOnly: req.ReadOnly, Destructive: req.Destructive, OpenWorld: req.OpenWorld,
			LeaseOwnerID: "test_lease:" + strings.TrimSpace(req.RunID), LeaseGeneration: 1, ObservedHeartbeat: 1,
		}, func(executionCtx context.Context, _ flruntime.EffectAuthorizationProof) error {
			result = invoke(executionCtx)
			return result.DispatchErr
		})
		if err != nil {
			return fltools.Result{CallID: req.CallID, Name: req.Name, IsError: true, DispatchErr: err}
		}
		return result
	}
}

func floretToolResultErrorText(result fltools.Result) string {
	if result.DispatchErr != nil {
		return result.DispatchErr.Error()
	}
	return result.Text
}

func TestFloretHostLabelsExcludeTargetContext(t *testing.T) {
	r := newRunWithProductStoreForTest(t, runOptions{
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
	r := newRun(runOptions{})
	r.permissionType = FlowerPermissionApprovalRequired
	def, err := floretToolDefinition(r, ToolDef{
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
	if def.Permission.Mode != fltools.PermissionAsk {
		t.Fatalf("permission=%q, want ask so Floret owns the permission lifecycle", def.Permission.Mode)
	}
	permission, err := def.PermissionFor(fltools.PermissionRequest{
		Name: "terminal.exec",
		Args: map[string]any{"command": "pwd"},
	})
	if err != nil {
		t.Fatalf("PermissionFor: %v", err)
	}
	if permission.Mode != fltools.PermissionAsk {
		t.Fatalf("permission=%q, want ask for approval_required shell", permission.Mode)
	}
}

func TestFloretToolDefinitionRemovesTerminalExecTimeoutAlias(t *testing.T) {
	t.Parallel()

	var terminalExec ToolDef
	for _, def := range builtInToolDefinitions() {
		if def.Name == "terminal.exec" {
			terminalExec = def
			break
		}
	}
	if terminalExec.Name == "" {
		t.Fatal("terminal.exec definition not found")
	}

	def, err := floretToolDefinition(newRun(runOptions{}), terminalExec)
	if err != nil {
		t.Fatalf("floretToolDefinition: %v", err)
	}
	properties, ok := def.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("properties=%#v, want object", def.InputSchema["properties"])
	}
	if _, ok := properties["timeout_ms"]; ok {
		t.Fatalf("Floret terminal.exec schema retained timeout_ms: %#v", properties)
	}
	if _, err := fltools.Validate(def.InputSchema, []byte(`{"command":"pwd","timeout_ms":1000}`)); err == nil {
		t.Fatal("Floret terminal.exec schema accepted removed timeout_ms")
	}
}

func TestFloretTerminalReadDefinitionDeclaresPollingRepeatPolicy(t *testing.T) {
	t.Parallel()

	var terminalRead ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "terminal.read" {
			terminalRead = candidate
			break
		}
	}
	if terminalRead.Name == "" {
		t.Fatal("terminal.read definition not found")
	}
	def, err := floretToolDefinition(newRun(runOptions{}), terminalRead)
	if err != nil {
		t.Fatalf("floretToolDefinition: %v", err)
	}
	if got := def.Annotations[fltools.AnnotationRepeatPolicy]; got != fltools.RepeatPolicyPolling {
		t.Fatalf("terminal.read repeat policy=%#v, want polling", got)
	}
	ignored, ok := def.Annotations[fltools.AnnotationRepeatIdentityIgnoredArguments].([]string)
	if !ok || !reflect.DeepEqual(ignored, []string{"description"}) {
		t.Fatalf("terminal.read ignored repeat identity arguments=%#v, want description", def.Annotations[fltools.AnnotationRepeatIdentityIgnoredArguments])
	}

	execDef, err := floretToolDefinition(newRun(runOptions{}), ToolDef{Name: "terminal.exec"})
	if err != nil {
		t.Fatalf("floretToolDefinition terminal.exec: %v", err)
	}
	if _, ok := execDef.Annotations[fltools.AnnotationRepeatPolicy]; ok {
		t.Fatalf("terminal.exec must not declare polling repeat policy: %#v", execDef.Annotations)
	}
}

func TestFloretTerminalReadActivityKeepsModelIntentAcrossResult(t *testing.T) {
	t.Parallel()

	const intent = "Check the latest Docker build output again"
	callActivity := floretActivityForToolCall("terminal.read", map[string]any{
		"process_id":  "tp_build",
		"description": intent,
		"after_seq":   int64(4),
	})
	if callActivity == nil || callActivity.Label != intent || callActivity.Description != "" {
		t.Fatalf("call activity=%#v, want intent label without duplicate description", callActivity)
	}
	if _, ok := callActivity.Payload["description"]; ok {
		t.Fatalf("call payload duplicated description: %#v", callActivity.Payload)
	}

	resultActivity := mustFloretToolResultActivity(t, newRun(runOptions{}), ToolResult{
		ToolID:   "call_terminal_read_intent",
		ToolName: "terminal.read",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"status":     terminalProcessStatusRunning,
			"process_id": "tp_build",
			"command":    "docker compose up --build -d",
			"output":     "building...\n",
			"last_seq":   int64(5),
			"latest_seq": int64(5),
			"has_more":   false,
		},
	})
	if resultActivity.Label != "" {
		t.Fatalf("result activity label=%q, want omitted label", resultActivity.Label)
	}

	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_terminal_read_intent"}, []observation.Event{
		{Type: observation.EventTypeToolCall, RunID: "run_terminal_read_intent", ToolID: "call_terminal_read_intent", ToolName: "terminal.read", ToolKind: "local", Activity: callActivity, ObservedAt: time.UnixMilli(1000)},
		{Type: observation.EventTypeToolResult, RunID: "run_terminal_read_intent", ToolID: "call_terminal_read_intent", ToolName: "terminal.read", ToolKind: "local", Activity: resultActivity, Metadata: map[string]any{"tool_result_status": string(observation.ActivityStatusSuccess)}, ObservedAt: time.UnixMilli(1100)},
	}, 1200)
	if len(timeline.Items) != 1 {
		t.Fatalf("timeline items=%#v, want one", timeline.Items)
	}
	item := timeline.Items[0]
	if item.Label != intent || item.Payload["command"] != "docker compose up --build -d" || item.Payload["output"] != "building...\n" {
		t.Fatalf("terminal.read timeline item=%#v", item)
	}
}

func TestFloretTerminalTerminateActivityKeepsModelIntentAcrossResult(t *testing.T) {
	t.Parallel()

	const intent = "Stop the Docker build command"
	callActivity := floretActivityForToolCall("terminal.terminate", map[string]any{
		"process_id":  "tp_build",
		"description": intent,
	})
	if callActivity == nil || callActivity.Label != intent || callActivity.Description != "" {
		t.Fatalf("call activity=%#v, want intent label without duplicate description", callActivity)
	}
	if callActivity.Payload["process_id"] != "tp_build" {
		t.Fatalf("call payload=%#v, want process_id detail", callActivity.Payload)
	}
	if _, ok := callActivity.Payload["description"]; ok {
		t.Fatalf("call payload duplicated description: %#v", callActivity.Payload)
	}

	resultActivity := mustFloretToolResultActivity(t, newRun(runOptions{}), ToolResult{
		ToolID:   "call_terminal_terminate_intent",
		ToolName: "terminal.terminate",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"status":     terminalProcessStatusCanceled,
			"process_id": "tp_build",
			"command":    "docker compose up --build -d",
			"terminated": true,
		},
	})
	if resultActivity.Label != "" {
		t.Fatalf("result activity label=%q, want omitted label", resultActivity.Label)
	}

	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_terminal_terminate_intent"}, []observation.Event{
		{Type: observation.EventTypeToolCall, RunID: "run_terminal_terminate_intent", ToolID: "call_terminal_terminate_intent", ToolName: "terminal.terminate", ToolKind: "local", Activity: callActivity, ObservedAt: time.UnixMilli(1000)},
		{Type: observation.EventTypeToolResult, RunID: "run_terminal_terminate_intent", ToolID: "call_terminal_terminate_intent", ToolName: "terminal.terminate", ToolKind: "local", Activity: resultActivity, Metadata: map[string]any{"tool_result_status": string(observation.ActivityStatusSuccess)}, ObservedAt: time.UnixMilli(1100)},
	}, 1200)
	if len(timeline.Items) != 1 {
		t.Fatalf("timeline items=%#v, want one", timeline.Items)
	}
	item := timeline.Items[0]
	if item.Label != intent || item.Payload["process_id"] != "tp_build" || item.Payload["terminated"] != true {
		t.Fatalf("terminal.terminate timeline item=%#v", item)
	}
}

func TestFloretTerminalReadResultsExposeEachDeltaOnce(t *testing.T) {
	t.Parallel()

	toFloret := func(toolID string, output string, firstSeq int64, lastSeq int64) fltools.Result {
		result, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
			ToolID:   toolID,
			ToolName: "terminal.read",
			Status:   toolResultStatusSuccess,
			Data: map[string]any{
				"process_id": "tp_phases",
				"status":     terminalProcessStatusRunning,
				"output":     output,
				"first_seq":  firstSeq,
				"last_seq":   lastSeq,
				"latest_seq": lastSeq,
				"has_more":   false,
			},
		})
		if err != nil {
			t.Fatalf("floretToolResultFromFlower(%s): %v", toolID, err)
		}
		return result
	}

	first := toFloret("read_phase_1", "phase 1\n", 1, 1)
	second := toFloret("read_phase_2", "phase 2\n", 2, 2)
	if strings.Count(first.Text, "phase 1") != 1 || strings.Contains(first.Text, "phase 2") {
		t.Fatalf("first result text=%s", first.Text)
	}
	if strings.Count(second.Text, "phase 2") != 1 || strings.Contains(second.Text, "phase 1") {
		t.Fatalf("second result text=%s", second.Text)
	}
	modelVisibleHistory := first.Text + "\n" + second.Text
	if strings.Count(modelVisibleHistory, "phase 1") != 1 || strings.Count(modelVisibleHistory, "phase 2") != 1 {
		t.Fatalf("model-visible terminal history duplicated a delta: %s", modelVisibleHistory)
	}
	for _, removed := range []string{"stdout", "stderr", "latest_output"} {
		if strings.Contains(modelVisibleHistory, `"`+removed+`"`) {
			t.Fatalf("model-visible terminal history retained %q: %s", removed, modelVisibleHistory)
		}
	}
}

func TestFloretOpenWorldToolDefinitionUsesConservativeStaticPermission(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.permissionType = FlowerPermissionApprovalRequired
	def, err := floretToolDefinition(r, ToolDef{
		Name:       "web.search",
		Visibility: ToolVisibilitySharedReadonly,
	})
	if err != nil {
		t.Fatalf("floretToolDefinition: %v", err)
	}
	if def.ReadOnly {
		t.Fatalf("web.search must not be projected as Floret read-only")
	}
	if def.Destructive {
		t.Fatalf("web.search must not be projected as destructive")
	}
	if !def.OpenWorld {
		t.Fatalf("web.search must be projected as open-world")
	}
	if def.Permission.Mode != fltools.PermissionAsk {
		t.Fatalf("static permission=%q, want conservative ask for open-world Floret default", def.Permission.Mode)
	}
	permission, err := def.PermissionFor(fltools.PermissionRequest{
		Name: "web.search",
		Args: map[string]any{"query": "latest floret release"},
	})
	if err != nil {
		t.Fatalf("PermissionFor: %v", err)
	}
	if permission.Mode != fltools.PermissionAllow {
		t.Fatalf("dynamic permission=%q, want allow for shared readonly search", permission.Mode)
	}
}

func TestFloretUseSkillPermissionFollowsPermissionType(t *testing.T) {
	t.Parallel()

	filter := newPermissionToolFilter(true)
	all := []ToolDef{{Name: "use_skill", Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityOpenWorld}}}
	if got := toolNames(filter.FilterTools(FlowerPermissionReadonly, all)); len(got) != 0 {
		t.Fatalf("readonly visible use_skill tools=%v, want hidden", got)
	}

	tests := []struct {
		name           string
		permissionType FlowerPermissionType
		want           fltools.PermissionMode
	}{
		{name: "readonly denies direct invocation", permissionType: FlowerPermissionReadonly, want: fltools.PermissionDeny},
		{name: "approval required asks", permissionType: FlowerPermissionApprovalRequired, want: fltools.PermissionAsk},
		{name: "full access allows dynamically", permissionType: FlowerPermissionFullAccess, want: fltools.PermissionAllow},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			r := newRun(runOptions{})
			r.permissionType = tc.permissionType
			def, err := floretToolDefinition(r, all[0])
			if err != nil {
				t.Fatalf("floretToolDefinition: %v", err)
			}
			permission, err := def.PermissionFor(fltools.PermissionRequest{
				Name: "use_skill",
				Args: map[string]any{"name": "frontend-design"},
			})
			if err != nil {
				t.Fatalf("PermissionFor: %v", err)
			}
			if permission.Mode != tc.want {
				t.Fatalf("permission=%q, want %q", permission.Mode, tc.want)
			}
		})
	}
}

func TestFloretToolDefinitionRejectsInvalidSchema(t *testing.T) {
	t.Parallel()

	_, err := floretToolDefinitionForSnapshot(ToolDef{
		Name:        "terminal.exec",
		InputSchema: json.RawMessage(`{"type":"object"`),
	}, permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(FlowerPermissionApprovalRequired, nil, nil), "test", "test", "test"))
	if err == nil || !strings.Contains(err.Error(), "invalid input schema") {
		t.Fatalf("error=%v, want invalid input schema", err)
	}
}

func TestFloretActivityForTerminalCallUsesCommandAsLabel(t *testing.T) {
	t.Parallel()

	activity := floretActivityForToolCall("terminal.exec", map[string]any{
		"command":  "npm run build -- --mode production",
		"cwd":      "/workspace/app",
		"yield_ms": 120000,
		"stdin":    "secret\nvalue",
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
	if activity.Payload["yield_ms"] != 120000 {
		t.Fatalf("payload=%#v, want yield_ms", activity.Payload)
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

func TestFloretApplyPatchResourceRefsUseCanonicalPatchParser(t *testing.T) {
	t.Parallel()

	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Add File: added.txt",
		"+hello",
		"*** Update File: old.txt",
		"@@ -1 +1 @@",
		"-old",
		"+new",
		"*** Update File: from.txt",
		"*** Move to: to.txt",
		"@@ -1 +1 @@",
		"-a",
		"+b",
		"*** Delete File: gone.txt",
		"*** End Patch",
	}, "\n")

	refs := resourceRefsFromPatch(patch)
	got := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref.Kind != "file" {
			t.Fatalf("ref kind=%q, want file", ref.Kind)
		}
		got = append(got, ref.Value)
	}
	want := []string{"added.txt", "old.txt", "from.txt", "to.txt", "gone.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("refs=%#v, want %#v", got, want)
	}
	for _, value := range got {
		if value == "/dev/null" {
			t.Fatalf("refs include /dev/null: %#v", got)
		}
	}
}

func TestFloretActivityForOKFCallUsesKnowledgeLookupPresentation(t *testing.T) {
	t.Parallel()

	indexActivity := floretActivityForToolCall("okf.index", map[string]any{"section": "AI"})
	if indexActivity == nil {
		t.Fatal("index activity is nil")
	}
	if indexActivity.Label != "AI" || indexActivity.Payload["operation"] != "okf.index" {
		t.Fatalf("index activity=%#v", indexActivity)
	}

	activity := floretActivityForToolCall("okf.search", map[string]any{})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if want := presentationCallFallback(t, "okf.search"); activity.Label != want {
		t.Fatalf("label=%q, want %q", activity.Label, want)
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
	if _, ok := withQuery.Payload["provider"]; ok {
		t.Fatalf("okf.search call payload should not carry web provider: %#v", withQuery.Payload)
	}

	openActivity := floretActivityForToolCall("okf.open", map[string]any{"concept_id": "ui.workbench-interaction-contracts"})
	if openActivity == nil {
		t.Fatal("open activity is nil")
	}
	if openActivity.Label != "ui.workbench-interaction-contracts" || openActivity.Payload["operation"] != "okf.open" {
		t.Fatalf("open activity=%#v", openActivity)
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
			"output":      "ok\n",
			"process_id":  "tp_1",
			"exit_code":   0,
			"duration_ms": 42,
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
	if got := strings.TrimSpace(anyToString(activity.Payload["output"])); got != "ok" {
		t.Fatalf("output=%q", got)
	}
	if !activityHasChip(activity.Chips, "exit_code", "0") {
		t.Fatalf("chips=%#v, want exit code chip", activity.Chips)
	}
}

func TestFloretToolResultActivityShowsTerminalProcessChips(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_terminal_process",
		ToolName: "terminal.exec",
		Status:   toolResultStatusSuccess,
		Data: map[string]any{
			"execution_location": ToolTargetModeLocalRuntime,
			"process_id":         "tp_123",
			"output":             "ok\n",
			"exit_code":          0,
			"duration_ms":        42,
		},
	})
	if !activityHasChip(activity.Chips, "execution_location", ToolTargetModeLocalRuntime) {
		t.Fatalf("chips=%#v, want execution location chip", activity.Chips)
	}
	if !activityHasChip(activity.Chips, "process_id", "tp_123") {
		t.Fatalf("chips=%#v, want process chip", activity.Chips)
	}
}

func activityHasChip(chips []observation.ActivityChip, kind string, value string) bool {
	for _, chip := range chips {
		if chip.Kind == kind && chip.Value == value {
			return true
		}
	}
	return false
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
			"total_matches":  7,
			"match_count":    3,
			"max_results":    3,
			"has_more":       true,
			"omitted_count":  4,
			"matches":        []map[string]any{{"concept_id": "ai.okf-search-tool"}},
		},
	})
	if want := presentationResultFallback(t, "okf.search"); activity.Label != want {
		t.Fatalf("label=%q, want %q", activity.Label, want)
	}
	if activity.Renderer != observation.ActivityRendererStructured {
		t.Fatalf("renderer=%q, want structured", activity.Renderer)
	}
	if activity.Payload["operation"] != "okf.search" {
		t.Fatalf("operation payload=%v, want okf.search", activity.Payload["operation"])
	}
	if _, ok := activity.Payload["results"]; ok {
		t.Fatalf("okf.search payload should use matches, not results: %#v", activity.Payload)
	}
	if _, ok := activity.Payload["matches"]; !ok {
		t.Fatalf("okf.search payload missing matches: %#v", activity.Payload)
	}
	if activity.Payload["truncated"] == true {
		t.Fatalf("okf.search short list should not report truncation: %#v", activity.Payload)
	}
	if !readBoolField(activity.Payload, "has_more") || readIntField(activity.Payload, "omitted_count") != 4 {
		t.Fatalf("okf.search payload missing bounded-list metadata: %#v", activity.Payload)
	}
	if !activityHasChip(activity.Chips, "has_more", "") {
		t.Fatalf("okf.search activity should show a neutral more chip: %#v", activity.Chips)
	}
	if activityHasChip(activity.Chips, "truncated", "") {
		t.Fatalf("okf.search short list should not show truncated chip: %#v", activity.Chips)
	}
	if activity.Label == "okf.search" || activity.Label == "Search OKF" {
		t.Fatalf("label=%q keeps search-engine wording", activity.Label)
	}
	if _, ok := activity.Payload["summary"]; ok {
		t.Fatalf("okf.search should not project summary into Flower detail payload: %#v", activity.Payload)
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

func TestFloretToolResultActivityForOKFIndexAndOpenUseStructuredFields(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	index := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_okf_index",
		ToolName: "okf.index",
		Status:   toolResultStatusSuccess,
		Summary:  toolSuccessSummary("okf.index"),
		Data: map[string]any{
			"okf_version":    "0.1",
			"total_sections": 2,
			"sections": []map[string]any{
				{
					"title": "Architecture",
					"slug":  "architecture",
					"entries": []map[string]any{
						{
							"concept_id":  "architecture.runtime-startup-presentation",
							"path":        "architecture/runtime-startup-presentation.md",
							"title":       "Runtime startup presentation",
							"type":        "Runtime Contract",
							"description": "redeven run startup output is structured events rendered by rich, plain, or machine presentation modes.",
							"tags":        []any{"architecture", "desktop", "runtime", "startup"},
						},
					},
				},
				{
					"title": "AI",
					"slug":  "ai",
					"entries": []map[string]any{
						{
							"concept_id":  "ai.okf-search-tool",
							"path":        "ai/okf-search-tool.md",
							"title":       "OKF tool suite",
							"type":        "AI Tool Contract",
							"description": "OKF tools expose read-only Redeven repository knowledge through progressive disclosure.",
							"resource":    "internal/ai/builtin_tool_handlers.go",
							"tags":        []any{"ai", "okf"},
						},
					},
				},
			},
		},
	})
	if index.Payload["operation"] != "okf.index" {
		t.Fatalf("index payload=%#v", index.Payload)
	}
	if _, ok := index.Payload["sections"]; !ok {
		t.Fatalf("index payload missing sections: %#v", index.Payload)
	}
	if index.Payload["truncated"] == true {
		t.Fatalf("okf.index structured directory should not report truncation: %#v", index.Payload)
	}
	if activityHasChip(index.Chips, "truncated", "") {
		t.Fatalf("okf.index structured directory should not show truncated chip: %#v", index.Chips)
	}
	sections := toAnySlice(index.Payload["sections"])
	if len(sections) != 2 {
		t.Fatalf("index sections=%#v, want 2 sections", index.Payload["sections"])
	}
	firstSection, _ := sections[0].(map[string]any)
	entries := toAnySlice(firstSection["entries"])
	if len(entries) != 1 {
		t.Fatalf("first section entries=%#v, want one entry", firstSection["entries"])
	}
	firstEntry, _ := entries[0].(map[string]any)
	if got := toAnySlice(firstEntry["tags"]); len(got) != 4 {
		t.Fatalf("entry tags=%#v, want preserved tags", firstEntry["tags"])
	}

	open := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_okf_open",
		ToolName: "okf.open",
		Status:   toolResultStatusSuccess,
		Summary:  toolSuccessSummary("okf.open"),
		Data: map[string]any{
			"concept":              map[string]any{"title": "OKF search tool", "concept_id": "ai.okf-search-tool"},
			"body_offset":          0,
			"body_length":          2000,
			"returned_body_length": 1000,
			"links":                []map[string]any{{"path": "ai/ai-tool-runtime.md"}},
			"backlinks":            []map[string]any{{"path": "index.md"}},
			"truncated":            true,
		},
	})
	if open.Payload["operation"] != "okf.open" {
		t.Fatalf("open payload=%#v", open.Payload)
	}
	if open.Label != "OKF search tool" {
		t.Fatalf("open label=%q, want concept title", open.Label)
	}
	if _, ok := open.Payload["concept"]; !ok {
		t.Fatalf("open payload missing concept: %#v", open.Payload)
	}
	if !readBoolField(open.Payload, "truncated") {
		t.Fatalf("open payload should retain body truncation: %#v", open.Payload)
	}
	if !activityHasChip(open.Chips, "truncated", "") {
		t.Fatalf("open body window truncation should show truncated chip: %#v", open.Chips)
	}
}

func TestFloretToolResultActivityUsesContractSafeErrorPayload(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:   "call_terminal_canceled",
		ToolName: "terminal.exec",
		Status:   toolResultStatusAborted,
		Summary:  "canceled",
		Details:  "Terminal process was canceled",
		Data: map[string]any{
			"status":      terminalProcessStatusCanceled,
			"process_id":  "tp_canceled",
			"command":     "curl -sL https://example.test",
			"exit_code":   124,
			"duration_ms": 30000,
		},
		Error: &aitools.ToolError{
			Code:      aitools.ErrorCodeCanceled,
			Message:   "Terminal process was canceled",
			Retryable: false,
		},
	})
	if activity == nil {
		t.Fatal("activity is nil")
	}
	errorPayload, ok := activity.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error payload=%#v, want map", activity.Payload["error"])
	}
	if errorPayload["code"] != "CANCELED" || errorPayload["message"] != "Terminal process was canceled" || errorPayload["retryable"] != false {
		t.Fatalf("error payload=%#v", errorPayload)
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_1"}, []observation.Event{{
		Type:     observation.EventTypeToolCall,
		ToolID:   "tool_canceled",
		ToolName: "terminal.exec",
		Activity: floretActivityForToolCall("terminal.exec", map[string]any{"command": "curl -sL https://example.test"}),
	}, {
		Type:     observation.EventTypeToolResult,
		ToolID:   "tool_canceled",
		ToolName: "terminal.exec",
		Error:    "Terminal process was canceled",
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
			ToolID:   "call_terminal_error",
			ToolName: "terminal.exec",
			Status:   toolResultStatusError,
			Data: map[string]any{
				"command": "curl -sL https://example.test/slow",
			},
			Error: &aitools.ToolError{
				Code:    aitools.ErrorCodeUnknown,
				Message: "Terminal process failed",
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
			"cwd":     "/Users/alice/private",
			"output":  strings.Repeat("o", activityPayloadStringLimit+400),
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
	if _, ok := activity.Payload["bad_key_with_spaces"]; ok {
		t.Fatalf("payload kept non-spec field: %#v", activity.Payload)
	}
	if _, ok := activity.Payload["cwd"]; ok {
		t.Fatalf("terminal activity payload kept host-only cwd: %#v", activity.Payload)
	}
	if len([]rune(anyToString(activity.Payload["output"]))) > activityPayloadStringLimit {
		t.Fatalf("output length=%d, want <= %d", len([]rune(anyToString(activity.Payload["output"]))), activityPayloadStringLimit)
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

func TestFloretToolResultActivityProjectsPublicSubagentDisplayPayload(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	normalized, truncated := normalizeTruncatedToolPayload("subagents", map[string]any{
		"action":    "close",
		"status":    "ok",
		"target":    "subagent-1",
		"thread_id": "subagent-1",
		"closed":    true,
		"items": []any{map[string]any{
			"thread_id":        "subagent-1",
			"task_name":        "Review prompt contract",
			"task_description": "Review whether the prompt contract is user-facing and concise.",
			"agent_type":       "reviewer",
			"status":           "canceled",
			"last_message":     strings.Repeat("handoff evidence ", 800),
			"updated_at_ms":    1782219585489,
			"closed":           true,
			"can_close":        false,
		}},
	})
	if !truncated {
		t.Fatal("expected large subagent payload to be field-truncated")
	}
	activity := mustFloretToolResultActivity(t, r, ToolResult{
		ToolID:    "call_close_subagent",
		ToolName:  "subagents",
		Status:    toolResultStatusSuccess,
		Summary:   "delegation.managed",
		Details:   "tool execution completed",
		Data:      normalized,
		Truncated: truncated,
	})
	for _, field := range []string{"target", "target_ids", "ids", "detail_ref", "detail_available", "detail_strategy", "last_message", "waiting_prompt", "can_send_input", "can_interrupt", "can_close"} {
		if _, ok := activity.Payload[field]; ok {
			t.Fatalf("activity retained non-display subagent field %s: %#v", field, activity.Payload)
		}
	}
	items := toAnySlice(activity.Payload["items"])
	if len(items) != 1 {
		t.Fatalf("activity items=%#v, want one canonical item", activity.Payload["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("activity item type=%T payload=%#v", items[0], activity.Payload)
	}
	if anyToString(activity.Payload["action"]) != "close" || anyToString(item["status"]) != "canceled" {
		t.Fatalf("activity lost close lifecycle state: %#v", activity.Payload)
	}
	if anyToString(item["task_name"]) != "Review prompt contract" || anyToString(item["task_description"]) == "" || anyToString(item["agent_type"]) != "reviewer" {
		t.Fatalf("activity lost subagent display fields: %#v", item)
	}
	for _, field := range []string{"context_mode", "last_message", "result_digest", "waiting_prompt", "queued_inputs", "can_send_input", "can_interrupt", "can_close", "detail_ref"} {
		if _, ok := item[field]; ok {
			t.Fatalf("activity item retained non-display field %s: %#v", field, item)
		}
	}
	if _, ok := activity.Payload["details"]; ok {
		t.Fatalf("activity retained generic completion details: %#v", activity.Payload)
	}
	if activity.Payload["truncated"] != true {
		t.Fatalf("activity payload truncated flag=%#v, want true", activity.Payload["truncated"])
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
	if result.Activity == nil {
		t.Fatal("activity=nil, want write_todos error activity")
	}
	activityError, ok := result.Activity.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("activity error=%#v, want map", result.Activity.Payload["error"])
	}
	if got := anyToString(activityError["message"]); got != "Denied" {
		t.Fatalf("activity error message=%q, want Denied", got)
	}
	if _, ok := activityError["suggested_fixes"]; ok {
		t.Fatalf("activity error kept old envelope: %#v", activityError)
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

func TestFloretToolResultFromFlowerMapsAbortedToCanceledActivityStatus(t *testing.T) {
	t.Parallel()

	result, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
		ToolID:   "call_terminal_canceled",
		ToolName: "terminal.exec",
		Status:   toolResultStatusAborted,
		Summary:  "tool.aborted",
		Details:  "Terminal process was canceled",
		Data: map[string]any{
			"status":     terminalProcessStatusCanceled,
			"process_id": "tp_canceled",
			"command":    "sleep 10",
		},
		Error: &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Terminal process was canceled"},
	})
	if err != nil {
		t.Fatalf("floretToolResultFromFlower: %v", err)
	}
	if result.IsError {
		t.Fatalf("aborted terminal result must project as canceled activity, not generic error: %#v", result)
	}
	if got := result.Metadata["tool_result_status"]; got != string(observation.ActivityStatusCanceled) {
		t.Fatalf("tool_result_status=%#v, want canceled", got)
	}
	if result.Activity == nil || result.Activity.Payload["status"] != toolResultStatusAborted {
		t.Fatalf("activity=%#v, want aborted product payload", result.Activity)
	}
}

func TestFloretToolResultFromFlowerAddsTerminalReadProgressToken(t *testing.T) {
	t.Parallel()

	result, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
		ToolID:   "call_terminal_read",
		ToolName: "terminal.read",
		Status:   toolResultStatusSuccess,
		Summary:  "terminal.read",
		Data: map[string]any{
			"status":      terminalProcessStatusRunning,
			"process_id":  "tp_progress",
			"last_seq":    int64(7),
			"ended_at_ms": int64(0),
		},
	})
	if err != nil {
		t.Fatalf("floretToolResultFromFlower: %v", err)
	}
	if got := result.Metadata[fltools.ResultMetadataProgressToken]; got != "tp_progress:7:running:0" {
		t.Fatalf("progress token=%#v, want process/last_seq/status/ended_at_ms token", got)
	}

	execResult, err := floretToolResultFromFlower(newRun(runOptions{}), ToolResult{
		ToolID:   "call_terminal_exec",
		ToolName: "terminal.exec",
		Status:   toolResultStatusSuccess,
		Data:     map[string]any{"status": terminalProcessStatusSuccess, "process_id": "tp_progress", "last_seq": int64(7)},
	})
	if err != nil {
		t.Fatalf("floretToolResultFromFlower terminal.exec: %v", err)
	}
	if _, ok := execResult.Metadata[fltools.ResultMetadataProgressToken]; ok {
		t.Fatalf("terminal.exec must not carry polling progress token: %#v", execResult.Metadata)
	}
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

func TestFloretToolRegistryKeepsTerminalExecOnLocalRuntime(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	svc := &Service{terminalProcesses: manager}
	r := newRunWithProductStoreForTest(t, runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:         "env_test",
		ThreadID:           "thread_terminal_local",
		RunID:              "run_terminal_local",
		MessageID:          "turn_terminal_local",
		HostCapabilities:   bindTestRunHostCapabilities(t, svc, "env_test", "thread_terminal_local"),
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: executor,
	})
	allowToolsForTest(t, r, "terminal.exec")
	owner := &terminalProcessTestOwner{}
	r.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })
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

	result := registry.Dispatch(context.Background(), fltools.ToolCall{
		ID:   "call_1",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, floretToolRegistryParentRunOptions(r, "target_context"))
	if result.IsError {
		t.Fatalf("registry result error text=%q structured=%#v", result.Text, result.Structured)
	}
	if executor.call.ToolName != "" {
		t.Fatalf("terminal.exec must not be forwarded to target executor: %#v", executor.call)
	}
	data, _ := result.Structured["data"].(map[string]any)
	if data == nil {
		t.Fatalf("structured result missing data: %#v", result.Structured)
	}
	if got := strings.TrimSpace(anyToString(data["execution_location"])); got != ToolTargetModeLocalRuntime {
		t.Fatalf("execution_location=%q, want %q", got, ToolTargetModeLocalRuntime)
	}
}

func TestFloretToolRegistryPublishesTerminalProcessActivityUpdateBeforeYieldResult(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	svc := &Service{terminalProcesses: manager}
	r := newRunWithProductStoreForTest(t, runOptions{
		AgentHomeDir:     t.TempDir(),
		SessionMeta:      &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:       "env_test",
		ThreadID:         "thread_terminal_activity",
		RunID:            "run_terminal_activity",
		MessageID:        "turn_terminal_activity",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env_test", "thread_terminal_activity"),
	})
	allowToolsForTest(t, r, "terminal.exec")
	owner := &terminalProcessTestOwner{}
	r.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name:        "terminal.exec",
		Description: "Execute a shell command.",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"},"yield_ms":{"type":"integer"}},"required":["command"],"additionalProperties":false}`,
		),
		Source:    "builtin",
		Namespace: "builtin.terminal",
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	var updates []fltools.ToolActivityUpdate
	opts := floretToolRegistryParentRunOptions(r, "terminal_activity_update")
	opts.ActivityUpdated = func(update fltools.ToolActivityUpdate) {
		updates = append(updates, update)
	}
	result := registry.Dispatch(context.Background(), fltools.ToolCall{
		ID:   "call_live_terminal",
		Name: "terminal.exec",
		Args: `{"command":"sleep 0.2","yield_ms":1000}`,
	}, opts)
	if result.IsError {
		t.Fatalf("registry result error text=%q structured=%#v", result.Text, result.Structured)
	}
	if len(updates) == 0 {
		t.Fatal("terminal.exec should publish an activity update as soon as the process starts")
	}
	update := updates[0]
	if update.CallID != "call_live_terminal" || update.Name != "terminal.exec" {
		t.Fatalf("update identity=%q/%q", update.CallID, update.Name)
	}
	if update.Activity == nil {
		t.Fatal("update activity is nil")
	}
	payload := update.Activity.Payload
	if got := strings.TrimSpace(anyToString(payload["status"])); got != terminalProcessStatusRunning {
		t.Fatalf("activity status=%q, want running; payload=%#v", got, payload)
	}
	if got := strings.TrimSpace(anyToString(payload["process_id"])); got == "" || !strings.HasPrefix(got, "tp_") {
		t.Fatalf("activity process_id=%q, want terminal process id; payload=%#v", got, payload)
	}
	if got := strings.TrimSpace(anyToString(payload["command"])); got != "sleep 0.2" {
		t.Fatalf("activity command=%q, want command payload", got)
	}
	if update.Activity.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("renderer=%q, want terminal", update.Activity.Renderer)
	}
}

func TestFloretToolRegistryDoesNotAddProfileOnlyMutationBlock(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir: t.TempDir(),
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	})
	allowToolsForTest(t, r, "file.write")
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name: "file.write",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`,
		),
		Mutating:         true,
		RequiresApproval: true,
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	opts := floretToolRegistryParentRunOptions(r, "profile_only_mutation")
	opts.HostContext[subagentToolHostContextAgentTypeKey] = subagentAgentTypeReviewer
	result := registry.Dispatch(context.Background(), fltools.ToolCall{
		ID:   "call_write",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, opts)
	if result.IsError {
		t.Fatalf("reviewer profile alone must not add registry mutation block: text=%q structured=%#v", result.Text, result.Structured)
	}
}

func TestFloretToolRegistryAllowsWorkerSubagentMutatingTools(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:         "env_test",
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: executor,
	})
	allowToolsForTest(t, r, "file.write")
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name: "file.write",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`,
		),
		Mutating:         true,
		RequiresApproval: true,
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	opts := floretToolRegistryParentRunOptions(r, "worker_mutation")
	opts.HostContext[subagentToolHostContextAgentTypeKey] = subagentAgentTypeWorker
	result := registry.Dispatch(context.Background(), fltools.ToolCall{
		ID:   "call_write_worker",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, opts)
	if result.IsError {
		t.Fatalf("worker mutation result error text=%q structured=%#v", result.Text, result.Structured)
	}
	if executor.call.TargetID == "" {
		t.Fatalf("file.write was not forwarded")
	}
}

func TestFloretToolRegistryUsesExplicitChildHostIdentityForSubagentTools(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	storePath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(storePath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()
	svc := &Service{terminalProcesses: manager, threadsDB: store}
	r := newRunWithProductStoreForTest(t, runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:            "run_parent",
		EndpointID:       "env_test",
		ThreadID:         "thread_parent",
		MessageID:        "msg_parent",
		AgentHomeDir:     t.TempDir(),
		Shell:            "bash",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env_test", "thread_parent"),
		SessionMeta:      &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		PersistOpTimeout: 5 * time.Second,
	}, store)
	r.permissionType = FlowerPermissionFullAccess
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{EndpointID: r.endpointID, ThreadID: r.threadID, PermissionType: config.AIPermissionFullAccess}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	ensureToolExecutionAuthorityForTest(t, r)
	freezePermissionPolicyTestSnapshot(t, r)
	childRunID := permissionPolicyTestChildRunID("thread_child")
	childSnapshot := insertPermissionPolicyChildSnapshot(t, r, "thread_child", "terminal.exec")
	childExecution, err := svc.bindSubagentExecutionForParent(r, "thread_child", childRunID)
	if err != nil {
		t.Fatalf("bind child execution authority: %v", err)
	}
	childBase := r.subagentChildRun(childExecution)
	childBase.threadID = "thread_child"
	childBase.id = childRunID
	childBase.turnID = "turn_child"
	childBase.messageID = "turn_child"
	childBase.settlementThreadID = "thread_child"
	childBase.settlementRunID = "floret_exec_child_identity"
	childBase.settlementTurnID = "turn_child"
	childBase.toolAllowlist = stringSet("terminal.exec")
	childBase.setPermissionState(childSnapshot.PermissionType, childSnapshot)
	if err := childBase.persistPermissionSnapshot(childSnapshot); err != nil {
		t.Fatalf("persist current child permission snapshot: %v", err)
	}
	owner := &terminalProcessTestOwner{}
	childBase.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })
	registry, err := buildFloretToolRegistry(childBase, []ToolDef{{
		Name: "terminal.exec",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`,
		),
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	result := registry.Dispatch(ctx, fltools.ToolCall{
		ID:   "call_child_pwd",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, fltools.DispatchOptions{
		RunID:    "floret_exec_child_identity",
		ThreadID: "thread_child",
		TurnID:   "turn_child",
		Step:     1,
		HostContext: map[string]string{
			subagentToolHostContextAgentTypeKey:          subagentAgentTypeWorker,
			subagentToolHostContextChildThreadIDKey:      "thread_child",
			subagentToolHostContextChildRunIDKey:         childRunID,
			floretToolHostContextPermissionSnapshotIDKey: childSnapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(childSnapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
			subagentToolHostContextForkModeKey:           string(flruntime.SubAgentForkNone),
		},
		EffectDispatcher: floretToolRegistryTestEffectDispatcher(childBase),
	})
	if result.IsError {
		t.Fatalf("registry result error text=%q structured=%#v", result.Text, result.Structured)
	}

	childProcesses := manager.ProcessesForRun("env_test", "thread_child", childRunID)
	if len(childProcesses) != 1 {
		t.Fatalf("child processes=%d, want 1", len(childProcesses))
	}
	if parentProcesses := manager.ProcessesForRun("env_test", "thread_parent", "run_parent"); len(parentProcesses) != 0 {
		t.Fatalf("child terminal process leaked to parent run: %#v", parentProcesses)
	}
	childProcesses[0].mu.Lock()
	target := childProcesses[0].settlementTarget
	boundOwner := childProcesses[0].activeSettlementOwner
	childProcesses[0].mu.Unlock()
	if target.ThreadID != "thread_child" || target.RunID != "floret_exec_child_identity" || target.TurnID != "turn_child" || target.ToolCallID != "call_child_pwd" {
		t.Fatalf("child settlement target=%#v", target)
	}
	if boundOwner != owner {
		t.Fatalf("child settlement owner=%T, want explicit child host owner", boundOwner)
	}
}

func TestFloretToolRegistryDoesNotCreateRedevenApprovalForSubagentEffect(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{threadsDB: store}
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	parent := newRunWithProductStoreForTest(t, runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true},
		AIConfig:           &config.AIConfig{},
		EndpointID:         "env_no_grant",
		RunID:              "parent_run_no_grant",
		ThreadID:           "parent_thread_no_grant",
		MessageID:          "parent_turn_no_grant",
		HostCapabilities:   bindTestRunHostCapabilities(t, svc, "env_no_grant", "parent_thread_no_grant"),
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: &recordingTargetToolExecutor{},
	}, store)
	parent.setPermissionType(FlowerPermissionApprovalRequired)
	ensureToolExecutionAuthorityForTest(t, parent)
	childExecution, err := svc.bindSubagentExecutionForParent(parent, "thread_worker", "child_run_no_grant")
	if err != nil {
		t.Fatalf("bind child execution authority: %v", err)
	}
	child := parent.subagentChildRun(childExecution)
	child.threadID = "thread_worker"
	child.id = "child_run_no_grant"
	child.turnID = "turn_worker"
	child.messageID = "turn_worker"
	child.settlementThreadID = "thread_worker"
	child.settlementRunID = "floret_exec_worker_no_grant"
	child.settlementTurnID = "turn_worker"
	toolDef := ToolDef{
		Name: "file.write",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`,
		),
		Mutating:         true,
		RequiresApproval: true,
	}
	childSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, []ToolDef{toolDef}, nil), child.endpointID, child.threadID, child.id,
	)
	child.setPermissionState(FlowerPermissionApprovalRequired, childSnapshot)
	if err := child.persistPermissionSnapshot(childSnapshot); err != nil {
		t.Fatal(err)
	}
	registry, err := buildFloretToolRegistry(child, []ToolDef{toolDef}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	result := registry.Dispatch(context.Background(), fltools.ToolCall{
		ID:   "call_write_no_grant",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, fltools.DispatchOptions{
		RunID:    "floret_exec_worker_no_grant",
		ThreadID: "thread_worker",
		TurnID:   "turn_worker",
		HostContext: map[string]string{
			subagentToolHostContextAgentTypeKey:          subagentAgentTypeWorker,
			subagentToolHostContextChildThreadIDKey:      "thread_worker",
			subagentToolHostContextChildRunIDKey:         "child_run_no_grant",
			floretToolHostContextPermissionSnapshotIDKey: child.currentPermissionSnapshot().SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(child.currentPermissionSnapshot()),
			floretToolHostContextAuthorityThreadIDKey:    parent.threadID,
			subagentToolHostContextForkModeKey:           string(flruntime.SubAgentForkNone),
		},
		EffectDispatcher: floretToolRegistryTestEffectDispatcher(child),
	})
	if result.IsError {
		t.Fatalf("result=%#v error=%q, want post-Floret effect dispatch to use the canonical decision", result, floretToolResultErrorText(result))
	}
	child.mu.Lock()
	defer child.mu.Unlock()
	if len(child.toolApprovals) != 0 {
		t.Fatalf("Redeven created an approval shadow for a Floret-authorized effect: %#v", child.toolApprovals)
	}
}

func TestRootNoUserInteractionRefreshesPermissionBeforeToolHandler(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	storePath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(storePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	const endpointID = "env_root_no_interaction_refresh"
	const threadID = "thread_root_no_interaction_refresh"
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		EndpointID: endpointID, ThreadID: threadID, PermissionType: config.AIPermissionFullAccess,
		WorkingDir: workspace, SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	r := newRunWithProductStoreForTest(t, runOptions{
		AgentHomeDir: workspace, WorkingDir: workspace, Shell: "/bin/bash",
		RunID: "run_root_no_interaction_refresh", EndpointID: endpointID, ThreadID: threadID,
		MessageID: "turn_root_no_interaction_refresh", NoUserInteraction: true,
		SessionMeta: &session.Meta{EndpointID: endpointID, CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
	}, store)
	ensureToolExecutionAuthorityForTest(t, r)
	r.dynamicSurfaceConfig = r.buildDynamicToolSurfaceConfig("write marker", TaskComplexityStandard, false, nil, nil)
	surface, err := r.buildRunToolSurface(ctx, r.dynamicSurfaceConfig)
	if err != nil {
		t.Fatal(err)
	}
	rawDB, err := sql.Open("sqlite", "file:"+storePath+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	rawDB.SetMaxOpenConns(1)
	defer func() { _ = rawDB.Close() }()
	if _, err := rawDB.ExecContext(ctx, `UPDATE ai_thread_settings SET permission_type = 'invalid' WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(workspace, "handler_called")
	result := surface.FloretTools.Dispatch(ctx, fltools.ToolCall{
		ID: "call_root_no_interaction_refresh", Name: "file.write",
		Args: `{"file_path":"handler_called","content":"must not write"}`,
	}, fltools.DispatchOptions{RunID: r.id, ThreadID: r.threadID, TurnID: r.turnID, HostContext: surface.HostContext, EffectDispatcher: floretToolRegistryTestEffectDispatcher(r)})
	if !result.IsError || !strings.Contains(floretToolResultErrorText(result), "invalid thread permission type") {
		t.Fatalf("tool result=%#v, want strict permission refresh failure", result)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("tool handler created marker, stat error=%v", err)
	}
}

func TestRootPermissionDowngradeRejectsStaleAllowBeforeToolHandler(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	const endpointID = "env_root_allow_to_ask"
	const threadID = "thread_root_allow_to_ask"
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		EndpointID: endpointID, ThreadID: threadID, PermissionType: config.AIPermissionFullAccess,
		WorkingDir: workspace, SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	r := newRunWithProductStoreForTest(t, runOptions{
		AgentHomeDir: workspace, WorkingDir: workspace,
		RunID: "run_root_allow_to_ask", EndpointID: endpointID, ThreadID: threadID, MessageID: "turn_root_allow_to_ask",
		SessionMeta: &session.Meta{EndpointID: endpointID, CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
	}, store)
	ensureToolExecutionAuthorityForTest(t, r)
	r.dynamicSurfaceConfig = r.buildDynamicToolSurfaceConfig("write marker", TaskComplexityStandard, false, nil, nil)
	surface, err := r.buildRunToolSurface(ctx, r.dynamicSurfaceConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, endpointID, threadID, config.AIPermissionApprovalRequired); err != nil {
		t.Fatal(err)
	}
	approvalCalls := 0
	result := surface.FloretTools.Dispatch(ctx, fltools.ToolCall{
		ID: "call_root_allow_to_ask", Name: "file.write",
		Args: `{"file_path":"handler_called","content":"must not write"}`,
	}, fltools.DispatchOptions{RunID: r.id, ThreadID: r.threadID, TurnID: r.turnID, HostContext: surface.HostContext, EffectDispatcher: floretToolRegistryTestEffectDispatcher(r)})
	if !result.IsError || !strings.Contains(strings.ToLower(floretToolResultErrorText(result)), "authorization snapshot is stale") {
		t.Fatalf("tool result=%#v, want stale authorization rejection", result)
	}
	if approvalCalls != 0 {
		t.Fatalf("approval calls=%d, want no retroactive approval for stale allow dispatch", approvalCalls)
	}
	if _, err := os.Stat(filepath.Join(workspace, "handler_called")); !os.IsNotExist(err) {
		t.Fatalf("tool handler created marker, stat error=%v", err)
	}
}

func TestFloretToolApprovalRejectsMissingPermissionSnapshot(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		RunID: "run_missing_snapshot", ThreadID: "thread_missing_snapshot",
		TurnID: "turn_missing_snapshot", MessageID: "message_missing_snapshot",
	})
	r.permissionType = FlowerPermissionFullAccess
	_, err := r.dispatchFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_missing_snapshot", RequestFingerprint: "fingerprint_missing_snapshot",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id), ToolCallID: "call_missing_snapshot",
		ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_missing_snapshot", LeaseGeneration: 1,
		HostContext: map[string]string{floretToolHostContextAuthorityThreadIDKey: r.threadID},
	}, func(context.Context, flruntime.EffectAuthorizationProof) (flruntime.EffectDispatchResult, error) {
		t.Fatal("effect handler must not run without a permission snapshot")
		return flruntime.EffectDispatchResult{}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "permission snapshot") {
		t.Fatalf("dispatchFloretEffect error=%v, want missing snapshot error", err)
	}
	r.mu.Lock()
	pending := len(r.toolApprovals)
	r.mu.Unlock()
	if pending != 0 {
		t.Fatalf("pending approvals=%d, want 0", pending)
	}
}

func TestSubagentsToolPermissionForDynamicActions(t *testing.T) {
	t.Parallel()

	permissionTypes := []FlowerPermissionType{
		FlowerPermissionReadonly,
		FlowerPermissionApprovalRequired,
		FlowerPermissionFullAccess,
	}
	actions := []map[string]any{
		{"action": "spawn", "agent_type": "reviewer"},
		{"action": "spawn", "agent_type": "worker"},
		{"action": "wait"},
		{"action": "send_input", "interrupt": true},
		{"action": "close"},
		{"action": "list"},
		{"action": "inspect"},
		{"action": "close_all"},
	}
	for _, permissionType := range permissionTypes {
		permissionType := permissionType
		t.Run(permissionTypeString(permissionType), func(t *testing.T) {
			t.Parallel()

			r := newRun(runOptions{})
			r.permissionType = permissionType
			def, err := floretToolDefinition(r, ToolDef{
				Name:         "subagents",
				Mutating:     false,
				Visibility:   ToolVisibilityDelegationControl,
				Capabilities: []ToolCapabilityClass{ToolCapabilityDelegation},
				InputSchema:  json.RawMessage(`{"type":"object","properties":{"action":{"type":"string"},"agent_type":{"type":"string"},"interrupt":{"type":"boolean"}},"additionalProperties":false}`),
			})
			if err != nil {
				t.Fatalf("floretToolDefinition: %v", err)
			}
			for _, args := range actions {
				args := args
				t.Run(anyToString(args["action"]), func(t *testing.T) {
					t.Parallel()
					spec, err := def.PermissionFor(fltools.PermissionRequest{Name: "subagents", Args: args})
					if err != nil {
						t.Fatalf("PermissionFor: %v", err)
					}
					if spec.Mode != fltools.PermissionAllow {
						t.Fatalf("subagents args=%v permission=%q, want allow for delegation control", args, spec.Mode)
					}
				})
			}
		})
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
