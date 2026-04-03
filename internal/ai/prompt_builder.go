package ai

import (
	"fmt"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/config"
)

type promptSection struct {
	Name  string
	Lines []string
}

type promptDocument struct {
	StaticSections  []promptSection
	DynamicSections []promptSection
	OverlaySections []promptSection
}

type promptTodoStatus struct {
	TrackingEnabled  bool
	OpenCount        int
	InProgressCount  int
	SnapshotVersion  int64
	LastUpdatedRound int
}

type promptRuntimeSnapshot struct {
	WorkingDir                     string
	RoundIndex                     int
	IsFirstRound                   bool
	Mode                           string
	Objective                      string
	TaskComplexity                 string
	PromptProfile                  string
	ExecutionContract              string
	CompletionContract             string
	TodoPolicy                     string
	RequiredTodoMinimum            int
	TodoStatus                     promptTodoStatus
	RecentErrors                   []string
	AvailableToolNames             string
	AvailableSkills                []SkillMeta
	ActiveSkills                   []SkillActivation
	InteractionContract            interactionContract
	ProtocolSurface                RunProtocolSurface
	ProtocolCompletionMode         RunCompletionMode
	ProtocolWaitingMode            RunWaitingMode
	AllowUserInteraction           bool
	SupportsAskUserQuestionBatches bool
	ExceptionOverlay               string
}

type cachedPromptPrefixKey struct {
	Profile                        string
	Mode                           string
	AllowUserInteraction           bool
	SupportsAskUserQuestionBatches bool
	PlanMode                       bool
	ProtocolSurface                RunProtocolSurface
	ProtocolCompletionMode         RunCompletionMode
	ProtocolWaitingMode            RunWaitingMode
}

type promptStaticPrefixCache struct {
	mu      sync.RWMutex
	entries map[cachedPromptPrefixKey]string
}

var layeredPromptStaticPrefixCache = newPromptStaticPrefixCache()

func newPromptStaticPrefixCache() *promptStaticPrefixCache {
	return &promptStaticPrefixCache{
		entries: make(map[cachedPromptPrefixKey]string),
	}
}

func (c *promptStaticPrefixCache) getOrBuild(key cachedPromptPrefixKey, build func() string) string {
	if c == nil {
		if build == nil {
			return ""
		}
		return strings.TrimSpace(build())
	}
	c.mu.RLock()
	if cached, ok := c.entries[key]; ok {
		c.mu.RUnlock()
		return cached
	}
	c.mu.RUnlock()
	if build == nil {
		return ""
	}
	rendered := strings.TrimSpace(build())
	c.mu.Lock()
	defer c.mu.Unlock()
	if cached, ok := c.entries[key]; ok {
		return cached
	}
	c.entries[key] = rendered
	return rendered
}

func newPromptSection(name string, lines ...string) promptSection {
	return promptSection{
		Name:  strings.TrimSpace(name),
		Lines: trimPromptLines(lines),
	}
}

func newPromptSectionFromText(name string, text string) promptSection {
	text = strings.TrimSpace(text)
	if text == "" {
		return promptSection{Name: strings.TrimSpace(name), Lines: []string{}}
	}
	return promptSection{
		Name:  strings.TrimSpace(name),
		Lines: strings.Split(text, "\n"),
	}
}

func trimPromptLines(lines []string) []string {
	if len(lines) == 0 {
		return []string{}
	}
	start := 0
	for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	end := len(lines)
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	if start >= end {
		return []string{}
	}
	out := make([]string, 0, end-start)
	out = append(out, lines[start:end]...)
	return out
}

func (s promptSection) isEmpty() bool {
	return len(trimPromptLines(s.Lines)) == 0
}

func (s promptSection) render() string {
	if s.isEmpty() {
		return ""
	}
	return strings.Join(trimPromptLines(s.Lines), "\n")
}

func renderPromptSections(sections []promptSection) string {
	if len(sections) == 0 {
		return ""
	}
	parts := make([]string, 0, len(sections))
	for _, section := range sections {
		rendered := section.render()
		if strings.TrimSpace(rendered) == "" {
			continue
		}
		parts = append(parts, rendered)
	}
	return strings.Join(parts, "\n\n")
}

func (d promptDocument) render(cache *promptStaticPrefixCache, key cachedPromptPrefixKey) string {
	parts := make([]string, 0, 3)
	staticPart := ""
	if len(d.StaticSections) > 0 {
		builder := func() string {
			return renderPromptSections(d.StaticSections)
		}
		if cache != nil {
			staticPart = cache.getOrBuild(key, builder)
		} else {
			staticPart = strings.TrimSpace(builder())
		}
		if strings.TrimSpace(staticPart) != "" {
			parts = append(parts, staticPart)
		}
	}
	if dynamicPart := strings.TrimSpace(renderPromptSections(d.DynamicSections)); dynamicPart != "" {
		parts = append(parts, dynamicPart)
	}
	if overlayPart := strings.TrimSpace(renderPromptSections(d.OverlaySections)); overlayPart != "" {
		parts = append(parts, overlayPart)
	}
	return strings.Join(parts, "\n\n")
}

