package ai

import (
	"fmt"
	"strings"
	"sync"
	"time"
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
	LocalTime                      promptLocalTimeContext
	WorkspaceContext               promptWorkspaceContext
	RoundIndex                     int
	IsFirstRound                   bool
	PermissionType                 string
	Objective                      string
	TaskComplexity                 string
	PromptProfile                  string
	TodoStatus                     promptTodoStatus
	RecentErrors                   []string
	AvailableToolNames             string
	AvailableSkills                []SkillMeta
	ActiveSkills                   []SkillActivation
	AllowUserInteraction           bool
	SupportsAskUserQuestionBatches bool
	ExceptionOverlay               string
}

type cachedPromptPrefixKey struct {
	Profile                        string
	PermissionType                 string
	AllowUserInteraction           bool
	SupportsAskUserQuestionBatches bool
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

func buildPromptRuntimeSnapshot(r *run, objective string, permissionType string, complexity string, round int, isFirstRound bool, tools []ToolDef, state runtimeState, exceptionOverlay string, capability runCapabilityContract) promptRuntimeSnapshot {
	complexity = normalizeTaskComplexity(complexity)
	allowUserInteraction := capability.AllowUserInteraction
	if !allowUserInteraction && strings.TrimSpace(capability.PromptProfile) == "" {
		allowUserInteraction = r == nil || !r.noUserInteraction
	}

	cwd := promptWorkingDirForRun(r)

	availableToolNames := joinToolNames(tools)
	if len(capability.AllowedTools) > 0 || len(capability.AllowedSignals) > 0 {
		availableToolNames = joinToolAndSignalNames(capability.AllowedTools, capability.AllowedSignals)
	}

	availableSkills := []SkillMeta{}
	activeSkills := []SkillActivation{}
	if r != nil {
		availableSkills = r.listSkills()
		activeSkills = r.activeSkills()
	}
	return promptRuntimeSnapshot{
		WorkingDir:       cwd,
		LocalTime:        currentPromptLocalTimeContext(time.Now),
		WorkspaceContext: collectPromptWorkspaceContext(r, capability),
		RoundIndex:       round,
		IsFirstRound:     isFirstRound,
		PermissionType:   strings.TrimSpace(permissionType),
		Objective:        strings.TrimSpace(objective),
		TaskComplexity:   complexity,
		PromptProfile:    resolveRunPromptProfile(strings.TrimSpace(capability.PromptProfile), r, allowUserInteraction),
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
		buildPromptOnlineResearchSection(snapshot),
		buildPromptComplexitySection(),
		buildPromptMandatoryRulesSection(snapshot),
		buildPromptTodoDisciplineSection(),
		buildPromptAntiPatternSection(),
		buildPromptToolFailureRecoverySection(snapshot),
		buildPromptCommonWorkflowsSection(snapshot),
		newPromptSection("markdown_output_contract", buildMarkdownOutputContractLines()...),
		buildPromptSearchTemplateSection(snapshot),
	)
	if snapshot.AllowUserInteraction {
		sections = append(sections, buildPromptAskUserPolicySection(snapshot))
	} else if section := buildPromptAutonomousInteractionSection(spec); !section.isEmpty() {
		sections = append(sections, section)
	}
	return sections
}

func buildPromptDynamicSections(snapshot promptRuntimeSnapshot) []promptSection {
	sections := []promptSection{}
	sections = append(sections, buildPromptRuntimeContextSection(snapshot))
	if section := buildPromptWorkspaceContextSection(snapshot); !section.isEmpty() {
		sections = append(sections, section)
	}
	if promptToolAvailable(snapshot.AvailableToolNames, "use_skill") {
		if section := newPromptSectionFromText("skill_catalog", buildSkillCatalogPrompt(snapshot.AvailableSkills)); !section.isEmpty() {
			sections = append(sections, section)
		}
		if section := newPromptSectionFromText("skill_overlay", buildSkillOverlayPrompt(snapshot.ActiveSkills)); !section.isEmpty() {
			sections = append(sections, section)
		}
	}
	return sections
}

func buildPromptMandateSection(spec promptProfileSpec) promptSection {
	lines := []string{"# Identity & Mandate"}
	lines = append(lines, spec.IdentityLines...)
	lines = append(lines,
		"Operate within the available tools and permission policy for this session.",
		"The working directory defines the active project boundary for file tools and terminal cwd/workdir. The runtime home is only the outer sandbox; do not assume access outside the active project.",
	)
	lines = append(lines, spec.StrategyLines...)
	return newPromptSection("identity_mandate", lines...)
}

func buildPromptToolUsageSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{"# Tool Usage Strategy"}
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		lines = append(lines,
			"Follow this workflow for every task:",
			"1. **Investigate** — Use read_file/read_files, rgrep, and find for project-scoped workspace inspection. Use web.search for URL discovery and web_fetch for public text pages when network information is needed.",
			"2. **Reason** — Identify what can be answered or verified with the readonly tools currently available.",
			"3. **Verify** — Cross-check claims with additional readonly inspection or authoritative fetched sources. Shell commands and file mutation tools are unavailable in readonly permission.",
			"4. **Respond** — Reply naturally when the turn is complete; use ask_user only when the next step truly depends on user input.",
			"",
			"Information source routing:",
			"- Current workspace code and files -> read_file/read_files, rgrep, or find.",
			"- Redeven maintained repository knowledge -> okf.index, okf.search, and okf.open.",
			"- Use okf.index to discover OKF areas for broad Redeven-internal questions.",
			"- Use okf.search to find candidate concepts; keep broad searches short, usually max_results=3.",
			"- Use okf.open before relying on OKF for detailed facts, boundaries, contracts, or workflows.",
			"- Source-level conclusions require readonly file/search verification after OKF navigation.",
			"- External/current/recent/news/third-party/general web facts -> authoritative URLs via web_fetch; use web.search only for discovery when the URL is unknown.",
			"",
			"Skill routing:",
			"- Skills are unavailable in readonly unless explicitly listed in the current available tools.",
		)
		return newPromptSection("tool_usage_strategy", lines...)
	}
	lines = append(lines,
		"Follow this workflow for every task:",
		"1. **Investigate** — Use terminal.exec to inspect the workspace, relevant local paths, and device state (rg/sed/cat for code; OS probes for diagnostics; curl for network data) and gather context.",
		"2. **Reason** — Identify what needs to be done based on the information gathered.",
		"3. **Change** — Use the available file tools for file inspection and mutation, apply_patch for patch-shaped edits, and terminal.exec for validated command actions.",
		"4. **Verify** — Use terminal.exec to run checks (tests/lint/build) and confirm correctness.",
		"5. **Respond** — Reply naturally when the turn is complete; use ask_user only when the next step truly depends on user input.",
		"",
		"Information source routing:",
		"- Current workspace code, files, builds, tests, and device state -> terminal.exec or file tools.",
		"- Redeven maintained repository knowledge -> okf.index, okf.search, and okf.open.",
		"- Use okf.index to discover OKF areas for broad Redeven-internal questions.",
		"- Use okf.search to find candidate concepts; keep broad searches short, usually max_results=3.",
		"- Use okf.open before relying on OKF for detailed facts, boundaries, contracts, or workflows.",
		"- Source-level conclusions require file or terminal verification after OKF navigation.",
		"- External/current/recent/news/third-party/general web facts -> authoritative URLs via terminal.exec/curl; use web.search only for discovery when the URL is unknown.",
		"",
		"Skill routing:",
		"- When a request clearly matches an available skill, activate it with use_skill before acting and follow the activated skill body for domain-specific operations.",
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
		"- Spawn subagents with subagents(action=\"spawn\", agent_type=\"explore|worker|reviewer\", task_name=\"short stable name\", task_description=\"one sentence user-facing responsibility\", message=\"specific delegated mission\", context_mode=\"mission_only|full_history\").",
		"- Use context_mode=\"mission_only\" by default; choose context_mode=\"full_history\" only when the child genuinely needs the parent thread's full prior conversation to decide correctly.",
		"- Use explore for readonly investigation, worker for bounded implementation, and reviewer for independent consistency/risk review.",
		"- Keep each delegated mission self-contained: include scope, files or modules, expected evidence, and what the parent needs back.",
		"- Track child thread_id values returned by spawn; thread_id is the identity for send_input, wait, inspect, and close.",
		"- Use subagents(action=\"wait\", ids:[\"<thread_id>\"], timeout_ms:60000) when you need a child result before deciding.",
		"- Read completed wait results from final_handoff_report; read timed-out wait results from progress_summary. Do not treat preview fields as the child result.",
		"- Use subagents(action=\"list\") and subagents(action=\"inspect\", target:\"<thread_id>\") to monitor work and recover exact state.",
		"- Use subagents(action=\"send_input\", target:\"<thread_id>\", message:\"...\", interrupt:true|false) to steer a child; interrupt only for a real change in direction.",
		"- Use subagents(action=\"close\", target:\"<thread_id>\") or close_all when delegated work is no longer useful.",
		"- Always inspect or wait for relevant subagents before relying on their output, and integrate their results into the parent thread's final reasoning.",
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

func buildPromptOnlineResearchSection(snapshot promptRuntimeSnapshot) promptSection {
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		return newPromptSection(
			"online_research_policy",
			"# Online Research Policy",
			"- When you need up-to-date or external information, prefer authoritative primary sources and direct URLs over web search.",
			"- Preferred sources: official product documentation, vendor docs, standards/RFCs, official GitHub repos/releases, and other primary sources.",
			"- Use web.search only for discovery when you cannot identify the correct authoritative URL.",
			"- Treat search results as pointers, not evidence: fetch the underlying public text pages with web_fetch, validate key details, and reference the exact URLs you relied on.",
			"- OKF does not access the internet and must not be used for external/current/recent/news/third-party/general web facts.",
			"- Do not use OKF tools as a fallback when web.search/web_fetch is unavailable.",
			"- Avoid low-quality SEO content; if you must use it, corroborate with an authoritative source.",
		)
	}
	return newPromptSection(
		"online_research_policy",
		"# Online Research Policy",
		"- When you need up-to-date or external information, prefer authoritative primary sources and direct URLs over web search.",
		"- Preferred sources: official product documentation, vendor docs, standards/RFCs, official GitHub repos/releases, and other primary sources.",
		"- Use web.search (or provider web search) only for discovery when you cannot identify the correct authoritative URL.",
		"- Treat search results as pointers, not evidence: fetch the underlying pages (via terminal.exec/curl), validate key details, and reference the exact URLs you relied on.",
		"- OKF does not access the internet and must not be used for external/current/recent/news/third-party/general web facts.",
		"- Do not use OKF tools as a fallback when web.search is unavailable; fetch authoritative URLs with terminal.exec/curl instead.",
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
		"- Do NOT expose internal evidence path:line details to end users unless they explicitly ask for repository-level traceability.",
	}
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		lines = append(lines,
			"- Use OKF tools only for Redeven repository knowledge: okf.index for broad directory discovery, okf.search for short candidate lists, and okf.open for detailed concept facts.",
			"- Do not answer detailed OKF-backed claims from search snippets alone; open the relevant concept first.",
			"- For source-level conclusions, verify OKF background with readonly file/search tools before final conclusions.",
			"- Prefer read_file/read_files for direct file inspection, rgrep for content search, find for path discovery, and web_fetch for authoritative public text pages.",
			"- Shell commands, file edits, patch application, and mutation-oriented verification are unavailable in readonly permission.",
			"- When the task asks for verification that requires unavailable shell or mutation tools, explain the permission blocker and use ask_user only when user direction is required.",
			"- Keep file paths inside the active project boundary; the runtime home is only the outer sandbox.",
			"- Do NOT fabricate file contents, command outputs, or tool results. Always use available tools to get real data.",
			"- Do NOT ask the user to gather logs, inspect files, or paste outputs that available readonly tools can obtain directly.",
			"- Prefer autonomous continuation whenever available tools can make progress.",
			"- If information is insufficient and tools cannot help, follow the interaction policy in runtime context.",
			"- When the user uses relative dates such as today, tomorrow, or yesterday, resolve them against the current date and timezone in runtime context, and prefer explicit absolute dates when clarity matters.",
			"- Prefer concrete choices over template placeholders like `YYYY-MM-DD`; the UI already provides a custom fallback input.",
		)
		return newPromptSection("mandatory_rules", lines...)
	}
	lines = append(lines,
		"- Use OKF tools only for Redeven repository knowledge: okf.index for broad directory discovery, okf.search for short candidate lists, and okf.open for detailed concept facts.",
		"- Do not answer detailed OKF-backed claims from search snippets alone; open the relevant concept first.",
		"- For source-level conclusions, verify OKF background with terminal.exec or file tools before final conclusions.",
		"- Use canonical tool names exactly as listed in Current Context; do not convert punctuation in tool names or invent underscore variants.",
		"- Prefer the explicit file tools for direct file inspection or mutation when they are available.",
		"- Prefer apply_patch for patch-shaped edits instead of shell redirection or ad-hoc overwrite commands.",
		"- When the task asks for verification or a verification command, use terminal.exec for that verification; file inspection can supplement but does not replace a real verification command.",
		"- Keep file paths inside the active project boundary; the runtime home is only the outer sandbox.",
		"- Tool argument limits are strict: terminal.exec should use yield_ms for the initial wait; timeout_ms is only a compatibility alias for yield_ms, not a hard timeout, and terminal.read wait_ms must be <= 30000.",
		"- Treat the current working directory and any terminal.exec cwd/workdir as the same active project boundary; they must resolve to the current project root rather than some sibling path.",
		"- When you call apply_patch, send exactly one canonical patch document from `*** Begin Patch` to `*** End Patch` with relative paths.",
		"- Use `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks inside apply_patch; do NOT send `diff --git` or raw `---` / `+++` diffs for normal edits.",
		"- In apply_patch `*** Add File:` bodies, prefix every new content line with `+`.",
		"- Use workdir/cwd fields on terminal.exec instead of running cd in the command string.",
		"- For long-running commands (tests/build/lint), keep terminal.exec interactive: use yield_ms for the initial wait, then terminal.read for progress, terminal.write for input, and terminal.terminate(process_id) only when stopping is intentional.",
		"- Do NOT wrap terminal.exec commands with an extra `bash -lc` (terminal.exec already runs a shell with -lc).",
		"- For multi-line scripts, pass content via terminal.exec `stdin` and use a stdin-reading command (e.g. `python -`, `bash`, `cat`). Avoid here documents and here-strings.",
		"- Do NOT fabricate file contents, command outputs, or tool results. Always use tools to get real data.",
		"- Do NOT ask the user to run commands, gather logs, or paste outputs that tools can obtain directly.",
		"- Prefer autonomous continuation whenever available tools can make progress.",
		"- If information is insufficient and tools cannot help, follow the interaction policy in runtime context.",
		"- When the user uses relative dates such as today, tomorrow, or yesterday, resolve them against the current date and timezone in runtime context, and prefer explicit absolute dates when clarity matters.",
		"- Prefer concrete choices over template placeholders like `YYYY-MM-DD`; the UI already provides a custom fallback input.",
	)
	return newPromptSection("mandatory_rules", lines...)
}

