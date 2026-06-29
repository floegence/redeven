package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
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

func presentationCallFallback(t *testing.T, toolName string) string {
	t.Helper()
	return aitools.MustPresentationSpec(toolName).CallLabelFallback
}

func presentationResultFallback(t *testing.T, toolName string) string {
	t.Helper()
	return aitools.MustPresentationSpec(toolName).ResultLabelFallback
}

func floretToolRegistryParentRunOptions(r *run, suffix string) fltools.RunOptions {
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
	if strings.TrimSpace(r.messageID) == "" {
		r.messageID = "turn_" + suffix
	}
	return fltools.RunOptions{
		RunID:         strings.TrimSpace(r.id),
		ThreadID:      strings.TrimSpace(r.threadID),
		TurnID:        strings.TrimSpace(r.messageID),
		PromptScopeID: strings.TrimSpace(r.threadID),
		Step:          1,
	}
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

func TestFloretOpenWorldToolDefinitionUsesConservativeStaticPermission(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.permissionType = FlowerPermissionApprovalRequired
	def, err := floretToolDefinition(r, ToolDef{
		Name:         "web.search",
		ParallelSafe: true,
		Visibility:   ToolVisibilitySharedReadonly,
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

	_, err := floretToolDefinition(nil, ToolDef{
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
	if _, ok := activity.Payload["bad_key_with_spaces"]; ok {
		t.Fatalf("payload kept non-spec field: %#v", activity.Payload)
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

func TestFloretToolResultActivityPreservesSubagentLifecycleSnapshot(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	normalized, truncated := normalizeTruncatedToolPayload("subagents", map[string]any{
		"action":      "close",
		"status":      "ok",
		"target":      "subagent-1",
		"subagent_id": "subagent-1",
		"thread_id":   "subagent-1",
		"closed":      true,
		"snapshot": map[string]any{
			"subagent_id":   "subagent-1",
			"thread_id":     "subagent-1",
			"task_name":     "Review prompt contract",
			"agent_type":    "reviewer",
			"status":        "canceled",
			"last_message":  strings.Repeat("handoff evidence ", 800),
			"updated_at_ms": 1782219585489,
			"closed":        true,
			"can_close":     false,
		},
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
	snapshot, ok := activity.Payload["snapshot"].(map[string]any)
	if !ok {
		t.Fatalf("activity snapshot type=%T payload=%#v", activity.Payload["snapshot"], activity.Payload)
	}
	if anyToString(activity.Payload["action"]) != "close" || anyToString(snapshot["status"]) != "canceled" {
		t.Fatalf("activity lost close lifecycle state: %#v", activity.Payload)
	}
	if anyToString(snapshot["thread_id"]) != "subagent-1" || anyToString(snapshot["agent_type"]) != "reviewer" {
		t.Fatalf("activity lost subagent identity: %#v", snapshot)
	}
	if len([]rune(anyToString(snapshot["last_message"]))) > 3000 {
		t.Fatalf("activity last_message was not field-truncated: %d", len([]rune(anyToString(snapshot["last_message"]))))
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

func TestFloretToolRegistryKeepsTerminalExecOnLocalRuntime(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:         "env_test",
		Service:            &Service{terminalProcesses: manager},
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

	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_1",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, func(context.Context, fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
		return fltools.PermissionDecisionAllow, nil
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

func TestFloretToolRegistryDoesNotAddProfileOnlyMutationBlock(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir: t.TempDir(),
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	})
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
	opts.HostContext = map[string]string{subagentToolHostContextAgentTypeKey: subagentAgentTypeReviewer}
	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_write",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, func(context.Context, fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
		return fltools.PermissionDecisionAllow, nil
	}, opts)
	if result.IsError {
		t.Fatalf("reviewer profile alone must not add registry mutation block: text=%q structured=%#v", result.Text, result.Structured)
	}
}

func TestFloretToolRegistryDeniesReadonlySubagentShellTools(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanExecute: true},
		EndpointID:         "env_test",
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: executor,
	})
	r.permissionType = FlowerPermissionReadonly
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name: "terminal.exec",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`,
		),
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	opts := floretToolRegistryParentRunOptions(r, "readonly_subagent_shell")
	opts.HostContext = map[string]string{subagentToolHostContextAgentTypeKey: subagentAgentTypeExplore}
	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_pwd",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, nil, opts)
	if !result.IsError {
		t.Fatalf("readonly subagent shell result=%#v, want permission denial", result)
	}
	if executor.call.ToolName != "" {
		t.Fatalf("terminal.exec must not be forwarded in readonly subagent: %#v", executor.call)
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
	opts.HostContext = map[string]string{subagentToolHostContextAgentTypeKey: subagentAgentTypeWorker}
	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_write_worker",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, func(context.Context, fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
		return fltools.PermissionDecisionAllow, nil
	}, opts)
	if result.IsError {
		t.Fatalf("worker mutation result error text=%q structured=%#v", result.Text, result.Structured)
	}
	if executor.call.TargetID == "" {
		t.Fatalf("file.write was not forwarded")
	}
}

func TestFloretToolRegistryBlocksWorkerMutationsWhenReadonlyPermissionApplies(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: &recordingTargetToolExecutor{},
	})
	r.permissionType = FlowerPermissionReadonly
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name:       "terminal.exec",
		Visibility: ToolVisibilityStandard,
		Capabilities: []ToolCapabilityClass{
			ToolCapabilityShell,
			ToolCapabilityOpenWorld,
		},
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`,
		),
		RequiresApproval: true,
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	opts := floretToolRegistryParentRunOptions(r, "readonly_worker_mutation")
	opts.HostContext = map[string]string{
		subagentToolHostContextAgentTypeKey: subagentAgentTypeWorker,
	}
	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_plan_worker_mutation",
		Name: "terminal.exec",
		Args: `{"command":"mkdir -p should-not-run"}`,
	}, floretToolApproverForRun(r), opts)
	if !result.IsError || !strings.Contains(strings.ToLower(result.Text), "rejected") {
		t.Fatalf("readonly worker mutation result=%#v, want permission denial", result)
	}
}

func TestFloretToolRegistryUsesExplicitChildHostIdentityForSubagentTools(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	childRunID := "child_run_identity"
	for _, rec := range []threadstore.RunRecord{
		{RunID: "run_parent", EndpointID: "env_test", ThreadID: "thread_parent", MessageID: "msg_parent", State: "running"},
		{RunID: childRunID, EndpointID: "env_test", ThreadID: "thread_child", MessageID: "turn_child", State: "running"},
	} {
		if err := store.UpsertRun(ctx, rec); err != nil {
			t.Fatalf("UpsertRun(%s): %v", rec.RunID, err)
		}
	}

	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	r := newRun(runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:            "run_parent",
		EndpointID:       "env_test",
		ThreadID:         "thread_parent",
		MessageID:        "msg_parent",
		AgentHomeDir:     t.TempDir(),
		Shell:            "bash",
		Service:          &Service{terminalProcesses: manager},
		ThreadsDB:        store,
		SessionMeta:      &session.Meta{CanRead: true, CanExecute: true},
		PersistOpTimeout: 5 * time.Second,
	})
	registry, err := buildFloretToolRegistry(r, []ToolDef{{
		Name: "terminal.exec",
		InputSchema: json.RawMessage(
			`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`,
		),
	}}, nil)
	if err != nil {
		t.Fatalf("buildFloretToolRegistry: %v", err)
	}

	result := registry.RunWithOptions(ctx, fltools.ToolCall{
		ID:   "call_child_pwd",
		Name: "terminal.exec",
		Args: `{"command":"pwd"}`,
	}, func(context.Context, fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
		return fltools.PermissionDecisionAllow, nil
	}, fltools.RunOptions{
		RunID:    "floret_exec_child_identity",
		ThreadID: "thread_child",
		TurnID:   "turn_child",
		Step:     1,
		HostContext: map[string]string{
			subagentToolHostContextAgentTypeKey:        subagentAgentTypeWorker,
			subagentToolHostContextChildThreadIDKey:    "thread_child",
			subagentToolHostContextSubagentIDKey:       "thread_child",
			subagentToolHostContextChildRunIDKey:       childRunID,
			subagentToolHostContextParentPermissionKey: permissionTypeString(FlowerPermissionFullAccess),
		},
	})
	if result.IsError {
		t.Fatalf("registry result error text=%q structured=%#v", result.Text, result.Structured)
	}

	childCall, err := store.GetToolCall(ctx, "env_test", childRunID, "call_child_pwd")
	if err != nil {
		t.Fatalf("GetToolCall child: %v", err)
	}
	if childCall == nil || childCall.RunID != childRunID {
		t.Fatalf("child tool call=%#v", childCall)
	}
	if _, err := store.GetToolCall(ctx, "env_test", "run_parent", "call_child_pwd"); err == nil {
		t.Fatalf("child tool call must not be persisted under parent run")
	}
	childSpans, err := store.ListRecentExecutionSpansByThread(ctx, "env_test", "thread_child", 10)
	if err != nil {
		t.Fatalf("ListRecentExecutionSpansByThread child: %v", err)
	}
	if len(childSpans) == 0 {
		t.Fatalf("missing child execution span")
	}
	for _, span := range childSpans {
		if span.RunID != childRunID || span.ThreadID != "thread_child" {
			t.Fatalf("child span persisted with parent identity: %#v", span)
		}
	}
	parentSpans, err := store.ListRecentExecutionSpansByThread(ctx, "env_test", "thread_parent", 10)
	if err != nil {
		t.Fatalf("ListRecentExecutionSpansByThread parent: %v", err)
	}
	for _, span := range parentSpans {
		if span.Name == "terminal.exec" && strings.Contains(span.SpanID, "call_child_pwd") {
			t.Fatalf("child terminal span leaked to parent thread: %#v", span)
		}
	}
}

func TestFloretToolRegistryDeniesNoUserInteractionApprovalWithoutDelegation(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true},
		AIConfig:           &config.AIConfig{},
		NoUserInteraction:  true,
		SubagentDepth:      1,
		RunID:              "child_run_no_grant",
		ThreadID:           "thread_worker",
		MessageID:          "turn_worker",
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:target_1"},
		TargetToolExecutor: &recordingTargetToolExecutor{},
	})
	r.permissionType = FlowerPermissionApprovalRequired
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

	result := registry.RunWithOptions(context.Background(), fltools.ToolCall{
		ID:   "call_write_no_grant",
		Name: "file.write",
		Args: `{"file_path":"note.txt","content":"mutate"}`,
	}, floretToolApproverForRun(r), fltools.RunOptions{
		RunID:    "floret_exec_worker_no_grant",
		ThreadID: "thread_worker",
		TurnID:   "turn_worker",
		HostContext: map[string]string{
			subagentToolHostContextAgentTypeKey:        subagentAgentTypeWorker,
			subagentToolHostContextChildThreadIDKey:    "thread_worker",
			subagentToolHostContextSubagentIDKey:       "thread_worker",
			subagentToolHostContextChildRunIDKey:       "child_run_no_grant",
			subagentToolHostContextParentPermissionKey: permissionTypeString(FlowerPermissionApprovalRequired),
		},
	})
	if !result.IsError || !strings.Contains(strings.ToLower(result.Text), "delegated approval is unavailable") {
		t.Fatalf("result=%#v, want no-user-interaction approval denial", result)
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
				ParallelSafe: false,
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
