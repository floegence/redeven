package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	autoThreadTitlePromptVersion = "thread_title_v1"
	autoThreadTitleMaxRunes      = 80
)

type autoThreadTitleDecision struct {
	Title  string
	Reason string
}

func buildAutoThreadTitleMessages(userInput string) []Message {
	system := strings.Join([]string{
		autoThreadTitlePromptVersion,
		"You generate concise collaborative thread titles for an on-device coding assistant.",
		"Return exactly one JSON object with keys: title, reason.",
		"title must summarize the user's primary intent, not quote the raw message verbatim.",
		"title must stay in the same language as the user text.",
		"title must be plain text, a single line, and no more than 80 Unicode characters.",
		"title must be specific enough for a history sidebar.",
		"title must not mention chat, thread, assistant, or tool names unless they are central to the request.",
		"title must not include secrets, credentials, or private values.",
		"reason must be a short snake_case phrase.",
		"Do not include markdown or extra text.",
	}, "\n")
	user := strings.Join([]string{
		"Return JSON only: output exactly one JSON object.",
		"",
		"Public user text:",
		strings.TrimSpace(userInput),
	}, "\n")
	return []Message{
		{Role: "system", Content: []ContentPart{{Type: "text", Text: system}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: user}}},
	}
}

func parseAutoThreadTitleDecision(raw string) (autoThreadTitleDecision, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return autoThreadTitleDecision{}, errors.New("empty auto title response")
	}

	if strings.HasPrefix(candidate, "```") {
		candidate = strings.TrimPrefix(candidate, "```json")
		candidate = strings.TrimPrefix(candidate, "```JSON")
		candidate = strings.TrimPrefix(candidate, "```")
		candidate = strings.TrimSuffix(candidate, "```")
		candidate = strings.TrimSpace(candidate)
	}

	type payload struct {
		Title  string `json:"title"`
		Reason string `json:"reason"`
	}

	parse := func(text string) (payload, error) {
		var out payload
		if err := json.Unmarshal([]byte(text), &out); err != nil {
			return payload{}, err
		}
		return out, nil
	}

	parsed, err := parse(candidate)
	if err != nil {
		embedded := extractFirstJSONObject(candidate)
		if embedded == "" {
			return autoThreadTitleDecision{}, fmt.Errorf("invalid auto title response: %w", err)
		}
		parsed, err = parse(embedded)
		if err != nil {
			return autoThreadTitleDecision{}, fmt.Errorf("invalid auto title JSON payload: %w", err)
		}
	}

	title := normalizeAutoThreadTitle(parsed.Title)
	if title == "" {
		return autoThreadTitleDecision{}, errors.New("empty auto title")
	}

	return autoThreadTitleDecision{
		Title:  title,
		Reason: normalizeIntentReason(parsed.Reason),
	}, nil
}

func normalizeAutoThreadTitle(raw string) string {
	title := strings.TrimSpace(raw)
	if title == "" {
		return ""
	}
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.ReplaceAll(title, "\r", " ")
	title = strings.Join(strings.Fields(title), " ")
	title = strings.Trim(title, "\"'` ")
	title = truncateAutoThreadTitle(title, autoThreadTitleMaxRunes)
	return strings.TrimSpace(title)
}

func truncateAutoThreadTitle(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return strings.TrimSpace(string(runes[:maxRunes]))
}

func (s *Service) initStructuredOutputProvider(resolved resolvedRunModel) (Provider, string, error) {
	if s == nil {
		return nil, "", errors.New("nil service")
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.Provider.Type))
	switch providerType {
	case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen", "openai_compatible":
	default:
		return nil, "", fmt.Errorf("unsupported provider type %q", strings.TrimSpace(resolved.Provider.Type))
	}
	if s.resolveProviderKey == nil {
		return nil, "", errors.New("missing provider key resolver")
	}
	apiKey, ok, err := s.resolveProviderKey(resolved.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("resolve provider key failed: %w", err)
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		return nil, "", fmt.Errorf("missing api key for provider %q", resolved.ProviderID)
	}
	adapter, err := newProviderAdapter(providerType, strings.TrimSpace(resolved.Provider.BaseURL), strings.TrimSpace(apiKey), resolved.Provider.StrictToolSchema)
	if err != nil {
		return nil, "", fmt.Errorf("init provider adapter failed: %w", err)
	}
	responseFormat := "json_object"
	switch providerType {
	case "openai_compatible", "chatglm", "deepseek", "qwen":
		// Some OpenAI-compatible gateways return empty/incomplete outputs under forced
		// json_object mode. Keep prompt-level JSON constraints and parse the text payload.
		responseFormat = ""
	}
	return adapter, responseFormat, nil
}