func buildPromptTodoDisciplineSection() promptSection {
	return newPromptSection(
		"todo_discipline",
		"# Todo Discipline",
		"- Use write_todos for meaningful multi-step execution when it clarifies current work and remaining work.",
		"- Skip write_todos for a single trivial step that can be completed immediately.",
		"- Do NOT call write_todos with an empty list when there is no actionable work to track.",
		"- Track only actionable work in write_todos. Do not create todos for control signals such as task_complete or ask_user.",
		"- Keep exactly one todo as in_progress at a time.",
		"- Update write_todos immediately when you start, complete, cancel, or discover work.",
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
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		lines = append(lines,
			"- If read_file/read_files fails for a path, use find or rgrep to locate the correct project-scoped file and then retry with the corrected path.",
			"- If rgrep fails because the query is too broad or invalid, narrow the query, reduce context, or switch to read_file/read_files on likely files.",
			"- If web_fetch fails or blocks a URL, use web.search to find an authoritative alternate URL; do not try shell commands.",
		)
		return newPromptSection("tool_failure_recovery", lines...)
	}
	lines = append(lines,
		"- If file.edit fails because the target text no longer matches, re-read the file and regenerate a fresh exact replacement once.",
		"- If file.write would overwrite the wrong content, inspect the current file first and then rewrite deterministically.",
		"- If apply_patch fails, re-read the current file contents and regenerate a fresh canonical Begin/End Patch once; do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits.",
		"- If web.search fails (e.g., missing API key), do NOT retry web.search; use terminal.exec with curl to query a public API or fetch an authoritative URL directly.",
		"- If terminal.exec fails, reduce scope or switch tools; if blocked, follow the interaction policy in runtime context.",
		"- If terminal.exec returns a running process_id, inspect it with terminal.read instead of repeating the same command.",
	)
	return newPromptSection("tool_failure_recovery", lines...)
}

