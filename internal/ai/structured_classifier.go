package ai

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/floegence/redeven-agent/internal/config"
)

const (
	structuredClassifierDefaultMaxOutputTokens = 1024

	structuredClassifierRunPolicyToolName           = "emit_run_policy"
	structuredClassifierInteractionContractToolName = "emit_interaction_contract"
	structuredClassifierAskUserPolicyToolName       = "emit_ask_user_policy"
)

func structuredClassifierToolDef(name string, description string, schema map[string]any) ToolDef {
	raw, err := json.Marshal(schema)
	if err != nil {
		raw = json.RawMessage(`{"type":"object"}`)
	}
	return ToolDef{
		Name:        strings.TrimSpace(name),
		Description: strings.TrimSpace(description),
		InputSchema: raw,
	}
}

func structuredClassifierToolPayload(result TurnResult, toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return ""
	}
	for _, call := range result.ToolCalls {
		if !strings.EqualFold(strings.TrimSpace(call.Name), toolName) {
			continue
		}
		if len(call.Args) == 0 {
			continue
		}
		raw, err := json.Marshal(call.Args)
		if err != nil {
			continue
		}
		return strings.TrimSpace(string(raw))
	}
	return ""
}

func structuredClassifierResultPayload(result TurnResult, toolName string) string {
	if payload := structuredClassifierToolPayload(result, toolName); payload != "" {
		return payload
	}
	if text := strings.TrimSpace(result.Text); text != "" {
		return text
	}
	return strings.TrimSpace(result.Reasoning)
}

func runStructuredClassifierTurn(ctx context.Context, provider Provider, modelName string, messages []Message, tool ToolDef, maxOutputTokens int) (TurnResult, error) {
	if maxOutputTokens <= 0 {
		maxOutputTokens = structuredClassifierDefaultMaxOutputTokens
	}
	return runProviderTurn(ctx, provider, TurnRequest{
		Model:     strings.TrimSpace(modelName),
		Messages:  messages,
		Tools:     []ToolDef{tool},
		Budgets:   TurnBudgets{MaxSteps: 1, MaxOutputToken: maxOutputTokens},
		ModeFlags: ModeFlags{Mode: config.AIModePlan},
	}, nil)
}
