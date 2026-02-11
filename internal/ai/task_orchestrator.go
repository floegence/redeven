package ai

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

type taskLoopConfig struct {
	MaxTurns               int
	MaxNoProgressTurns     int
	MaxRepeatedSignatures  int
	AnalysisRequireSignals int
}

type taskLoopState struct {
	Objective         string
	TurnsUsed         int
	NoProgressTurn    int
	LastDigest        string
	Signatures        map[string]int
	EvidenceToolSeen  bool
	EvidencePathSet   map[string]struct{}
	EvidencePathHints []string
}

type taskLoopDecision struct {
	Continue       bool
	FailRun        bool
	Reason         string
	Action         recoveryAction
	NextPrompt     string
	FailureMessage string
}

const defaultTaskLoopProfileID = "fast_exit_v1"

var taskLoopProfiles = map[string]taskLoopConfig{
	"adaptive_default_v2": {
		MaxTurns:               12,
		MaxNoProgressTurns:     2,
		MaxRepeatedSignatures:  3,
		AnalysisRequireSignals: 2,
	},
	"fast_exit_v1": {
		MaxTurns:               8,
		MaxNoProgressTurns:     2,
		MaxRepeatedSignatures:  2,
		AnalysisRequireSignals: 1,
	},
	"deep_analysis_v1": {
		MaxTurns:               16,
		MaxNoProgressTurns:     3,
		MaxRepeatedSignatures:  4,
		AnalysisRequireSignals: 3,
	},
	"conservative_recovery_v1": {
		MaxTurns:               10,
		MaxNoProgressTurns:     2,
		MaxRepeatedSignatures:  2,
		AnalysisRequireSignals: 2,
	},
}

func defaultTaskLoopConfig() taskLoopConfig {
	cfg, ok := taskLoopProfiles[defaultTaskLoopProfileID]
	if !ok {
		return taskLoopConfig{
			MaxTurns:               24,
			MaxNoProgressTurns:     3,
			MaxRepeatedSignatures:  3,
			AnalysisRequireSignals: 2,
		}
	}
	return cfg
}

func resolveTaskLoopConfigProfile(raw string) (string, taskLoopConfig) {
	key := strings.TrimSpace(strings.ToLower(raw))
	if key == "" {
		return defaultTaskLoopProfileID, defaultTaskLoopConfig()
	}
	if cfg, ok := taskLoopProfiles[key]; ok {
		return key, cfg
	}
	return defaultTaskLoopProfileID, defaultTaskLoopConfig()
}

func newTaskLoopState(objective string) taskLoopState {
	return taskLoopState{
		Objective:       strings.TrimSpace(objective),
		Signatures:      map[string]int{},
		EvidencePathSet: map[string]struct{}{},
	}
}

