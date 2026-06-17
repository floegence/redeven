package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestBuiltInToolDefinitions_AskUserDescriptionMentionsStructuredInput(t *testing.T) {
	t.Parallel()

	defs := builtInToolDefinitions()
	for _, def := range defs {
		if strings.TrimSpace(def.Name) != "ask_user" {
			continue
		}
		if !strings.Contains(def.Description, "required structured input") {
			t.Fatalf("ask_user description missing structured-input guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "guided interaction turn") {
			t.Fatalf("ask_user description missing guided interaction guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Each question must declare response_mode") {
			t.Fatalf("ask_user description missing response_mode guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "choices_exhaustive") {
			t.Fatalf("ask_user description missing choices_exhaustive guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Preserve explicit interaction-shape constraints from the user") {
			t.Fatalf("ask_user description missing interaction-shape guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "choices[] should contain fixed options only") {
			t.Fatalf("ask_user description missing fixed-choice-only guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Do not use it to delegate tool-collectable work") {
			t.Fatalf("ask_user description missing collectable-work rejection: %q", def.Description)
		}
		return
	}

	t.Fatalf("ask_user tool definition not found")
}

func TestNormalizeTruncatedToolPayload_PreservesApplyPatchStructure(t *testing.T) {
	t.Parallel()

	longPatch := strings.Repeat("+after\n", 1200)
	payload := ApplyPatchResult{
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
			Additions:   1200,
			UnifiedDiff: "--- a/workspace/app.ts\n+++ b/workspace/app.ts\n@@ -1,0 +1,1200 @@\n" + longPatch,
		}},
	}

	normalized, truncated := normalizeTruncatedToolPayload("apply_patch", payload)
	if !truncated {
		t.Fatal("expected apply_patch payload to be field-truncated")
	}
	root, ok := normalized.(map[string]any)
	if !ok {
		t.Fatalf("normalized type=%T, want map", normalized)
	}
	if _, ok := root["raw"]; ok {
		t.Fatalf("apply_patch payload must not collapse to raw: %#v", root)
	}
	mutations := toAnySlice(root["mutations"])
	if len(mutations) != 1 {
		t.Fatalf("mutations=%#v, want one mutation", root["mutations"])
	}
	mutation, ok := mutations[0].(map[string]any)
	if !ok {
		t.Fatalf("mutation type=%T", mutations[0])
	}
	if anyToString(mutation["file_path"]) != "/workspace/app.ts" || anyToString(mutation["change_type"]) != "update" {
		t.Fatalf("mutation=%#v, want path and change type", mutation)
	}
	if anyToString(mutation["display_name"]) != "app.ts" {
		t.Fatalf("mutation display metadata=%#v", mutation)
	}
	if _, ok := mutation["preview_path"]; ok {
		t.Fatalf("normalized tool result must not include preview_path: %#v", mutation)
	}
	if _, ok := mutation["directory_path"]; ok {
		t.Fatalf("normalized tool result must not include directory_path: %#v", mutation)
	}
	if diff := anyToString(mutation["unified_diff"]); !strings.Contains(diff, "--- a/workspace/app.ts") || !strings.Contains(diff, "+after") {
		t.Fatalf("unified_diff=%q, want patch text", diff)
	}
	if _, ok := mutation["raw"]; ok {
		t.Fatalf("mutation must not collapse to raw: %#v", mutation)
	}
}

func TestNormalizeTruncatedToolPayload_PreservesTodosStructure(t *testing.T) {
	t.Parallel()

	todos := make([]TodoItem, 0, 50)
	for i := 0; i < 50; i++ {
		todos = append(todos, TodoItem{
			ID:      "todo",
			Content: strings.Repeat("review structured todo payload ", 20),
			Status:  TodoStatusPending,
		})
	}
	payload := map[string]any{
		"version": 1,
		"summary": map[string]any{
			"total":       50,
			"pending":     50,
			"in_progress": 0,
			"completed":   0,
			"cancelled":   0,
		},
		"todos": todos,
	}

	normalized, truncated := normalizeTruncatedToolPayload("write_todos", payload)
	if !truncated {
		t.Fatal("write_todos should field-truncate oversized todo payloads")
	}
	root, ok := normalized.(map[string]any)
	if !ok {
		t.Fatalf("normalized type=%T, want map", normalized)
	}
	if _, ok := root["raw"]; ok {
		t.Fatalf("write_todos payload must not collapse to raw: %#v", root)
	}
	if got := len(toAnySlice(root["todos"])); got != 50 {
		t.Fatalf("todos len=%d, want 50", got)
	}
	first, _ := toAnySlice(root["todos"])[0].(map[string]any)
	if len([]rune(anyToString(first["content"]))) > 240 {
		t.Fatalf("todo content was not field-truncated: %d", len([]rune(anyToString(first["content"]))))
	}
	if !readBoolField(root, "truncated") {
		t.Fatalf("root missing truncated marker: %#v", root)
	}
}

func TestNormalizeTruncatedToolPayload_PreservesFileReadWindowTruncated(t *testing.T) {
	t.Parallel()

	payload := FileReadResult{
		FilePath:   "/workspace/large.txt",
		Content:    "first\nsecond\n",
		LineOffset: 1,
		LineCount:  2,
		TotalLines: 9,
		Truncated:  true,
	}
	normalized, truncated := normalizeTruncatedToolPayload("file.read", payload)
	if !truncated {
		t.Fatal("file.read truncated payload should report truncation")
	}
	root, ok := normalized.(map[string]any)
	if !ok {
		t.Fatalf("normalized type=%T, want map", normalized)
	}
	if !readBoolField(root, "truncated") {
		t.Fatalf("file.read payload lost truncated marker: %#v", root)
	}
}

func TestBuiltInToolHandlerExecute_PreservesLargeApplyPatchActivityPayload(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	original := make([]string, 0, 220)
	for i := 1; i <= 220; i++ {
		original = append(original, "line "+strings.Repeat("x", 20))
	}
	if err := os.WriteFile(filepath.Join(workingDir, "app.txt"), []byte(strings.Join(original, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write app.txt: %v", err)
	}
	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Update File: app.txt",
		"@@ -10,3 +10,3 @@",
		" line " + strings.Repeat("x", 20),
		"-line " + strings.Repeat("x", 20),
		"+line " + strings.Repeat("a", 120),
		" line " + strings.Repeat("x", 20),
		"@@ -190,3 +190,3 @@",
		" line " + strings.Repeat("x", 20),
		"-line " + strings.Repeat("x", 20),
		"+line " + strings.Repeat("b", 120),
		" line " + strings.Repeat("x", 20),
		"*** End Patch",
	}, "\n")
	r := newRun(runOptions{
		AgentHomeDir: workingDir,
		WorkingDir:   workingDir,
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	})
	handler := &builtInToolHandler{r: r, toolName: "apply_patch"}
	result, err := handler.Execute(context.Background(), ToolCall{
		ID:   "call_patch_large",
		Name: "apply_patch",
		Args: map[string]any{"patch": patch},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if result.Status != toolResultStatusSuccess {
		t.Fatalf("status=%q, details=%q", result.Status, result.Details)
	}
	activity, err := floretActivityForToolResult(r, result)
	if err != nil {
		t.Fatalf("floretActivityForToolResult: %v", err)
	}
	if activity == nil {
		t.Fatal("activity is nil")
	}
	if _, ok := activity.Payload["raw"]; ok {
		t.Fatalf("activity payload must not collapse to raw: %#v", activity.Payload)
	}
	mutations := toAnySlice(activity.Payload["mutations"])
	if len(mutations) != 1 {
		t.Fatalf("mutations=%#v, want one mutation", activity.Payload["mutations"])
	}
	mutation, ok := mutations[0].(map[string]any)
	if !ok {
		t.Fatalf("mutation type=%T", mutations[0])
	}
	diff := anyToString(mutation["unified_diff"])
	if strings.Count(diff, "@@ -") != 2 {
		t.Fatalf("unified_diff=%q, want two patch hunks", diff)
	}
	if anyToString(mutation["display_name"]) != "app.txt" {
		t.Fatalf("mutation display metadata=%#v", mutation)
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
	if action.DisplayName != "app.txt" || canonicalPath(action.PreviewPath) != canonicalPath(filepath.Join(workingDir, "app.txt")) || canonicalPath(action.DirectoryPath) != canonicalPath(workingDir) {
		t.Fatalf("registered file action=%#v", action)
	}
}
