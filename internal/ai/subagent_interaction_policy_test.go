package ai

import (
	"io"
	"log/slog"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

func containsString(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func testSignalDefs(names ...string) []ToolDef {
	byName := map[string]ToolDef{}
	for _, def := range builtInControlSignalDefinitions() {
		byName[strings.TrimSpace(def.Name)] = def
	}
	out := make([]ToolDef, 0, len(names))
	for _, name := range names {
		if def, ok := byName[strings.TrimSpace(name)]; ok {
			out = append(out, def)
		}
	}
	return out
}

func TestSubagentHostPromptKeepsContextModeMissionScoped(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{AgentHomeDir: t.TempDir()})
	prompt := r.buildSubagentHostSystemPrompt([]ToolDef{{Name: "terminal.exec"}}, resolveSubagentCapabilityContract(r, nil, flruntime.SubAgentForkNone))
	if strings.Contains(prompt, "Context mode: mission_only") || strings.Contains(prompt, "Context mode: full_history") {
		t.Fatalf("host prompt must not pin mission-level context mode: %q", prompt)
	}
	if !strings.Contains(prompt, "mission-level context contract") {
		t.Fatalf("host prompt missing mission-level context guidance: %q", prompt)
	}
}

func TestBuildFlowerSubagentPromptDoesNotExposeHiddenControlTools(t *testing.T) {
	t.Parallel()

	contract := resolveSubagentCapabilityContract(nil, []ToolDef{{Name: "terminal.exec"}}, flruntime.SubAgentForkNone)
	prompt := buildFlowerSubagentPrompt(flowerSubagentPromptSpec{
		AgentType:   subagentAgentTypeWorker,
		TaskName:    "Review API",
		Message:     "Review the API contract and return a complete final handoff.",
		ContextMode: subagentContextModeMissionOnly,
		Contract:    contract,
	})
	for _, forbidden := range []string{"ask_user", "subagents", "write_todos"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("subagent prompt should not expose hidden control tool %q: %q", forbidden, prompt)
		}
	}
	if !strings.Contains(prompt, "Available tools: terminal.exec") {
		t.Fatalf("subagent prompt missing visible tool list: %q", prompt)
	}
}

func TestResolveSubagentCapabilityContractHidesParentOnlyTools(t *testing.T) {
	t.Parallel()

	parent := newRun(runOptions{AgentHomeDir: t.TempDir()})
	child := parent.subagentPolicyRun()
	if child == nil {
		t.Fatal("subagentChildRun returned nil")
	}
	activeTools, contract := child.subagentToolSurface([]ToolDef{
		{Name: "terminal.exec"},
		{Name: "subagents"},
		{Name: "ask_user"},
		{Name: "write_todos"},
	}, flruntime.SubAgentForkFullPath)
	names := mapToolNames(activeTools)
	if !containsString(names, "terminal.exec") {
		t.Fatalf("visible tools missing terminal.exec: %v", names)
	}
	for _, hidden := range []string{"subagents", "ask_user", "write_todos"} {
		if containsString(names, hidden) {
			t.Fatalf("hidden tool %q leaked into child surface: %v", hidden, names)
		}
		if _, ok := contract.HiddenToolSet[hidden]; !ok {
			t.Fatalf("hidden tool %q missing from contract: %#v", hidden, contract.HiddenToolSet)
		}
	}
	if contract.AllowSpawnSubagents || contract.AllowUserInput {
		t.Fatalf("subagent contract should deny nested delegation/direct user input: %#v", contract)
	}
	if !contract.AllowUserApproval {
		t.Fatalf("subagent contract should allow delegated approval through the parent thread: %#v", contract)
	}
	if contract.ForkMode != flruntime.SubAgentForkFullPath {
		t.Fatalf("contract fork mode=%q, want full path", contract.ForkMode)
	}
}

