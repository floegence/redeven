package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func canonicalPath(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil && strings.TrimSpace(resolved) != "" {
		return filepath.Clean(resolved)
	}
	dir, base := filepath.Split(path)
	if dir != "" && base != "" {
		resolvedDir, err := filepath.EvalSymlinks(filepath.Clean(dir))
		if err == nil && strings.TrimSpace(resolvedDir) != "" {
			return filepath.Clean(filepath.Join(resolvedDir, base))
		}
	}
	return path
}

func TestResolveToolPath(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	target := filepath.Join(root, "sub", "dir")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}

	t.Run("accepts absolute path", func(t *testing.T) {
		t.Parallel()
		r := &run{agentHomeDir: root, workingDir: root}
		resolved, err := r.resolveToolPath(target, root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		if canonicalPath(resolved) != canonicalPath(target) {
			t.Fatalf("resolved=%q, want=%q", resolved, target)
		}
	})

	t.Run("resolves relative path against working_dir_abs", func(t *testing.T) {
		t.Parallel()
		r := &run{agentHomeDir: root, workingDir: root}
		resolved, err := r.resolveToolPath("sub/dir", root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		want := filepath.Join(root, "sub", "dir")
		if canonicalPath(resolved) != canonicalPath(want) {
			t.Fatalf("resolved=%q, want=%q", resolved, want)
		}
	})

	t.Run("expands tilde to runtime home directory", func(t *testing.T) {
		t.Parallel()
		r := &run{agentHomeDir: root, workingDir: root}
		resolved, err := r.resolveToolPath("~/", root)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		if canonicalPath(resolved) != canonicalPath(root) {
			t.Fatalf("resolved=%q, want runtime home=%q", resolved, root)
		}
	})

	t.Run("rejects absolute path outside configured roots", func(t *testing.T) {
		t.Parallel()
		home := t.TempDir()
		project := filepath.Join(home, "workspace")
		outsideProject := filepath.Join(home, "other")
		if err := os.MkdirAll(project, 0o755); err != nil {
			t.Fatalf("MkdirAll project: %v", err)
		}
		if err := os.MkdirAll(outsideProject, 0o755); err != nil {
			t.Fatalf("MkdirAll outsideProject: %v", err)
		}
		scope, err := filesystemscope.NewRegistry(&config.Config{
			AgentHomeDir: home,
			FilesystemScope: &config.FilesystemScope{
				SchemaVersion: config.FilesystemScopeSchemaVersionV1,
				DefaultRootID: "project",
				Roots: []config.FilesystemRootPolicy{
					{
						ID:          "project",
						Label:       "Project",
						Path:        project,
						Kind:        config.FilesystemRootCustom,
						Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("NewRegistry: %v", err)
		}
		r := &run{agentHomeDir: home, workingDir: project, scope: scope}
		if _, err := r.resolveToolPath(outsideProject, project); err == nil {
			t.Fatalf("expected outside-scope absolute path to fail")
		}
	})

	t.Run("accepts absolute path inside a non-home custom root", func(t *testing.T) {
		t.Parallel()
		home := t.TempDir()
		customRoot := t.TempDir()
		target := filepath.Join(customRoot, "notes.txt")
		if err := os.WriteFile(target, []byte("ok"), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		scope, err := filesystemscope.NewRegistry(&config.Config{
			AgentHomeDir: home,
			FilesystemScope: &config.FilesystemScope{
				SchemaVersion: config.FilesystemScopeSchemaVersionV1,
				DefaultRootID: "custom",
				Roots: []config.FilesystemRootPolicy{
					{
						ID:          "custom",
						Label:       "Custom",
						Path:        customRoot,
						Kind:        config.FilesystemRootCustom,
						Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("NewRegistry: %v", err)
		}
		r := &run{agentHomeDir: home, workingDir: customRoot, scope: scope}
		resolved, err := r.resolveToolPath(target, customRoot)
		if err != nil {
			t.Fatalf("resolveToolPath: %v", err)
		}
		if canonicalPath(resolved) != canonicalPath(target) {
			t.Fatalf("resolved=%q, want=%q", resolved, target)
		}
	})
}

func TestToolTerminalExec_CwdRules(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	r := &run{agentHomeDir: workingDir, workingDir: workingDir, shell: "bash"}

	t.Run("passes stdin to the command", func(t *testing.T) {
		t.Parallel()
		stdin := "hello\nworld\n"
		out, err := r.toolTerminalExec(context.Background(), "cat", stdin, "", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		if got := anyToString(m["stdout"]); got != stdin {
			t.Fatalf("stdout=%q, want %q", got, stdin)
		}
	})

	t.Run("empty cwd falls back to working_dir_abs", func(t *testing.T) {
		t.Parallel()
		out, err := r.toolTerminalExec(context.Background(), "pwd", "", "", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		stdout := strings.TrimSpace(anyToString(m["stdout"]))
		if canonicalPath(stdout) != canonicalPath(workingDir) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, workingDir)
		}
	})

	t.Run("relative cwd resolves against working_dir_abs", func(t *testing.T) {
		t.Parallel()
		subdir := filepath.Join(workingDir, "subdir")
		if err := os.MkdirAll(subdir, 0o755); err != nil {
			t.Fatalf("mkdir subdir: %v", err)
		}
		out, err := r.toolTerminalExec(context.Background(), "pwd", "", "subdir", 5000)
		if err != nil {
			t.Fatalf("toolTerminalExec: %v", err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			t.Fatalf("unexpected result type: %T", out)
		}
		stdout := strings.TrimSpace(anyToString(m["stdout"]))
		if canonicalPath(stdout) != canonicalPath(subdir) {
			t.Fatalf("stdout=%q, want cwd=%q", stdout, subdir)
		}
	})

	t.Run("absolute cwd outside configured roots is rejected", func(t *testing.T) {
		t.Parallel()
		home := t.TempDir()
		project := filepath.Join(home, "workspace")
		outside := filepath.Join(home, "other")
		if err := os.MkdirAll(project, 0o755); err != nil {
			t.Fatalf("MkdirAll project: %v", err)
		}
		if err := os.MkdirAll(outside, 0o755); err != nil {
			t.Fatalf("MkdirAll outside: %v", err)
		}
		scope, err := filesystemscope.NewRegistry(&config.Config{
			AgentHomeDir: home,
			FilesystemScope: &config.FilesystemScope{
				SchemaVersion: config.FilesystemScopeSchemaVersionV1,
				DefaultRootID: "home",
				Roots: []config.FilesystemRootPolicy{
					{
						ID:          "home",
						Label:       "Home",
						Path:        project,
						Kind:        config.FilesystemRootHome,
						Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("NewRegistry: %v", err)
		}
		r := &run{agentHomeDir: home, workingDir: project, scope: scope, shell: "bash"}
		if _, err := r.toolTerminalExec(context.Background(), "pwd", "", outside, 5000); err == nil {
			t.Fatalf("expected outside-scope cwd to fail")
		}
	})

	t.Run("equivalent cwd and workdir values are accepted", func(t *testing.T) {
		t.Parallel()
		subdir := filepath.Join(workingDir, "same")
		if err := os.MkdirAll(subdir, 0o755); err != nil {
			t.Fatalf("mkdir subdir: %v", err)
		}
		cwd, err := r.normalizeTerminalExecCwd("same", subdir)
		if err != nil {
			t.Fatalf("normalizeTerminalExecCwd: %v", err)
		}
		if canonicalPath(cwd) != canonicalPath(subdir) {
			t.Fatalf("cwd=%q, want %q", cwd, subdir)
		}
	})
}

func TestToolApplyPatch_CreatesFile(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	r := &run{agentHomeDir: workingDir, workingDir: workingDir}
	patch := strings.Join([]string{
		"diff --git a/note.txt b/note.txt",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/note.txt",
		"@@ -0,0 +1 @@",
		"+hello patch",
	}, "\n")
	out, err := r.toolApplyPatch(context.Background(), patch)
	if err != nil {
		t.Fatalf("toolApplyPatch: %v", err)
	}
	result, ok := out.(ApplyPatchResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", out)
	}
	if got := result.FilesChanged; got != 1 {
		t.Fatalf("files_changed=%d, want 1", got)
	}
	if got := result.InputFormat; got != "unified_diff" {
		t.Fatalf("input_format=%q, want %q", got, "unified_diff")
	}
	if got := result.NormalizedFormat; got != "begin_patch" {
		t.Fatalf("normalized_format=%q, want %q", got, "begin_patch")
	}
	if len(result.Mutations) != 1 || result.Mutations[0].ChangeType != "create" || canonicalPath(result.Mutations[0].FilePath) != canonicalPath(filepath.Join(workingDir, "note.txt")) {
		t.Fatalf("mutations=%+v, want one create mutation", result.Mutations)
	}
	if canonicalPath(result.Mutations[0].NewPath) != canonicalPath(filepath.Join(workingDir, "note.txt")) || result.Mutations[0].OldPath != "" {
		t.Fatalf("mutation paths=%+v, want only new path", result.Mutations[0])
	}
	if strings.TrimSpace(result.Mutations[0].UpdatedFile) != "hello patch" || len(result.Mutations[0].StructuredDiff) != 1 {
		t.Fatalf("mutation detail=%+v, want updated file and structured diff", result.Mutations[0])
	}
	got, err := os.ReadFile(filepath.Join(workingDir, "note.txt"))
	if err != nil {
		t.Fatalf("read patched file: %v", err)
	}
	if strings.TrimSpace(string(got)) != "hello patch" {
		t.Fatalf("content=%q, want %q", string(got), "hello patch")
	}
}

func TestToolApplyPatch_ReportsDeletedFileMutation(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	target := filepath.Join(workingDir, "old.txt")
	if err := os.WriteFile(target, []byte("remove me\n"), 0o644); err != nil {
		t.Fatalf("write target: %v", err)
	}
	r := &run{agentHomeDir: workingDir, workingDir: workingDir}
	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Delete File: old.txt",
		"*** End Patch",
	}, "\n")

	out, err := r.toolApplyPatch(context.Background(), patch)
	if err != nil {
		t.Fatalf("toolApplyPatch: %v", err)
	}
	result, ok := out.(ApplyPatchResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", out)
	}
	if len(result.Mutations) != 1 || result.Mutations[0].ChangeType != "delete" {
		t.Fatalf("mutations=%+v, want one delete mutation", result.Mutations)
	}
	if canonicalPath(result.Mutations[0].FilePath) != canonicalPath(target) || canonicalPath(result.Mutations[0].OldPath) != canonicalPath(target) || result.Mutations[0].NewPath != "" {
		t.Fatalf("mutation paths=%+v, want only old path", result.Mutations[0])
	}
	if strings.TrimSpace(result.Mutations[0].OriginalFile) != "remove me" || result.Mutations[0].UpdatedFile != "" {
		t.Fatalf("mutation detail=%+v, want original content and empty updated content", result.Mutations[0])
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("target stat err=%v, want not exist", err)
	}
}

func TestPrependRedevenBinToEnv_AddsPath(t *testing.T) {
	t.Parallel()

	home := filepath.Join(t.TempDir(), "home")
	env := prependRedevenBinToEnv([]string{
		"HOME=" + home,
		"PATH=/usr/local/bin:/usr/bin",
	})
	pathVal := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			pathVal = strings.TrimPrefix(kv, "PATH=")
			break
		}
	}
	if pathVal == "" {
		t.Fatalf("PATH missing from env output")
	}
	wantPrefix := filepath.Join(home, ".redeven", "bin")
	if !strings.HasPrefix(pathVal, wantPrefix+string(os.PathListSeparator)) {
		t.Fatalf("PATH=%q, want prefix %q", pathVal, wantPrefix)
	}
}

func TestSnapshotAssistantMessageJSON_UsesAskUserQuestionWhenMarkdownEmpty(t *testing.T) {
	t.Parallel()

	const question = "Please choose one direction so I can continue."
	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		PromptID:   "rui_msg_ask_user_tool_ask_user_waiting",
		MessageID:  "msg_ask_user",
		ToolID:     "tool_ask_user_waiting",
		ToolName:   "ask_user",
		ReasonCode: AskUserReasonUserDecisionRequired,
		Questions: []RequestUserInputQuestion{{
			ID:               "question_1",
			Header:           question,
			Question:         question,
			ResponseMode:     requestUserInputResponseModeWrite,
			WriteLabel:       "Your answer",
			WritePlaceholder: "Type your answer",
		}},
	})
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	r := &run{
		messageID:                "msg_ask_user",
		assistantCreatedAtUnixMs: 1700000000000,
		assistantBlocks:          []any{activityTimelinePlaceholder("run_ask_user")},
	}
	r.setWaitingPrompt(prompt)

	rawJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != question {
		t.Fatalf("assistantText=%q, want %q", assistantText, question)
	}
	if assistantAt != 1700000000000 {
		t.Fatalf("assistantAt=%d, want %d", assistantAt, 1700000000000)
	}
	if strings.Contains(rawJSON, `"tool-call"`) || strings.Contains(rawJSON, `"toolName"`) {
		t.Fatalf("assistant JSON contains removed tool-call block: %s", rawJSON)
	}
}

func TestSnapshotAssistantMessageJSON_UsesVisibleMarkdownOnlyForAssistantText(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                "msg_reasoning_snapshot",
		assistantCreatedAtUnixMs: 1700000000123,
		assistantBlocks: []any{
			&persistedThinkingBlock{Type: "thinking", Content: "Checked the theme registry and token export surface."},
			&persistedMarkdownBlock{Type: "markdown", Content: "Design tokens live in packages/core/src/styles/tokens.ts."},
		},
	}

	rawJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Design tokens live in packages/core/src/styles/tokens.ts." {
		t.Fatalf("assistantText=%q, want visible markdown only", assistantText)
	}
	if assistantAt != 1700000000123 {
		t.Fatalf("assistantAt=%d, want %d", assistantAt, 1700000000123)
	}
	if !strings.Contains(rawJSON, `"type":"thinking"`) {
		t.Fatalf("assistant JSON missing thinking block: %s", rawJSON)
	}
}

func TestSnapshotWaitingPrompt_ExtractsStructuredQuestions(t *testing.T) {
	t.Parallel()

	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		PromptID:         "rui_msg_waiting_prompt_structured_tool_waiting_prompt_structured",
		MessageID:        "msg_waiting_prompt_structured",
		ToolID:           "tool_waiting_prompt_structured",
		ToolName:         "ask_user",
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Choose execution mode"},
		EvidenceRefs:     []string{"tool_approval_1"},
		Questions: []RequestUserInputQuestion{{
			ID:                "mode_decision",
			Header:            "Execution mode",
			Question:          "Need your confirmation",
			ResponseMode:      requestUserInputResponseModeSelect,
			ChoicesExhaustive: testBoolPtr(true),
			Choices: []RequestUserInputChoice{{
				ChoiceID: "switch_to_act",
				Label:    "Switch to Act mode",
				Kind:     requestUserInputChoiceKindSelect,
				Actions: []RequestUserInputAction{{
					Type: "set_mode",
					Mode: "act",
				}},
			}},
		}},
	})
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	r := &run{
		messageID:       "msg_waiting_prompt_structured",
		assistantBlocks: []any{activityTimelinePlaceholder("run_waiting_prompt_structured")},
	}
	r.setWaitingPrompt(prompt)

	gotPrompt := r.snapshotWaitingPrompt()
	if gotPrompt == nil {
		t.Fatalf("snapshotWaitingPrompt returned nil")
	}
	if got := strings.TrimSpace(gotPrompt.PromptID); got == "" {
		t.Fatalf("PromptID should not be empty")
	}
	if got := strings.TrimSpace(gotPrompt.ToolID); got != "tool_waiting_prompt_structured" {
		t.Fatalf("ToolID=%q, want %q", got, "tool_waiting_prompt_structured")
	}
	if got := strings.TrimSpace(gotPrompt.ReasonCode); got != AskUserReasonUserDecisionRequired {
		t.Fatalf("ReasonCode=%q, want %q", got, AskUserReasonUserDecisionRequired)
	}
	if len(gotPrompt.RequiredFromUser) != 1 || gotPrompt.RequiredFromUser[0] != "Choose execution mode" {
		t.Fatalf("RequiredFromUser=%v", gotPrompt.RequiredFromUser)
	}
	if len(gotPrompt.EvidenceRefs) != 1 || gotPrompt.EvidenceRefs[0] != "tool_approval_1" {
		t.Fatalf("EvidenceRefs=%v", gotPrompt.EvidenceRefs)
	}
	if len(gotPrompt.Questions) != 1 {
		t.Fatalf("questions len=%d, want 1", len(gotPrompt.Questions))
	}
	if got := strings.TrimSpace(gotPrompt.Questions[0].ID); got != "mode_decision" {
		t.Fatalf("question id=%q, want %q", got, "mode_decision")
	}
	if len(prompt.Questions[0].Choices) != 1 {
		t.Fatalf("choices len=%d, want 1", len(prompt.Questions[0].Choices))
	}
	if got := strings.TrimSpace(prompt.Questions[0].Choices[0].ChoiceID); got != "switch_to_act" {
		t.Fatalf("choice id=%q, want %q", got, "switch_to_act")
	}
	if got := strings.TrimSpace(prompt.Questions[0].Choices[0].Label); got != "Switch to Act mode" {
		t.Fatalf("label=%q, want %q", got, "Switch to Act mode")
	}
	if len(prompt.Questions[0].Choices[0].Actions) != 1 {
		t.Fatalf("actions len=%d, want 1", len(prompt.Questions[0].Choices[0].Actions))
	}
	if got := strings.TrimSpace(prompt.Questions[0].Choices[0].Actions[0].Type); got != requestUserInputActionSetMode {
		t.Fatalf("action type=%q, want %q", got, requestUserInputActionSetMode)
	}
	if got := strings.TrimSpace(prompt.Questions[0].Choices[0].Actions[0].Mode); got != "act" {
		t.Fatalf("action mode=%q, want %q", got, "act")
	}
}

func TestSnapshotAssistantMessageJSON_PrefersMarkdownOverAskUserQuestion(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                "msg_markdown_first",
		assistantCreatedAtUnixMs: 1700000000001,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "completed summary"},
			activityTimelinePlaceholder("run_markdown_first"),
		},
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "completed summary" {
		t.Fatalf("assistantText=%q, want markdown content", assistantText)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	role, _ := parsed["role"].(string)
	if strings.TrimSpace(role) != "assistant" {
		t.Fatalf("role=%v, want assistant", parsed["role"])
	}
}

func TestSnapshotAssistantMessageJSONWithStatus_Streaming(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                "msg_streaming_snapshot",
		assistantCreatedAtUnixMs: 1700000000002,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "streaming now"},
		},
	}

	rawJSON, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	gotStatus, _ := parsed["status"].(string)
	if strings.TrimSpace(gotStatus) != "streaming" {
		t.Fatalf("status=%q, want streaming", gotStatus)
	}
}