func buildPromptRuntimeSnapshot(r *run, objective string, mode string, complexity string, round int, maxSteps int, isFirstRound bool, tools []ToolDef, state runtimeState, exceptionOverlay string, capability runCapabilityContract) promptRuntimeSnapshot {
	_ = maxSteps
	complexity = normalizeTaskComplexity(complexity)
	allowUserInteraction := capability.AllowUserInteraction
	if !allowUserInteraction && strings.TrimSpace(capability.PromptProfile) == "" {
		allowUserInteraction = r == nil || !r.noUserInteraction
	}

	executionContract := normalizeExecutionContract(
		state.ExecutionContract,
		RunIntentTask,
		RunObjectiveModeReplace,
		complexity,
		state.TodoPolicy,
		state.InteractionContract,
	)
	completionContract := completionContractForExecutionContract(executionContract)
	cwd := ""
	if r != nil {
		cwd = strings.TrimSpace(r.workingDir)
		if cwd == "" {
			cwd = strings.TrimSpace(r.agentHomeDir)
		}
	}

	availableToolNames := joinToolNames(tools)
	if len(capability.AllowedTools) > 0 {
		availableToolNames = strings.Join(cloneStringSlice(capability.AllowedTools), ", ")
	}

	availableSkills := []SkillMeta{}
	activeSkills := []SkillActivation{}
	if r != nil {
		availableSkills = r.listSkills()
		activeSkills = r.activeSkills()
	}
	protocolProfile := normalizeRunProtocolProfile(capability.ProtocolProfile)

	return promptRuntimeSnapshot{
		WorkingDir:          cwd,
		RoundIndex:          round,
		IsFirstRound:        isFirstRound,
		Mode:                strings.TrimSpace(mode),
		Objective:           strings.TrimSpace(objective),
		TaskComplexity:      complexity,
		PromptProfile:       resolveRunPromptProfile(strings.TrimSpace(capability.PromptProfile), r, allowUserInteraction),
		ExecutionContract:   executionContract,
		CompletionContract:  completionContract,
		TodoPolicy:          normalizeTodoPolicy(state.TodoPolicy),
		RequiredTodoMinimum: requiredTodoCount(state),
		TodoStatus: promptTodoStatus{
			TrackingEnabled:  state.TodoTrackingEnabled,
			OpenCount:        state.TodoOpenCount,
			InProgressCount:  state.TodoInProgressCount,
			SnapshotVersion:  state.TodoSnapshotVersion,
			LastUpdatedRound: state.TodoLastUpdatedRound,
		},
		RecentErrors:                   cloneStringSlice(state.RecentErrors),
		AvailableToolNames:             availableToolNames,
		AvailableSkills:                availableSkills,
		ActiveSkills:                   activeSkills,
		InteractionContract:            state.InteractionContract,
		ProtocolSurface:                protocolProfile.Surface,
		ProtocolCompletionMode:         protocolProfile.CompletionMode,
		ProtocolWaitingMode:            protocolProfile.WaitingMode,
		AllowUserInteraction:           allowUserInteraction,
		SupportsAskUserQuestionBatches: capability.SupportsAskUserQuestionBatches,
		ExceptionOverlay:               strings.TrimSpace(exceptionOverlay),
	}
}

func buildPromptDocument(snapshot promptRuntimeSnapshot) promptDocument {
	spec := resolvePromptProfileSpec(snapshot.PromptProfile)
	staticSections := buildPromptStaticSections(spec, snapshot)
	dynamicSections := buildPromptDynamicSections(snapshot)
	overlaySections := []promptSection{}
	if overlay := newPromptSectionFromText("exception_overlay", snapshot.ExceptionOverlay); !overlay.isEmpty() {
		overlaySections = append(overlaySections, overlay)
	}
	return promptDocument{
		StaticSections:  staticSections,
		DynamicSections: dynamicSections,
		OverlaySections: overlaySections,
	}
}