func TestSubagentChildRunUsesFrozenParentPermissionSnapshotAllowlist(t *testing.T) {
	t.Parallel()

	parent := newRun(runOptions{AgentHomeDir: t.TempDir()})
	parent.permissionType = FlowerPermissionFullAccess
	parent.permissionSnapshot = PermissionSnapshot{
		SnapshotID:       "psnap_parent",
		PermissionType:   FlowerPermissionFullAccess,
		VisibleToolNames: []string{"subagents", "task_complete"},
		FloretToolNames:  []string{"subagents"},
	}
	child := parent.subagentPolicyRun()
	if child == nil {
		t.Fatal("subagentChildRun returned nil")
	}
	activeTools, _ := child.subagentToolSurface([]ToolDef{
		{Name: "terminal.exec", Visibility: ToolVisibilityStandard},
		{Name: "file.write", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "subagents", Visibility: ToolVisibilityDelegationControl},
	}, flruntime.SubAgentForkNone)
	names := mapToolNames(activeTools)
	if containsString(names, "terminal.exec") || containsString(names, "file.write") {
		t.Fatalf("child expanded beyond frozen parent snapshot allowlist: %v", names)
	}
}

func TestRegisterBuiltInTools_ExcludesControlSignals(t *testing.T) {
	reg := NewInMemoryToolRegistry()
	r := &run{
		allowSubagentDelegate: true,
		webSearchToolEnabled:  true,
	}
	if err := registerBuiltInTools(reg, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	for _, name := range []string{"ask_user", "task_complete"} {
		if _, _, ok := reg.resolve(name); ok {
			t.Fatalf("%s must not be registered as an ordinary tool", name)
		}
	}
}

func TestBuiltInControlSignalDefinitions_AreSeparateFromOrdinaryTools(t *testing.T) {
	ordinary := map[string]struct{}{}
	for _, def := range builtInToolDefinitions() {
		ordinary[strings.TrimSpace(def.Name)] = struct{}{}
	}
	for _, signal := range builtInControlSignalDefinitions() {
		name := strings.TrimSpace(signal.Name)
		if _, ok := ordinary[name]; ok {
			t.Fatalf("%s must not be part of ordinary builtin tools", name)
		}
		if !isFlowerControlTool(name) {
			t.Fatalf("%s must be classified as a Flower control signal", name)
		}
	}
}

func TestSubagentChildRunInheritsResolvedWebSearchToolState(t *testing.T) {
	parent := &run{
		webSearchToolEnabled: true,
		webSearchMode:        providerWebSearchModeExternalBrave,
	}
	child := newRun(runOptions{
		ToolAllowlist:        []string{"web.search", "task_complete"},
		NoUserInteraction:    true,
		WebSearchToolEnabled: parent.webSearchToolEnabled,
		WebSearchMode:        parent.webSearchMode,
	})

	reg := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(reg, child); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	if _, _, ok := reg.resolve("web.search"); !ok {
		t.Fatalf("web.search should be registered when a subagent inherits the parent resolved web search tool state")
	}
	if child.webSearchMode != providerWebSearchModeExternalBrave {
		t.Fatalf("child webSearchMode=%q, want %q", child.webSearchMode, providerWebSearchModeExternalBrave)
	}
}

func TestResolveRunCapabilityContract_MainAutonomousNoUserInteraction(t *testing.T) {
	tools := []ToolDef{
		{Name: "terminal.exec"},
		{Name: "terminal.exec"},
	}
	r := &run{noUserInteraction: true}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete", "ask_user"), false)
	if contract.AllowUserInteraction {
		t.Fatalf("expected no user interaction")
	}
	if !contract.AllowToolApprovalWait {
		t.Fatalf("no-user runs should still allow tool approval waits; direct user input is the restricted capability")
	}
	if contract.PromptProfile != runPromptProfileMainAutonomous {
		t.Fatalf("unexpected prompt profile=%q", contract.PromptProfile)
	}
	if len(contract.AllowedSignals) != 1 || contract.AllowedSignals[0] != "task_complete" {
		t.Fatalf("unexpected allowed signals=%v", contract.AllowedSignals)
	}
	if containsString(contract.AllowedTools, "ask_user") {
		t.Fatalf("allowed tools should not contain ask_user: %v", contract.AllowedTools)
	}
}

func TestResolveRunCapabilityContract_SubagentAutonomousNoUserInteraction(t *testing.T) {
	tools := []ToolDef{
		{Name: "terminal.exec"},
	}
	r := &run{
		noUserInteraction:      true,
		allowDelegatedApproval: true,
		subagentDepth:          1,
	}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete"), false)
	if contract.PromptProfile != runPromptProfileSubagentAutonomous {
		t.Fatalf("unexpected prompt profile=%q", contract.PromptProfile)
	}
	if !contract.AllowToolApprovalWait {
		t.Fatalf("delegated subagent should allow parent-bridged tool approval waits")
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
		{Name: "ask_user", ID: "tool_ask", Args: map[string]any{
			"questions": []map[string]any{{
				"id":                "question_1",
				"header":            "Need input",
				"question":          "Need input",
				"is_secret":         false,
				"response_mode":     requestUserInputResponseModeWrite,
				"write_label":       "Your answer",
				"write_placeholder": "Type your answer",
			}},
		}},
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
		AgentHomeDir:      t.TempDir(),
		NoUserInteraction: true,
	})
	tools := []ToolDef{{Name: "terminal.exec"}}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete"), false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if strings.Contains(prompt, "call ask_user") || strings.Contains(prompt, "ask_user is unavailable") || strings.Contains(prompt, "Do not attempt ask_user") {
		t.Fatalf("no-user prompt should not include ask_user guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "User interaction is disabled in this run.") {
		t.Fatalf("no-user prompt missing disabled interaction guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "Continue autonomously as the main assistant for the user-facing thread.") {
		t.Fatalf("no-user prompt missing main-autonomous guidance: %q", prompt)
	}
	if strings.Contains(prompt, "suggested parent actions") {
		t.Fatalf("main-autonomous prompt should not use parent-facing blocker wording: %q", prompt)
	}
}

func TestBuildLayeredSystemPrompt_SubagentAutonomousUsesDelegatedWording(t *testing.T) {
	r := newRun(runOptions{
		Log:               slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:      t.TempDir(),
		NoUserInteraction: true,
		SubagentDepth:     1,
	})
	tools := []ToolDef{{Name: "terminal.exec"}}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete"), false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if !strings.Contains(prompt, "You are Flower operating as a delegated autonomous subagent") {
		t.Fatalf("subagent prompt missing delegated identity: %q", prompt)
	}
	if !strings.Contains(prompt, "suggested parent actions") {
		t.Fatalf("subagent prompt missing parent-facing blocker guidance: %q", prompt)
	}
	if strings.Contains(prompt, "Continue autonomously as the main assistant for the user-facing thread.") {
		t.Fatalf("subagent prompt should not use top-level autonomous wording: %q", prompt)
	}
}