func buildPromptCommonWorkflowsSection(snapshot promptRuntimeSnapshot) promptSection {
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		return newPromptSection(
			"common_workflows",
			"# Common Workflows",
			"- **Workspace questions**: rgrep/find -> read_file/read_files -> analyze -> final answer",
			"- **External facts**: web.search when needed -> web_fetch authoritative source -> final answer with URLs",
			"- **Code review**: rgrep/find -> read_file/read_files -> reason about risks/tests -> final answer",
			"- **Blocked by missing mutation or shell**: explain the blocker and ask_user when user direction is needed.",
		)
	}
	lines := []string{
		"# Common Workflows",
		"- **Shell tasks**: terminal.exec → inspect output → final answer",
		"- **File questions**: file.read or terminal.exec → analyze → final answer",
		"- **Code changes**: file.read or terminal.exec → edit with file tools/apply_patch → terminal.exec (verify) → final answer",
		"- **Debugging**: terminal.exec (reproduce) → edit with file tools/apply_patch → terminal.exec (verify) → final answer",
	}
	return newPromptSection("common_workflows", lines...)
}

func buildPromptSearchTemplateSection(snapshot promptRuntimeSnapshot) promptSection {
	if strings.TrimSpace(snapshot.PermissionType) == string(FlowerPermissionReadonly) {
		return newPromptSection(
			"search_template",
			"# Search Template",
			"- Default rgrep: query=\"<PATTERN>\", paths=[\".\"], include_hidden=true, globs=[\"!.git\", \"!node_modules\", \"!.pnpm-store\", \"!dist\", \"!build\", \"!out\", \"!coverage\", \"!target\", \"!.venv\", \"!venv\", \"!.cache\", \"!.next\", \"!.turbo\"].",
			"- If you explicitly need dependency or build output, remove the relevant glob excludes.",
		)
	}
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
		"- Use `response_mode:\"select_or_write\"` when fixed choices are not exhaustive and you set `choices_exhaustive:false`, so the user can either choose a fixed option or provide custom text.",
		"- Use `response_mode:\"write\"` for direct-input questions with no fixed choices.",
		"- For guided questionnaires, quizzes, guessing games, or hidden-target inference turns that narrow hypotheses about the user's real situation, default to a few fixed select choices plus a custom text answer instead of a pure write-only question.",
		"- If the user explicitly asks for answer choices, fixed options, buttons, or clickable options, do NOT downgrade the question into pure `response_mode:\"write\"`; keep fixed choices and allow custom text via `response_mode:\"select_or_write\"` when needed.",
		"- `choices[]` contains fixed options only. Do not encode custom text as a fake write choice inside `choices[]`.",
		"- For `response_mode:\"select_or_write\"`, provide `write_label` and optional `write_placeholder` when the custom text wording matters.",
		"- When offering fixed options about the user's real situation, preference, habit, background, or other potentially non-exhaustive state, treat the set as non-exhaustive by default: use `response_mode:\"select_or_write\"` and `choices_exhaustive:false` unless the option set is genuinely exhaustive by construction.",
		"- If the user explicitly asks for an `Other` or `None of the above` path, represent it via `response_mode:\"select_or_write\"` with `choices_exhaustive:false`.",
		"- Keep choices concise and mutually exclusive. Put the best/default path first when that ordering matters.",
		"- For deterministic UI actions, place actions on `questions[].choices[].actions` only when the action is a true UI action in the current runtime contract.",
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
	}
	lines = append(lines, renderPromptLocalTimeContextLines(snapshot.LocalTime)...)
	lines = append(lines,
		fmt.Sprintf("- Current round: %d (first_round=%t)", snapshot.RoundIndex+1, snapshot.IsFirstRound),
		fmt.Sprintf("- Prompt profile: %s", snapshot.PromptProfile),
		fmt.Sprintf("- Task complexity: %s", snapshot.TaskComplexity),
		fmt.Sprintf("- Available tools: %s", snapshot.AvailableToolNames),
		fmt.Sprintf("- Objective: %s", snapshot.Objective),
		fmt.Sprintf("- Recent errors: %s", recentErrors),
		fmt.Sprintf("- Todo tracking: %s", todoStatus),
	)
	if snapshot.AllowUserInteraction {
		lines = append(lines, fmt.Sprintf("- Ask-user question batches supported: %t", snapshot.SupportsAskUserQuestionBatches))
	} else if resolvePromptProfileSpec(snapshot.PromptProfile).PrefersParentFacingReporting {
		lines = append(lines, "- Interaction policy: user interaction is disabled in this run. Continue autonomously or finish with task_complete including blockers plus suggested parent actions.")
	} else {
		lines = append(lines, "- Interaction policy: user interaction is disabled in this run. Continue autonomously or finish with task_complete including blockers plus concrete next-step guidance for the user-facing thread.")
	}
	if len(snapshot.AvailableSkills) > 0 {
		if promptToolAvailable(snapshot.AvailableToolNames, "use_skill") {
			lines = append(lines, fmt.Sprintf("- Available skills: %s", joinSkillNames(snapshot.AvailableSkills)))
		}
	}
	return newPromptSection("runtime_context", lines...)
}

func promptStaticPrefixCacheKey(snapshot promptRuntimeSnapshot) cachedPromptPrefixKey {
	permissionType := strings.ToLower(strings.TrimSpace(snapshot.PermissionType))
	return cachedPromptPrefixKey{
		Profile:                        resolveRunPromptProfile(snapshot.PromptProfile, nil, snapshot.AllowUserInteraction),
		PermissionType:                 permissionType,
		AllowUserInteraction:           snapshot.AllowUserInteraction,
		SupportsAskUserQuestionBatches: snapshot.SupportsAskUserQuestionBatches,
	}
}

func promptToolAvailable(names string, want string) bool {
	want = strings.TrimSpace(want)
	if want == "" {
		return false
	}
	for _, name := range strings.Split(names, ",") {
		if strings.TrimSpace(name) == want {
			return true
		}
	}
	return false
}