func buildPromptStaticSections(spec promptProfileSpec, snapshot promptRuntimeSnapshot) []promptSection {
	sections := []promptSection{
		buildPromptMandateSection(spec),
		buildPromptProtocolSurfaceSection(snapshot),
		buildPromptToolUsageSection(snapshot),
	}
	if section := buildPromptSubagentSection(spec); !section.isEmpty() {
		sections = append(sections, section)
	}
	if section := buildPromptDelegatedRunSection(spec); !section.isEmpty() {
		sections = append(sections, section)
	}
	if section := buildPromptReportingSection(spec); !section.isEmpty() {
		sections = append(sections, section)
	}
	sections = append(sections,
		buildPromptOnlineResearchSection(),
		buildPromptComplexitySection(),
		buildPromptMandatoryRulesSection(snapshot),
		buildPromptTodoDisciplineSection(),
		buildPromptAntiPatternSection(),
		buildPromptToolFailureRecoverySection(snapshot),
		buildPromptCommonWorkflowsSection(snapshot),
		newPromptSection("markdown_output_contract", buildMarkdownOutputContractLines()...),
		buildPromptSearchTemplateSection(),
	)
	if snapshot.AllowUserInteraction {
		sections = append(sections, buildPromptAskUserPolicySection(snapshot))
	} else if section := buildPromptAutonomousInteractionSection(spec); !section.isEmpty() {
		sections = append(sections, section)
	}
	if isPlanMode(snapshot.Mode) {
		sections = append(sections, buildPromptPlanModeSection(spec, snapshot))
	}
	return sections
}

func buildPromptDynamicSections(snapshot promptRuntimeSnapshot) []promptSection {
	sections := []promptSection{}
	if section := buildPromptCompletionContractSection(snapshot); !section.isEmpty() {
		sections = append(sections, section)
	}
	if section := newPromptSection("active_interaction_contract", interactionContractPromptLines(snapshot.InteractionContract)...); !section.isEmpty() {
		sections = append(sections, section)
	}
	sections = append(sections, buildPromptRuntimeContextSection(snapshot))
	if section := newPromptSectionFromText("skill_catalog", buildSkillCatalogPrompt(snapshot.AvailableSkills)); !section.isEmpty() {
		sections = append(sections, section)
	}
	if section := newPromptSectionFromText("skill_overlay", buildSkillOverlayPrompt(snapshot.ActiveSkills)); !section.isEmpty() {
		sections = append(sections, section)
	}
	return sections
}

func buildPromptMandateSection(spec promptProfileSpec) promptSection {
	lines := []string{"# Identity & Mandate"}
	lines = append(lines, spec.IdentityLines...)
	lines = append(lines,
		"Operate within the available tools and permission policy for this session.",
		"The working directory is a default context, not a hard sandbox: you may access paths outside it when needed (use absolute paths/cwd/workdir explicitly).",
	)
	lines = append(lines, spec.StrategyLines...)
	return newPromptSection("identity_mandate", lines...)
}

func buildPromptProtocolSurfaceSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{"# Active Protocol Surface"}
	switch snapshot.ProtocolSurface {
	case RunProtocolSurfaceStructuredFileOps:
		lines = append(lines,
			"- Primary file tools: `file.read`, `file.edit`, and `file.write`.",
			"- `apply_patch` remains available as a compatibility fallback, not the default editing path.",
		)
		if snapshot.ProtocolWaitingMode == RunWaitingModeExitPlanMode {
			lines = append(lines, "- In plan mode, use `exit_plan_mode` when execution requires switching the thread into act mode.")
		}
		if snapshot.ProtocolCompletionMode == RunCompletionModeRuntimeCloseout {
			lines = append(lines, "- Prefer `task_complete` when it is natural, but after verified tool work the runtime may also close out successfully from a strong final answer without another explicit completion signal.")
		}
	default:
		lines = append(lines,
			"- Primary editing tool: `apply_patch`.",
			"- Completion is explicit-signal driven.",
		)
	}
	return newPromptSection("protocol_surface", lines...)
}

func buildPromptToolUsageSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"# Tool Usage Strategy",
		"Follow this workflow for every task:",
		"1. **Investigate** — Use terminal.exec to inspect the workspace, relevant local paths, and device state (rg/sed/cat for code; OS probes for diagnostics; curl for network data) and gather context.",
		"2. **Plan** — Identify what needs to be done based on the information gathered.",
	}
	if snapshot.ProtocolSurface == RunProtocolSurfaceStructuredFileOps {
		lines = append(lines, "3. **Act** — Use file.read for focused inspection, file.edit for exact replacements, file.write for full-file writes, and terminal.exec for validated command actions.")
	} else {
		lines = append(lines, "3. **Act** — Use apply_patch in canonical Begin/End Patch format for file edits; use terminal.exec for validated command actions.")
	}
	lines = append(lines,
		"4. **Verify** — Use terminal.exec to run checks (tests/lint/build) and confirm correctness.",
		"5. **Iterate** — If verification fails, diagnose the issue and repeat from step 1.",
	)
	return newPromptSection("tool_usage_strategy", lines...)
}