func decideTaskLoop(cfg taskLoopConfig, state *taskLoopState, summary turnAttemptSummary, userInput string) taskLoopDecision {
	decision := taskLoopDecision{Reason: "complete", Action: recoveryActionNone}
	if state == nil {
		tmp := newTaskLoopState("")
		state = &tmp
	}
	if state.Signatures == nil {
		state.Signatures = map[string]int{}
	}
	if state.EvidencePathSet == nil {
		state.EvidencePathSet = map[string]struct{}{}
	}
	if cfg.MaxTurns <= 0 {
		cfg.MaxTurns = 24
	}
	if cfg.MaxTurns > 32 {
		cfg.MaxTurns = 32
	}
	if cfg.MaxNoProgressTurns <= 0 {
		cfg.MaxNoProgressTurns = 3
	}
	if cfg.MaxNoProgressTurns > 6 {
		cfg.MaxNoProgressTurns = 6
	}
	if cfg.MaxRepeatedSignatures <= 0 {
		cfg.MaxRepeatedSignatures = 3
	}
	if cfg.MaxRepeatedSignatures > 6 {
		cfg.MaxRepeatedSignatures = 6
	}
	if cfg.AnalysisRequireSignals <= 0 {
		cfg.AnalysisRequireSignals = 2
	}
	if cfg.AnalysisRequireSignals > 4 {
		cfg.AnalysisRequireSignals = 4
	}

	state.TurnsUsed++

	assistantText := strings.TrimSpace(summary.AssistantText)
	prevNoProgress := state.NoProgressTurn
	digest := buildTurnProgressDigest(summary, assistantText)
	if digest != "" {
		if digest == strings.TrimSpace(state.LastDigest) {
			state.NoProgressTurn++
		} else {
			state.LastDigest = digest
			state.NoProgressTurn = 0
		}
	}

	signature := latestTaskSignature(summary)
	sigHit := 0
	if signature != "" {
		state.Signatures[signature] = state.Signatures[signature] + 1
		sigHit = state.Signatures[signature]
	}

	if signature != "" && sigHit > 1 && (!hasSubstantiveAssistantAnswer(assistantText) || looksInterimAssistantText(assistantText)) {
		minStreak := prevNoProgress + 1
		if state.NoProgressTurn < minStreak {
			state.NoProgressTurn = minStreak
		}
	}

	objective := strings.TrimSpace(state.Objective)
	if objective == "" {
		objective = strings.TrimSpace(userInput)
	}
	attemptEvidenceHints := extractEvidencePathHints(summary)
	if len(attemptEvidenceHints) > 0 {
		mergeTaskEvidenceHints(state, attemptEvidenceHints)
	}

	if sigHit >= cfg.MaxRepeatedSignatures {
		if state.NoProgressTurn >= cfg.MaxNoProgressTurns-1 || state.TurnsUsed >= cfg.MaxTurns {
			decision.FailRun = true
			decision.Reason = "loop_guard_repeated_signature"
			decision.Action = recoveryActionStopAfterRepeatedErr
			decision.FailureMessage = buildLoopGuardFailureMessage(signature, summary)
			return decision
		}
		decision.Continue = true
		decision.Reason = "loop_guard_switch_strategy"
		decision.Action = recoveryActionRetryAlternative
		decision.NextPrompt = buildLoopGuardRetryPrompt(objective, signature, summary, state)
		return decision
	}

	if summary.OutcomeNeedsFollowUpHint {
		if state.TurnsUsed >= cfg.MaxTurns {
			decision.FailRun = true
			decision.Reason = "outcome_followup_limit_reached"
			decision.Action = recoveryActionSynthesizeFinal
			decision.FailureMessage = "I still have pending follow-up work after tool calls, but the automatic loop reached its turn limit. Send a concrete next step and I will continue immediately."
			return decision
		}
		decision.Continue = true
		decision.Reason = "outcome_requires_followup"
		decision.Action = recoveryActionSynthesizeFinal
		decision.NextPrompt = buildTaskSynthesisPrompt(objective, summary, state)
		return decision
	}

	return decision
}

func latestTaskSignature(summary turnAttemptSummary) string {
	if n := len(summary.ToolCallSignatures); n > 0 {
		return strings.TrimSpace(summary.ToolCallSignatures[n-1])
	}
	if lf := latestToolFailure(summary); lf != nil {
		return buildFailureSignature(*lf)
	}
	return ""
}

func isAnalysisIntent(objective string, userInput string) bool {
	merged := strings.ToLower(strings.TrimSpace(objective + "\n" + userInput))
	if merged == "" {
		return false
	}
	analysisHints := []string{
		"analy", "scan", "review", "inspect", "project", "repository", "codebase",
		"分析", "排查", "项目", "代码", "结构", "目录", "评审", "深入",
	}
	return containsAny(merged, analysisHints)
}

func extractEvidencePathHints(summary turnAttemptSummary) []string {
	if len(summary.ToolCallSignatures) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(summary.ToolCallSignatures))
	for _, sig := range summary.ToolCallSignatures {
		parts := strings.Split(strings.TrimSpace(sig), "|")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			value := ""
			if strings.HasPrefix(part, "path=") {
				value = strings.TrimSpace(part[len("path="):])
			} else if strings.HasPrefix(part, "cwd=") {
				value = strings.TrimSpace(part[len("cwd="):])
			}
			if value == "" {
				continue
			}
			key := strings.ToLower(value)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, value)
			if len(out) >= 8 {
				return out
			}
		}
	}
	return out
}

func assistantMentionsEvidence(text string, pathHints []string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if normalized == "" {
		return false
	}
	if len(pathHints) == 0 {
		return containsAny(normalized, []string{"evidence", "findings", "readme", "package.json", "go.mod", "/"})
	}
	for _, hint := range pathHints {
		h := strings.ToLower(strings.TrimSpace(hint))
		if h == "" {
			continue
		}
		if strings.Contains(normalized, h) {
			return true
		}
		base := strings.ToLower(strings.TrimSpace(filepath.Base(h)))
		if base != "" && base != "." && base != "/" && strings.Contains(normalized, base) {
			return true
		}
	}
	return false
}

