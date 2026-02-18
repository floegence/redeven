package ai

import (
	"io"
	"log/slog"
	"strings"
	"testing"
)

func containsString(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func TestDefaultSubagentToolAllowlists_ExcludeAskUser(t *testing.T) {
	readonlyAllowlist := defaultSubagentToolAllowlistReadonly()
	if containsString(readonlyAllowlist, "ask_user") {
		t.Fatalf("readonly default allowlist unexpectedly contains ask_user")
	}
	workerAllowlist := defaultSubagentToolAllowlistWorker()
	if containsString(workerAllowlist, "ask_user") {
		t.Fatalf("worker default allowlist unexpectedly contains ask_user")
	}
}

func TestSanitizeSubagentToolAllowlist_FiltersDisallowedAndDuplicates(t *testing.T) {
	in := []string{"ask_user", "subagents", "terminal.exec", "terminal.exec", "task_complete"}
	got := sanitizeSubagentToolAllowlist(in, defaultSubagentToolAllowlistWorker(), false)
	if len(got) != 2 || got[0] != "terminal.exec" || got[1] != "task_complete" {
		t.Fatalf("sanitizeSubagentToolAllowlist()=%v, want [terminal.exec task_complete]", got)
	}
}

func TestSanitizeReadonlyAllowlist_DropsMutatingAndAskUser(t *testing.T) {
	got := sanitizeReadonlyAllowlist([]string{"apply_patch", "ask_user", "terminal.exec"})
	if len(got) != 1 || got[0] != "terminal.exec" {
		t.Fatalf("sanitizeReadonlyAllowlist()=%v, want [terminal.exec]", got)
	}
}

func TestSanitizeSubagentToolAllowlist_FallbacksWhenInputEmptyOrInvalid(t *testing.T) {
	fallback := defaultSubagentToolAllowlistWorker()
	got := sanitizeSubagentToolAllowlist([]string{"ask_user"}, fallback, false)
	if len(got) == 0 {
		t.Fatalf("sanitizeSubagentToolAllowlist() returned empty allowlist")
	}
	if containsString(got, "ask_user") {
		t.Fatalf("fallback allowlist unexpectedly contains ask_user")
	}
}

func TestRegisterBuiltInTools_OmitsAskUserWhenNoUserInteraction(t *testing.T) {
	reg := NewInMemoryToolRegistry()
	r := &run{
		allowSubagentDelegate: true,
		noUserInteraction:     true,
		webSearchToolEnabled:  true,
	}
	if err := registerBuiltInTools(reg, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	if _, _, ok := reg.resolve("ask_user"); ok {
		t.Fatalf("ask_user should be excluded when no-user-interaction policy is enabled")
	}
	if _, _, ok := reg.resolve("task_complete"); !ok {
		t.Fatalf("task_complete should remain available")
	}
}

func TestRegisterBuiltInTools_IncludesAskUserByDefault(t *testing.T) {
	reg := NewInMemoryToolRegistry()
	r := &run{
		allowSubagentDelegate: true,
		noUserInteraction:     false,
		webSearchToolEnabled:  true,
	}
	if err := registerBuiltInTools(reg, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	if _, _, ok := reg.resolve("ask_user"); !ok {
		t.Fatalf("ask_user should be registered when no-user-interaction policy is disabled")
	}
}

func TestResolveRunCapabilityContract_NoUserInteraction(t *testing.T) {
	tools := []ToolDef{
		{Name: "terminal.exec"},
		{Name: "task_complete"},
		{Name: "terminal.exec"},
	}
	r := &run{noUserInteraction: true}
	contract := resolveRunCapabilityContract(r, tools)
	if contract.AllowUserInteraction {
		t.Fatalf("expected no user interaction")
	}
	if contract.PromptProfile != runPromptProfileSubagentAutonomous {
		t.Fatalf("unexpected prompt profile=%q", contract.PromptProfile)
	}
	if len(contract.AllowedSignals) != 1 || contract.AllowedSignals[0] != "task_complete" {
		t.Fatalf("unexpected allowed signals=%v", contract.AllowedSignals)
	}
	if containsString(contract.AllowedTools, "ask_user") {
		t.Fatalf("allowed tools should not contain ask_user: %v", contract.AllowedTools)
	}
}

func TestSplitSignalsByPolicy_BlocksAskUserWhenDisallowed(t *testing.T) {
	contract := runCapabilityContract{
		AllowUserInteraction: false,
		AllowedSignals:       []string{"task_complete"},
		allowedSignalSet: map[string]struct{}{
			"task_complete": {},
		},
	}
	calls := []ToolCall{
		{Name: "ask_user", ID: "tool_ask", Args: map[string]any{"question": "Need input"}},
		{Name: "task_complete", ID: "tool_done", Args: map[string]any{"result": "ok"}},
		{Name: "terminal.exec", ID: "tool_exec", Args: map[string]any{"command": "pwd"}},
	}
	out := splitSignalsByPolicy(calls, contract)
	if out.TaskCompleteCall == nil || strings.TrimSpace(out.TaskCompleteCall.ID) != "tool_done" {
		t.Fatalf("task_complete should remain allowed: %#v", out)
	}
	if out.AskUserCall != nil {
		t.Fatalf("ask_user should not be accepted when disallowed: %#v", out)
	}
	if len(out.ForbiddenSignals) != 1 || strings.TrimSpace(out.ForbiddenSignals[0].Name) != "ask_user" {
		t.Fatalf("ask_user should be marked as forbidden: %#v", out.ForbiddenSignals)
	}
	if len(out.NormalCalls) != 1 || strings.TrimSpace(out.NormalCalls[0].Name) != "terminal.exec" {
		t.Fatalf("normal tool calls should be preserved: %#v", out.NormalCalls)
	}
}

func TestBuildLayeredSystemPrompt_NoUserInteractionOmitsAskUserGuidance(t *testing.T) {
	r := newRun(runOptions{
		Log:               slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot:            t.TempDir(),
		NoUserInteraction: true,
	})
	tools := []ToolDef{{Name: "terminal.exec"}, {Name: "task_complete"}}
	contract := resolveRunCapabilityContract(r, tools)
	prompt := r.buildLayeredSystemPrompt("objective", "act", TaskComplexityStandard, 0, 8, true, tools, newRuntimeState("objective"), "", contract)
	if strings.Contains(prompt, "call ask_user") || strings.Contains(prompt, "ask_user is unavailable") || strings.Contains(prompt, "Do not attempt ask_user") {
		t.Fatalf("no-user prompt should not include ask_user guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "User interaction is disabled in this run.") {
		t.Fatalf("no-user prompt missing disabled interaction guidance: %q", prompt)
	}
}