func buildPromptSubagentSection(spec promptProfileSpec) promptSection {
	if spec.Name == runPromptProfileSubagentAutonomous {
		return promptSection{}
	}
	return newPromptSection(
		"subagent_orchestration",
		"# Sub-agent Orchestration",
		"- Delegate only when work can be parallelized, isolated, or independently reviewed.",
		"- Do NOT delegate trivial single-step tasks that can be completed directly.",
		"- Do NOT use subagents for one-off local inspection work such as reading a single file, checking one command, or answering a direct question about the current workspace.",
		"- Create subagents with subagents(action=create) and include objective, agent_type, trigger_reason, deliverables, definition_of_done, and output_schema (title/context_mode/inputs when useful).",
		"- Minimal create contract example: {\"action\":\"create\",\"agent_type\":\"worker\",\"objective\":\"Investigate the assigned slice\",\"trigger_reason\":\"Parallelizable sidecar work will speed up the parent task\",\"deliverables\":[\"Short findings summary\"],\"definition_of_done\":[\"Findings verified\"],\"output_schema\":{\"type\":\"object\",\"required\":[\"summary\"],\"properties\":{\"summary\":{\"type\":\"string\",\"description\":\"Verified findings for the parent run.\"}}}}",
		"- Subagent timeout is fixed at 900 seconds (15 minutes); do not customize budget.timeout_sec.",
		"- output_schema must include type=object, a non-empty properties object, and required keys that exist in properties.",
		"- Use subagents(action=wait) to gather child status snapshots before final decisions.",
		"- Use subagents(action=list|inspect|steer|terminate|terminate_all) to manage child runs deterministically.",
		"- Inspect contract: use {action:\"inspect\",target:\"<subagent_id>\"} for a single child, or {action:\"inspect\",ids:[\"<subagent_id>\",...]} for batch inspection.",
	)
}

func buildPromptDelegatedRunSection(spec promptProfileSpec) promptSection {
	if len(spec.DelegationLines) == 0 {
		return promptSection{}
	}
	lines := []string{"# Delegated Run Contract"}
	lines = append(lines, spec.DelegationLines...)
	return newPromptSection("delegated_run_contract", lines...)
}

func buildPromptReportingSection(spec promptProfileSpec) promptSection {
	if len(spec.ReportingLines) == 0 {
		return promptSection{}
	}
	lines := []string{"# Result Reporting"}
	lines = append(lines, spec.ReportingLines...)
	return newPromptSection("result_reporting", lines...)
}

func buildPromptOnlineResearchSection() promptSection {
	return newPromptSection(
		"online_research_policy",
		"# Online Research Policy",
		"- When you need up-to-date or external information, prefer authoritative primary sources and direct URLs over web search.",
		"- Preferred sources: official product documentation, vendor docs, standards/RFCs, official GitHub repos/releases, and other primary sources.",
		"- Use web.search (or provider web search) only for discovery when you cannot identify the correct authoritative URL.",
		"- Treat search results as pointers, not evidence: fetch the underlying pages (via terminal.exec/curl), validate key details, and reference the exact URLs you relied on.",
		"- Avoid low-quality SEO content; if you must use it, corroborate with an authoritative source.",
	)
}

func buildPromptComplexitySection() promptSection {
	return newPromptSection(
		"complexity_policy",
		"# Complexity Policy",
		"- Classify the current request as simple, standard, or complex and adapt depth accordingly.",
		"- simple: solve directly with minimal overhead; avoid unnecessary process.",
		"- standard: keep a concise plan and checkpoint progress while executing.",
		"- complex: provide deeper investigation, stronger verification, and clearer progress checkpoints.",
	)
}

func buildPromptMandatoryRulesSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"# Mandatory Rules",
		"- Use tools when they are needed for reliable evidence or actions.",
		"- If you cannot complete safely, use the allowed completion path for this run. Do not stop silently.",
		"- You MUST use tools to investigate before answering questions about files, code, or the workspace.",
		"- When knowledge.search is available, query it first for domain background, then verify with terminal.exec before final conclusions.",
		"- Do NOT expose internal evidence path:line details to end users unless they explicitly ask for repository-level traceability.",
	}
	if snapshot.ProtocolSurface == RunProtocolSurfaceStructuredFileOps {
		lines = append(lines,
			"- Prefer file.read for direct file inspection before falling back to shell-based file dumps.",
			"- Prefer file.edit and file.write for normal file mutations instead of shell redirection or ad-hoc overwrite commands.",
			"- When the task asks for verification or a verification command, use terminal.exec for that verification; file.read can supplement inspection but does not replace a real verification command.",
			"- Keep file paths scoped to the runtime home boundary.",
			"- Treat the current working directory or explicitly provided workspace path as the active project boundary for tool args and terminal.exec workdir unless the user clearly expands scope.",
			"- Use apply_patch only when the structured file tools are insufficient or you truly need patch semantics.",
			"- If you call apply_patch, send exactly one canonical patch document from `*** Begin Patch` to `*** End Patch` with relative paths.",
			"- Use `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks inside apply_patch; do NOT send `diff --git` or raw `---` / `+++` diffs for normal edits.",
		)
	} else {
		lines = append(lines,
			"- If you can answer by reading files, use terminal.exec with rg/sed/cat first.",
			"- Prefer apply_patch for file edits instead of shell redirection or ad-hoc overwrite commands.",
			"- When you call apply_patch, send exactly one canonical patch document from `*** Begin Patch` to `*** End Patch` with relative paths.",
			"- Use `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks inside apply_patch; do NOT send `diff --git` or raw `---` / `+++` diffs for normal edits.",
		)
	}
	lines = append(lines,
		"- Use workdir/cwd fields on terminal.exec instead of running cd in the command string.",
		"- For long-running commands (tests/build/lint), increase terminal.exec timeout_ms (up to 30 minutes).",
		"- Do NOT wrap terminal.exec commands with an extra `bash -lc` (terminal.exec already runs a shell with -lc).",
		"- For multi-line scripts, pass content via terminal.exec `stdin` and use a stdin-reading command (e.g. `python -`, `bash`, `cat`). Avoid heredocs/here-strings.",
		"- Do NOT fabricate file contents, command outputs, or tool results. Always use tools to get real data.",
		"- Do NOT ask the user to run commands, gather logs, or paste outputs that tools can obtain directly.",
		"- Prefer autonomous continuation whenever available tools can make progress.",
		"- If information is insufficient and tools cannot help, follow the interaction policy in runtime context.",
		"- Prefer concrete choices over template placeholders like `YYYY-MM-DD`; the UI already provides a custom fallback input.",
	)
	return newPromptSection("mandatory_rules", lines...)
}

func buildPromptTodoDisciplineSection() promptSection {
	return newPromptSection(
		"todo_discipline",
		"# Todo Discipline",
		"- Follow the current todo policy from runtime context (none|recommended|required).",
		"- If todo policy is required, call write_todos before finalization and satisfy the minimum todo count.",
		"- If todo policy is recommended, prefer write_todos for multi-step execution and keep it updated.",
		"- If todo policy is none, skip todos unless they clearly improve execution quality.",
		"- Skip write_todos for a single trivial step that can be completed immediately.",
		"- Do NOT call write_todos with an empty list when there is no actionable work to track.",
		"- Keep exactly one todo as in_progress at a time.",
		"- Update write_todos immediately when you start, complete, cancel, or discover work.",
		"- Finish all feasible todos in this run before asking the user.",
		"- Before any final answer or runtime closeout, update write_todos one last time so no actionable items remain open.",
		"- Before task_complete, ensure all todos are completed or cancelled.",
	)
}

func buildPromptAntiPatternSection() promptSection {
	return newPromptSection(
		"anti_patterns",
		"# Anti-Patterns (NEVER do these)",
		"- Do NOT respond with only text when tools could answer the question.",
		"- Do NOT call task_complete without first verifying your work.",
		"- Do NOT give up after a tool error — try a different approach.",
		"- Do NOT repeat the same tool call with identical arguments.",
	)
}

func buildPromptToolFailureRecoverySection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"# Tool Failure Recovery",
		"- Do NOT pre-probe tool availability. Choose the best tool and try it.",
		"- On tool error: read the tool_result payload, then either repair args (once) or switch tools.",
	}
	if snapshot.ProtocolSurface == RunProtocolSurfaceStructuredFileOps {
		lines = append(lines,
			"- If file.edit fails because the target text no longer matches, re-read the file and regenerate a fresh exact replacement once.",
			"- If file.write would overwrite the wrong content, inspect the current file first and then rewrite deterministically.",
			"- If apply_patch fails, re-read the current file contents and regenerate a fresh canonical Begin/End Patch once; do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits.",
		)
	} else {
		lines = append(lines, "- If apply_patch fails, re-read the current file contents and regenerate a fresh canonical Begin/End Patch once; do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits.")
	}
	lines = append(lines,
		"- If web.search fails (e.g., missing API key), do NOT retry web.search; use terminal.exec with curl to query a public API or fetch an authoritative URL directly.",
		"- If terminal.exec fails, reduce scope or switch tools; if blocked, follow the interaction policy in runtime context.",
		"- If terminal.exec times out, do NOT rerun the same command unchanged. Reduce scope, raise timeout_ms only when justified, or switch strategy.",
	)
	return newPromptSection("tool_failure_recovery", lines...)
}

func buildPromptCommonWorkflowsSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"# Common Workflows",
		"- **Shell tasks**: terminal.exec → inspect output → task_complete",
	}
	if snapshot.ProtocolSurface == RunProtocolSurfaceStructuredFileOps {
		lines = append(lines,
			"- **File questions**: file.read or terminal.exec → analyze → final summary or task_complete",
			"- **Code changes**: file.read (inspect) → file.edit/file.write → terminal.exec (verify) → final summary or task_complete",
			"- **Debugging**: terminal.exec (reproduce) → file.edit/file.write or apply_patch → terminal.exec (verify) → final summary or task_complete",
		)
	} else {
		lines = append(lines,
			"- **File questions**: terminal.exec (rg --files / rg pattern / sed -n) → analyze → task_complete",
			"- **Code changes**: terminal.exec (inspect) → apply_patch (canonical Begin/End Patch) → terminal.exec (verify) → task_complete",
			"- **Debugging**: terminal.exec (reproduce) → apply_patch fix (canonical Begin/End Patch) → terminal.exec (verify) → task_complete",
		)
	}
	return newPromptSection("common_workflows", lines...)
}

func buildPromptSearchTemplateSection() promptSection {
	return newPromptSection(
		"search_template",
		"# Search Template",
		"- Default: `rg \"<PATTERN>\" . --hidden --glob '!.git' --glob '!node_modules' --glob '!.pnpm-store' --glob '!dist' --glob '!build' --glob '!out' --glob '!coverage' --glob '!target' --glob '!.venv' --glob '!venv' --glob '!.cache' --glob '!.next' --glob '!.turbo'`",
		"- If you explicitly need dependency or build output, remove the relevant --glob excludes.",
	)
}

func buildPromptAskUserPolicySection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"# Ask User Policy",
		"- Use ask_user when you genuinely need the user's next structured input to continue.",
		"- Allowed ask_user cases include true external blockers and guided interaction turns where the next step depends on an explicit user choice or typed answer.",
		"- Do NOT use ask_user to delegate commands, file inspection, log gathering, screenshots, or web research that available tools can do directly.",
		"- ask_user must include reason_code, required_from_user, and evidence_refs.",
		"- reason_code must be one of: user_decision_required | permission_blocked | missing_external_input | conflicting_constraints | safety_confirmation.",
		"- required_from_user must list concrete user inputs or decisions needed to proceed.",
		"- evidence_refs must reference relevant tool IDs when evidence is required.",
		"- ask_user arguments are structured as `questions[]`; every question must include id, header, question, is_secret, and response_mode.",
		"- Any question with fixed choices MUST also declare `choices_exhaustive`.",
		"- For guided questionnaires, interviews, quizzes, guessing games, or decision trees, prefer ask_user over freeform markdown option lists.",
		"- If you are going to call `ask_user`, do NOT first emit a separate markdown questionnaire, duplicated prose question, or A/B/C option list outside the structured ask_user payload.",
		"- Preserve explicit interaction-shape constraints from the user, such as fixed options, clickable choices, one-question-at-a-time, indirect questioning, or similar format requirements.",
		"- When the user requires an indirect, non-leading, or proxy-based interaction, preserve that constraint in both `question` and `choices[]`. Do NOT directly name, bucket, or reveal the target attribute the user asked you to infer indirectly; ask about proxy signals or correlated situations instead.",
		"- Use `response_mode:\"select\"` only when fixed choices are genuinely exhaustive by construction and you set `choices_exhaustive:true`.",
		"- Use `response_mode:\"select_or_write\"` when fixed choices are not exhaustive and you set `choices_exhaustive:false`, so the UI preserves a standardized typed fallback.",
		"- Use `response_mode:\"write\"` for direct-input questions with no fixed choices.",
		"- For guided questionnaires, quizzes, guessing games, or hidden-target inference turns that narrow hypotheses about the user's real situation, default to a few fixed select choices plus a typed fallback instead of a pure write-only question.",
		"- If the user explicitly asks for answer choices, fixed options, buttons, or clickable options, do NOT downgrade the question into pure `response_mode:\"write\"`; keep fixed choices and add a typed fallback via `response_mode:\"select_or_write\"` when needed.",
		"- `choices[]` contains fixed options only. Do not encode the typed fallback as a fake write choice inside `choices[]`.",
		"- For `response_mode:\"select_or_write\"`, the UI will render a standardized typed fallback such as `None of the above: ___`; provide `write_label` and optional `write_placeholder` when that wording matters.",
		"- When offering fixed options about the user's real situation, preference, habit, background, or other potentially non-exhaustive state, treat the set as non-exhaustive by default: use `response_mode:\"select_or_write\"` and `choices_exhaustive:false` unless the option set is genuinely exhaustive by construction.",
		"- If the user explicitly asks for an `Other` or `None of the above` path, you MUST represent it via `response_mode:\"select_or_write\"` with `choices_exhaustive:false` rather than omitting the typed fallback.",
		"- Keep choices concise and mutually exclusive. Put the best/default path first when that ordering matters.",
		"- For deterministic UI actions, place actions on `questions[].choices[].actions` (for example {type:\"set_mode\",mode:\"act\"}).",
	}
	if snapshot.ProtocolWaitingMode == RunWaitingModeExitPlanMode {
		lines = append(lines, "- Do NOT use ask_user for plan-to-act switching when exit_plan_mode is available; use exit_plan_mode instead.")
	}
	if snapshot.SupportsAskUserQuestionBatches {
		lines = append(lines, "- Default to one question at a time. Use multiple questions only when the questions are tightly coupled and must be answered together.")
	} else {
		lines = append(lines, "- This runtime does not support batched ask_user questions. Emit exactly one question.")
	}
	return newPromptSection("ask_user_policy", lines...)
}