func buildTaskSynthesisPrompt(objective string, summary turnAttemptSummary, state *taskLoopState) string {
	lines := []string{
		"Task orchestrator: continue immediately.",
		fmt.Sprintf("Turn progress: %d turns used, no-progress streak %d.", state.TurnsUsed, state.NoProgressTurn),
		"Do not output another preamble.",
		"Use existing tool results first.",
		"If additional tools are needed, call them directly and then provide one complete user-facing answer.",
		"End this turn with a concrete conclusion, not a preparation sentence.",
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		lines = append(lines, "Objective: "+goal)
	}
	if summary.ToolCalls > 0 {
		lines = append(lines, fmt.Sprintf("Tool calls so far in last turn: %d (success %d, failures %d).", summary.ToolCalls, summary.ToolSuccesses, len(summary.ToolFailures)))
	}
	return strings.Join(lines, "\n")
}

func buildLoopGuardRetryPrompt(objective string, signature string, summary turnAttemptSummary, state *taskLoopState) string {
	lines := []string{
		"Task orchestrator loop guard: same tool pattern repeated with no progress.",
		fmt.Sprintf("Repeated signature: %s", strings.TrimSpace(signature)),
		fmt.Sprintf("Turn progress: %d turns used, no-progress streak %d.", state.TurnsUsed, state.NoProgressTurn),
		"You must switch strategy now. Do not repeat the same tool call signature.",
		"Pick a different evidence source, path, or tool strategy before continuing.",
		"After switching strategy, provide a concise progress update grounded in tool output.",
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		lines = append(lines, "Objective: "+goal)
	}
	if txt := strings.TrimSpace(summary.AssistantText); txt != "" {
		lines = append(lines, "Previous response preview: "+truncateRunes(txt, 220))
	}
	return strings.Join(lines, "\n")
}

func buildLoopGuardFailureMessage(signature string, summary turnAttemptSummary) string {
	toolNames := uniqueToolNames(summary.ToolCallNames)
	toolPart := ""
	if len(toolNames) > 0 {
		toolPart = " Recent repeated tools: " + strings.Join(toolNames, ", ") + "."
	}
	sig := strings.TrimSpace(signature)
	if sig != "" {
		sig = " Signature: " + sig + "."
	}
	return "I tried multiple automatic recovery strategies but got stuck in a repeated tool pattern." + toolPart + sig + " Please provide one concrete path or command to continue."
}

func mergeTaskEvidenceHints(state *taskLoopState, hints []string) {
	if state == nil || len(hints) == 0 {
		return
	}
	if state.EvidencePathSet == nil {
		state.EvidencePathSet = map[string]struct{}{}
	}
	for _, hint := range hints {
		trimmed := strings.TrimSpace(hint)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := state.EvidencePathSet[key]; ok {
			continue
		}
		state.EvidencePathSet[key] = struct{}{}
		state.EvidencePathHints = append(state.EvidencePathHints, trimmed)
		if len(state.EvidencePathHints) > 12 {
			drop := state.EvidencePathHints[0]
			delete(state.EvidencePathSet, strings.ToLower(strings.TrimSpace(drop)))
			state.EvidencePathHints = append([]string(nil), state.EvidencePathHints[1:]...)
		}
	}
}

func uniqueToolNames(names []string) []string {
	if len(names) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(names))
	for _, name := range names {
		n := strings.TrimSpace(strings.ToLower(name))
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func buildTaskStepSketch(objective string) []RunTaskStep {
	goal := strings.TrimSpace(objective)
	if goal == "" {
		return nil
	}
	if isAnalysisIntent(goal, goal) {
		return []RunTaskStep{
			{Title: "Scan workspace structure", Status: "pending"},
			{Title: "Inspect key files and configs", Status: "pending"},
			{Title: "Summarize findings with evidence", Status: "pending"},
		}
	}
	return []RunTaskStep{
		{Title: "Execute requested action", Status: "pending"},
		{Title: "Validate output", Status: "pending"},
		{Title: "Provide final answer", Status: "pending"},
	}
}

func truncateProgressDigest(text string, maxRunes int) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || maxRunes <= 0 {
		return ""
	}
	if utf8.RuneCountInString(trimmed) <= maxRunes {
		return trimmed
	}
	return string([]rune(trimmed)[:maxRunes]) + "..."
}