func TestBuildLayeredSystemPrompt_ApprovalRequiredDescribesPermissionType(t *testing.T) {
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
	})
	tools := []ToolDef{{Name: "terminal.exec"}, {Name: "file.edit", Mutating: true}}
	signals := testSignalDefs("task_complete", "ask_user")
	contract := resolveRunCapabilityContract(r, tools, signals, false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if !strings.Contains(prompt, "- Permission type: approval_required") {
		t.Fatalf("prompt missing approval_required permission type: %q", prompt)
	}
	if !strings.Contains(prompt, "- Tool approval policy: shell and mutation tools require confirmation") {
		t.Fatalf("prompt missing approval policy guidance: %q", prompt)
	}
}

func TestBuildLayeredSystemPrompt_NoUserInteractionUsesTaskCompleteBlockers(t *testing.T) {
	r := newRun(runOptions{
		Log:               slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:      t.TempDir(),
		NoUserInteraction: true,
	})
	tools := []ToolDef{{Name: "terminal.exec"}}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete", "ask_user"), false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if !strings.Contains(prompt, "User interaction is disabled in this run.") {
		t.Fatalf("no-user prompt missing disabled interaction guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "finish with task_complete including blockers plus concrete next-step guidance for the user-facing thread") {
		t.Fatalf("no-user prompt missing blocker completion guidance: %q", prompt)
	}
}

func TestBuildLayeredSystemPrompt_SubagentNoUserInteractionUsesParentActions(t *testing.T) {
	r := newRun(runOptions{
		Log:               slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:      t.TempDir(),
		NoUserInteraction: true,
		SubagentDepth:     1,
	})
	tools := []ToolDef{{Name: "terminal.exec"}}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete"), false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if !strings.Contains(prompt, "finish with task_complete including blockers plus suggested parent actions") {
		t.Fatalf("subagent prompt missing parent-action guidance: %q", prompt)
	}
}