func buildPromptAutonomousInteractionSection(spec promptProfileSpec) promptSection {
	if len(spec.InteractionLines) == 0 {
		return promptSection{}
	}
	lines := []string{"# Interaction Policy"}
	lines = append(lines, spec.InteractionLines...)
	return newPromptSection("interaction_policy", lines...)
}

func buildPromptPlanModeSection(spec promptProfileSpec, snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{
		"## Plan Mode Rules (Strict Readonly)",
		"- Prioritize investigation, reasoning, and clear execution plans.",
		"- Plan mode is strict readonly: do NOT run any mutating action.",
		"- Do NOT call file.edit, file.write, apply_patch, or mutating terminal.exec commands.",
		"- Readonly terminal.exec commands include local inspection and readonly HTTP fetches that only stream to stdout (for example `curl -s URL`, `curl -I URL`, `wget -qO- URL`).",
		"- HTTP commands that write local files/state or send request bodies/uploads are mutating (for example `curl -o`, `curl -d`, `curl -F`, `curl -T`, `wget -O file`, `wget --post-data`).",
	}
	if snapshot.AllowUserInteraction {
		if snapshot.ProtocolWaitingMode == RunWaitingModeExitPlanMode {
			lines = append(lines,
				"- If execution is required, call exit_plan_mode instead of constructing a manual mode-switch ask_user payload.",
				"- Keep the summary concise and focused on why act mode is required.",
			)
		} else {
			lines = append(lines,
				"- If edits are required, call ask_user and request the user to switch this thread to act mode.",
				"- For this switch request, use reason_code=user_decision_required and keep required_from_user concrete.",
				"- Use a single ask_user question whose options include one label like \"Switch to Act mode\" with actions=[{type:\"set_mode\",mode:\"act\"}].",
			)
		}
	} else if spec.PrefersParentFacingReporting {
		lines = append(lines,
			"- User interaction is disabled in this run, so do NOT call ask_user.",
			"- If edits are required, finish with task_complete and report blockers plus suggested parent actions.",
		)
	} else {
		lines = append(lines,
			"- User interaction is disabled in this run, so do NOT call ask_user.",
			"- If edits are required, finish with task_complete and report blockers plus concrete next-step guidance for the user-facing thread.",
		)
	}
	return newPromptSection("plan_mode_rules", lines...)
}

func buildPromptCompletionContractSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{"# Completion Contract"}
	switch snapshot.CompletionContract {
	case completionContractFirstTurn:
		lines = append(lines,
			"- This run starts in hybrid_first_turn mode: if the first turn fully resolves the objective, you may reply with the final markdown answer directly.",
			"- If you continue beyond the first turn, switch to explicit signals: call task_complete when done or ask_user when structured user input is required.",
		)
	case completionContractExplicitOnly:
		if snapshot.ProtocolCompletionMode == RunCompletionModeRuntimeCloseout {
			lines = append(lines,
				"- Prefer task_complete with a detailed result summary when it is natural to do so.",
				"- After verified tool work, the runtime may also close out successfully from a strong final answer even if task_complete is missing.",
				"- Once verified work is complete, stop narrating future steps and give the final answer or task_complete immediately.",
				"- Do NOT rely on runtime closeout while you are still waiting on the user or when the work is not actually verified.",
			)
		} else {
			lines = append(lines,
				"- You MUST call task_complete with a detailed result summary when done. Never end without it.",
				"- Task runs are explicit-completion only: no task_complete means the task is not complete.",
			)
		}
	default:
		return promptSection{}
	}
	return newPromptSection("completion_contract", lines...)
}

