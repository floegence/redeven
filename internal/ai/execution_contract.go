package ai

import "strings"

const (
	RunExecutionContractDirectReply     = "direct_reply"
	RunExecutionContractHybridFirstTurn = "hybrid_first_turn"
	RunExecutionContractAgenticLoop     = "agentic_loop"
)

func normalizeExecutionContractValue(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case RunExecutionContractDirectReply:
		return RunExecutionContractDirectReply
	case RunExecutionContractHybridFirstTurn:
		return RunExecutionContractHybridFirstTurn
	case RunExecutionContractAgenticLoop:
		return RunExecutionContractAgenticLoop
	default:
		return ""
	}
}

func defaultExecutionContractForPolicy(intent string, objectiveMode string, complexity string, todoPolicy string, interaction interactionContract) string {
	intent = normalizeRunIntent(intent)
	if intent == RunIntentSocial || intent == RunIntentCreative {
		return RunExecutionContractDirectReply
	}
	if normalizeObjectiveMode(objectiveMode) == RunObjectiveModeContinue {
		return RunExecutionContractAgenticLoop
	}
	if normalizeInteractionContract(interaction).Enabled {
		return RunExecutionContractAgenticLoop
	}
	if normalizeTaskComplexity(complexity) == TaskComplexityComplex {
		return RunExecutionContractAgenticLoop
	}
	if normalizeTodoPolicy(todoPolicy) == TodoPolicyRequired {
		return RunExecutionContractAgenticLoop
	}
	return RunExecutionContractHybridFirstTurn
}

func normalizeExecutionContract(raw string, intent string, objectiveMode string, complexity string, todoPolicy string, interaction interactionContract) string {
	intent = normalizeRunIntent(intent)
	if intent == RunIntentSocial || intent == RunIntentCreative {
		return RunExecutionContractDirectReply
	}

	normalized := normalizeExecutionContractValue(raw)
	if normalized == "" {
		normalized = defaultExecutionContractForPolicy(intent, objectiveMode, complexity, todoPolicy, interaction)
	}

	if normalizeObjectiveMode(objectiveMode) == RunObjectiveModeContinue {
		return RunExecutionContractAgenticLoop
	}
	if normalizeInteractionContract(interaction).Enabled {
		return RunExecutionContractAgenticLoop
	}
	if normalizeTaskComplexity(complexity) == TaskComplexityComplex {
		return RunExecutionContractAgenticLoop
	}
	if normalizeTodoPolicy(todoPolicy) == TodoPolicyRequired {
		return RunExecutionContractAgenticLoop
	}
	if normalized == RunExecutionContractDirectReply {
		return RunExecutionContractHybridFirstTurn
	}
	return normalized
}