func (s *Service) generateAutoThreadTitleByModel(ctx context.Context, resolved resolvedRunModel, userInput string) (autoThreadTitleDecision, error) {
	if s == nil {
		return autoThreadTitleDecision{}, errors.New("nil service")
	}
	adapter, responseFormat, err := s.initStructuredOutputProvider(resolved)
	if err != nil {
		return autoThreadTitleDecision{}, err
	}

	titleCtx := ctx
	cancel := func() {}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		titleCtx, cancel = context.WithTimeout(ctx, 12*time.Second)
	}
	defer cancel()

	result, err := adapter.StreamTurn(titleCtx, TurnRequest{
		Model:            strings.TrimSpace(resolved.ModelName),
		Messages:         buildAutoThreadTitleMessages(userInput),
		Budgets:          TurnBudgets{MaxSteps: 1, MaxOutputToken: 128},
		ModeFlags:        ModeFlags{Mode: config.AIModePlan},
		ProviderControls: ProviderControls{ResponseFormat: responseFormat},
	}, nil)
	if err != nil {
		return autoThreadTitleDecision{}, err
	}
	return parseAutoThreadTitleDecision(result.Text)
}

func (s *Service) scheduleAutoThreadTitle(meta *session.Meta, threadID string, input effectiveCurrentUserInput) {
	if s == nil || meta == nil {
		return
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	messageID := strings.TrimSpace(input.MessageID)
	publicText := strings.TrimSpace(input.PublicText)
	if endpointID == "" || threadID == "" {
		return
	}
	if publicText == "" {
		if s.log != nil {
			s.log.Info("thread auto title skipped",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"reason", "empty_public_text",
			)
		}
		return
	}
	userID := strings.TrimSpace(meta.UserPublicID)
	userEmail := strings.TrimSpace(meta.UserEmail)
	go s.applyAutoThreadTitle(context.Background(), endpointID, threadID, messageID, publicText, userID, userEmail)
}

func (s *Service) applyAutoThreadTitle(ctx context.Context, endpointID string, threadID string, messageID string, publicText string, updatedByID string, updatedByEmail string) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	messageID = strings.TrimSpace(messageID)
	publicText = strings.TrimSpace(publicText)
	if endpointID == "" || threadID == "" || publicText == "" {
		return
	}

	opCtx := ctx
	cancel := func() {}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		opCtx, cancel = context.WithTimeout(ctx, 20*time.Second)
	}
	defer cancel()

	s.mu.Lock()
	db := s.threadsDB
	cfg := s.cfg
	persistTO := s.persistOpTO
	logger := s.log
	s.mu.Unlock()
	if db == nil || cfg == nil {
		return
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	loadCtx, loadCancel := context.WithTimeout(opCtx, persistTO)
	th, err := db.GetThread(loadCtx, endpointID, threadID)
	loadCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title load failed",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"error", err,
			)
		}
		return
	}
	if th == nil {
		return
	}
	if strings.TrimSpace(th.Title) != "" {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"reason", "title_already_present",
				"title_source", strings.TrimSpace(th.TitleSource),
			)
		}
		return
	}
	if strings.TrimSpace(th.TitleSource) == threadstore.ThreadTitleSourceUser {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"reason", "user_title_locked",
			)
		}
		return
	}

	resolved, err := s.resolveRunModel(opCtx, cfg, "", strings.TrimSpace(th.ModelID), th.ModelLocked, nil)
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title resolve model failed",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"error", err,
			)
		}
		return
	}
	decision, err := s.generateAutoThreadTitleByModel(opCtx, resolved, publicText)
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title generation failed",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"error", err,
			)
		}
		return
	}

	generatedAtUnixMs := time.Now().UnixMilli()
	saveCtx, saveCancel := context.WithTimeout(opCtx, persistTO)
	updated, err := db.SetAutoThreadTitle(
		saveCtx,
		endpointID,
		threadID,
		decision.Title,
		messageID,
		resolved.ID,
		autoThreadTitlePromptVersion,
		generatedAtUnixMs,
		updatedByID,
		updatedByEmail,
	)
	saveCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title persist failed",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"error", err,
			)
		}
		return
	}
	if !updated {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", endpointID,
				"thread_id", threadID,
				"message_id", messageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"reason", "store_guard_rejected",
			)
		}
		return
	}

	if logger != nil {
		logger.Info("thread auto title applied",
			"endpoint_id", endpointID,
			"thread_id", threadID,
			"message_id", messageID,
			"model_id", resolved.ID,
			"prompt_version", autoThreadTitlePromptVersion,
			"title_source", threadstore.ThreadTitleSourceAuto,
			"decision_reason", decision.Reason,
		)
	}
	s.broadcastThreadSummary(endpointID, threadID)
}