func buildPromptRuntimeContextSection(snapshot promptRuntimeSnapshot) promptSection {
	recentErrors := "none"
	if len(snapshot.RecentErrors) > 0 {
		recentErrors = strings.Join(snapshot.RecentErrors, " | ")
	}
	todoStatus := "unknown"
	if snapshot.TodoStatus.TrackingEnabled {
		todoStatus = fmt.Sprintf(
			"open=%d,in_progress=%d,version=%d,last_updated_round=%d",
			snapshot.TodoStatus.OpenCount,
			snapshot.TodoStatus.InProgressCount,
			snapshot.TodoStatus.SnapshotVersion,
			snapshot.TodoStatus.LastUpdatedRound,
		)
	}
	lines := []string{
		"## Current Context",
		fmt.Sprintf("- Working directory: %s", snapshot.WorkingDir),
		fmt.Sprintf("- Current round: %d (first_round=%t)", snapshot.RoundIndex+1, snapshot.IsFirstRound),
		fmt.Sprintf("- Mode: %s", snapshot.Mode),
		fmt.Sprintf("- Prompt profile: %s", snapshot.PromptProfile),
		fmt.Sprintf("- Protocol surface: %s", snapshot.ProtocolSurface),
		fmt.Sprintf("- Execution contract: %s", snapshot.ExecutionContract),
		fmt.Sprintf("- Completion contract: %s", snapshot.CompletionContract),
		fmt.Sprintf("- Protocol completion mode: %s", snapshot.ProtocolCompletionMode),
		fmt.Sprintf("- Protocol waiting mode: %s", snapshot.ProtocolWaitingMode),
		fmt.Sprintf("- Task complexity: %s", snapshot.TaskComplexity),
		fmt.Sprintf("- Todo policy: %s", snapshot.TodoPolicy),
		fmt.Sprintf("- Available tools: %s", snapshot.AvailableToolNames),
		fmt.Sprintf("- Objective: %s", snapshot.Objective),
		fmt.Sprintf("- Recent errors: %s", recentErrors),
		fmt.Sprintf("- Todo tracking: %s", todoStatus),
	}
	lines = append(lines, interactionContractRuntimeLines(snapshot.InteractionContract)...)
	if snapshot.AllowUserInteraction {
		lines = append(lines, fmt.Sprintf("- Ask-user question batches supported: %t", snapshot.SupportsAskUserQuestionBatches))
	} else if resolvePromptProfileSpec(snapshot.PromptProfile).PrefersParentFacingReporting {
		lines = append(lines, "- Interaction policy: user interaction is disabled in this run. Continue autonomously or finish with task_complete including blockers plus suggested parent actions.")
	} else {
		lines = append(lines, "- Interaction policy: user interaction is disabled in this run. Continue autonomously or finish with task_complete including blockers plus concrete next-step guidance for the user-facing thread.")
	}
	if snapshot.TodoPolicy == TodoPolicyRequired {
		lines = append(lines, fmt.Sprintf("- Required todo minimum: %d", snapshot.RequiredTodoMinimum))
	}
	if len(snapshot.AvailableSkills) > 0 {
		lines = append(lines, fmt.Sprintf("- Available skills: %s", joinSkillNames(snapshot.AvailableSkills)))
	}
	return newPromptSection("runtime_context", lines...)
}

func promptStaticPrefixCacheKey(snapshot promptRuntimeSnapshot) cachedPromptPrefixKey {
	mode := strings.ToLower(strings.TrimSpace(snapshot.Mode))
	return cachedPromptPrefixKey{
		Profile:                        resolveRunPromptProfile(snapshot.PromptProfile, nil, snapshot.AllowUserInteraction),
		Mode:                           mode,
		AllowUserInteraction:           snapshot.AllowUserInteraction,
		SupportsAskUserQuestionBatches: snapshot.SupportsAskUserQuestionBatches,
		PlanMode:                       isPlanMode(mode),
		ProtocolSurface:                snapshot.ProtocolSurface,
		ProtocolCompletionMode:         snapshot.ProtocolCompletionMode,
		ProtocolWaitingMode:            snapshot.ProtocolWaitingMode,
	}
}

func isPlanMode(mode string) bool {
	return strings.EqualFold(strings.TrimSpace(mode), config.AIModePlan)
}
