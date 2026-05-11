package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

const (
	autoThreadTitlePromptVersion = "thread_title_v1"
	autoThreadTitleMaxRunes      = 80
	autoThreadTitleMaxOutputLow  = 128
	autoThreadTitleMaxOutputHigh = 4096
	autoThreadTitleMaxAttempts   = 3
	autoThreadTitleRecoveryLimit = 128
)

type autoThreadTitleDecision struct {
	Title  string
	Reason string
}

type autoThreadTitleGenerationAttempt struct {
	MaxOutputTokens int
}

type autoThreadTitleRequest struct {
	EndpointID             string
	ThreadID               string
	MessageID              string
	MessageRowID           int64
	MessageCreatedAtUnixMs int64
	PublicText             string
	UpdatedByID            string
	UpdatedByEmail         string
	Attempts               int
	NextAttemptAt          time.Time
}

type autoThreadTitleApplyStatus string

const (
	autoThreadTitleApplyStatusApplied  autoThreadTitleApplyStatus = "applied"
	autoThreadTitleApplyStatusRetry    autoThreadTitleApplyStatus = "retry"
	autoThreadTitleApplyStatusTerminal autoThreadTitleApplyStatus = "terminal"
)

type autoThreadTitleApplyResult struct {
	Status autoThreadTitleApplyStatus
	Reason string
	Err    error
}

type autoThreadTitleCoordinator struct {
	svc *Service

	mu       sync.Mutex
	pending  map[string]autoThreadTitleRequest
	inFlight map[string]autoThreadTitleRequest

	retryDelay func(attempt int) time.Duration

	wakeCh    chan struct{}
	stopCh    chan struct{}
	doneCh    chan struct{}
	closeOnce sync.Once
	workerWG  sync.WaitGroup
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
	case "openai_compatible", "moonshot", "chatglm", "deepseek", "qwen":
		// Some OpenAI-compatible gateways return empty/incomplete outputs under forced
		// json_object mode. Keep prompt-level JSON constraints and parse the text payload.
		//
		// Moonshot/Kimi streaming classifiers can also emit an empty visible content stream
		// under forced json_object mode even when the non-streaming endpoint succeeds.
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

	attempts := []autoThreadTitleGenerationAttempt{
		{MaxOutputTokens: autoThreadTitleMaxOutputLow},
		{MaxOutputTokens: autoThreadTitleMaxOutputHigh},
	}
	var lastErr error
	for idx, attempt := range attempts {
		result, runErr := s.runAutoThreadTitleAttempt(titleCtx, adapter, responseFormat, resolved, userInput, attempt)
		if runErr != nil {
			return autoThreadTitleDecision{}, runErr
		}
		decision, parseErr := parseAutoThreadTitleDecision(result.Text)
		if parseErr == nil {
			return decision, nil
		}
		lastErr = parseErr
		if idx >= len(attempts)-1 || !shouldRetryAutoThreadTitleWithExpandedBudget(result, attempt) {
			break
		}
	}
	if lastErr == nil {
		lastErr = errors.New("auto title generation returned no parseable text")
	}
	return autoThreadTitleDecision{}, lastErr
}

func (s *Service) runAutoThreadTitleAttempt(
	ctx context.Context,
	adapter Provider,
	responseFormat string,
	resolved resolvedRunModel,
	userInput string,
	attempt autoThreadTitleGenerationAttempt,
) (TurnResult, error) {
	if s == nil {
		return TurnResult{}, errors.New("nil service")
	}
	if adapter == nil {
		return TurnResult{}, errors.New("missing auto title provider")
	}

	maxOutputTokens := attempt.MaxOutputTokens
	if maxOutputTokens <= 0 {
		maxOutputTokens = autoThreadTitleMaxOutputLow
	}

	return adapter.StreamTurn(ctx, TurnRequest{
		Model:            strings.TrimSpace(resolved.ModelName),
		Messages:         buildAutoThreadTitleMessages(userInput),
		Budgets:          TurnBudgets{MaxSteps: 1, MaxOutputToken: maxOutputTokens},
		ModeFlags:        ModeFlags{Mode: config.AIModePlan},
		ProviderControls: ProviderControls{ResponseFormat: responseFormat},
	}, nil)
}

func shouldRetryAutoThreadTitleWithExpandedBudget(result TurnResult, attempt autoThreadTitleGenerationAttempt) bool {
	if attempt.MaxOutputTokens >= autoThreadTitleMaxOutputHigh {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(result.FinishReason), "length") {
		return true
	}
	return strings.TrimSpace(result.Text) == "" && strings.TrimSpace(result.Reasoning) != ""
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

	s.mu.Lock()
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	if coordinator == nil {
		return
	}
	coordinator.Schedule(autoThreadTitleRequest{
		EndpointID:             endpointID,
		ThreadID:               threadID,
		MessageID:              messageID,
		MessageRowID:           input.MessageRowID,
		MessageCreatedAtUnixMs: input.MessageCreatedAtUnixMs,
		PublicText:             publicText,
		UpdatedByID:            strings.TrimSpace(meta.UserPublicID),
		UpdatedByEmail:         strings.TrimSpace(meta.UserEmail),
	})
}

func (s *Service) applyAutoThreadTitle(ctx context.Context, endpointID string, threadID string, messageID string, publicText string, updatedByID string, updatedByEmail string) {
	_ = s.applyAutoThreadTitleOnce(ctx, autoThreadTitleRequest{
		EndpointID:     endpointID,
		ThreadID:       threadID,
		MessageID:      messageID,
		PublicText:     publicText,
		UpdatedByID:    updatedByID,
		UpdatedByEmail: updatedByEmail,
	})
}

func newAutoThreadTitleCoordinator(svc *Service) *autoThreadTitleCoordinator {
	if svc == nil {
		return nil
	}
	c := &autoThreadTitleCoordinator{
		svc:      svc,
		pending:  make(map[string]autoThreadTitleRequest),
		inFlight: make(map[string]autoThreadTitleRequest),

		retryDelay: autoThreadTitleRetryDelay,
		wakeCh:     make(chan struct{}, 1),
		stopCh:     make(chan struct{}),
		doneCh:     make(chan struct{}),
	}
	go c.loop()
	return c
}

func (c *autoThreadTitleCoordinator) Close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() {
		close(c.stopCh)
	})
	<-c.doneCh
	c.workerWG.Wait()
}

func (c *autoThreadTitleCoordinator) Wake() {
	if c == nil {
		return
	}
	select {
	case c.wakeCh <- struct{}{}:
	default:
	}
}

func (c *autoThreadTitleCoordinator) Schedule(req autoThreadTitleRequest) {
	if c == nil {
		return
	}
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.MessageID = strings.TrimSpace(req.MessageID)
	req.PublicText = strings.TrimSpace(req.PublicText)
	req.UpdatedByID = strings.TrimSpace(req.UpdatedByID)
	req.UpdatedByEmail = strings.TrimSpace(req.UpdatedByEmail)
	if req.EndpointID == "" || req.ThreadID == "" || req.PublicText == "" {
		return
	}
	req.Attempts = 0
	req.NextAttemptAt = time.Now()

	key := runThreadKey(req.EndpointID, req.ThreadID)
	if key == "" {
		return
	}

	c.mu.Lock()
	if current, ok := c.inFlight[key]; ok {
		switch {
		case autoThreadTitleRequestsMatch(current, req):
			c.mu.Unlock()
			return
		case autoThreadTitleRequestIsOlder(req, current):
			c.mu.Unlock()
			return
		}
	}
	current, ok := c.pending[key]
	if ok {
		if autoThreadTitleRequestsMatch(current, req) || autoThreadTitleRequestIsOlder(req, current) {
			c.mu.Unlock()
			return
		}
	}
	c.pending[key] = req
	c.mu.Unlock()
	c.Wake()
}

func (c *autoThreadTitleCoordinator) ScheduleRecovery() {
	if c == nil {
		return
	}
	c.workerWG.Add(1)
	go func() {
		defer c.workerWG.Done()
		c.recoverPending()
	}()
}

func (c *autoThreadTitleCoordinator) recoverPending() {
	if c == nil || c.svc == nil {
		return
	}

	svc := c.svc
	svc.mu.Lock()
	db := svc.threadsDB
	persistTO := svc.persistOpTO
	logger := svc.log
	svc.mu.Unlock()
	if db == nil {
		return
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*persistTO)
	defer cancel()

	candidates, err := db.ListAutoThreadTitleCandidates(ctx, autoThreadTitleRecoveryLimit)
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title recovery scan failed", "error", err)
		}
		return
	}

	for _, candidate := range candidates {
		select {
		case <-c.stopCh:
			return
		default:
		}
		req, ok, recoverErr := svc.recoverAutoThreadTitleRequest(ctx, candidate.EndpointID, candidate.ThreadID)
		if recoverErr != nil {
			if logger != nil {
				logger.Warn("thread auto title recovery candidate failed",
					"endpoint_id", candidate.EndpointID,
					"thread_id", candidate.ThreadID,
					"error", recoverErr,
				)
			}
			continue
		}
		if !ok {
			continue
		}
		c.Schedule(req)
	}
}

func (c *autoThreadTitleCoordinator) loop() {
	defer close(c.doneCh)

	for {
		req, wait, ok := c.nextRequest()
		if !ok {
			select {
			case <-c.stopCh:
				return
			case <-c.wakeCh:
				continue
			}
		}

		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-c.stopCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				return
			case <-c.wakeCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				continue
			case <-timer.C:
				continue
			}
		}

		result := c.svc.applyAutoThreadTitleOnce(context.Background(), req)
		c.handleResult(req, result)
	}
}

func (c *autoThreadTitleCoordinator) nextRequest() (autoThreadTitleRequest, time.Duration, bool) {
	if c == nil {
		return autoThreadTitleRequest{}, 0, false
	}

	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.pending) == 0 {
		return autoThreadTitleRequest{}, 0, false
	}

	var selected autoThreadTitleRequest
	selectedKey := ""
	first := true
	for key, req := range c.pending {
		if req.NextAttemptAt.IsZero() {
			req.NextAttemptAt = now
		}
		if first || req.NextAttemptAt.Before(selected.NextAttemptAt) {
			selected = req
			selectedKey = key
			first = false
		}
	}
	if first {
		return autoThreadTitleRequest{}, 0, false
	}
	if !selected.NextAttemptAt.After(now) {
		delete(c.pending, selectedKey)
		if c.inFlight == nil {
			c.inFlight = make(map[string]autoThreadTitleRequest)
		}
		c.inFlight[selectedKey] = selected
		return selected, 0, true
	}
	return selected, selected.NextAttemptAt.Sub(now), true
}

func (c *autoThreadTitleCoordinator) handleResult(req autoThreadTitleRequest, result autoThreadTitleApplyResult) {
	if c == nil {
		return
	}

	key := runThreadKey(req.EndpointID, req.ThreadID)
	if key == "" {
		return
	}

	switch result.Status {
	case autoThreadTitleApplyStatusRetry:
		attempt := req.Attempts + 1
		delayFn := c.retryDelay
		if delayFn == nil {
			delayFn = autoThreadTitleRetryDelay
		}
		delay := delayFn(attempt)
		scheduled := false
		shouldFallback := false
		c.mu.Lock()
		active, activeOK := c.inFlight[key]
		if activeOK && autoThreadTitleRequestsMatch(active, req) {
			delete(c.inFlight, key)
			_, hasNewerPending := c.pending[key]
			if !hasNewerPending {
				if attempt >= autoThreadTitleMaxAttempts {
					shouldFallback = true
				} else {
					current := req
					current.Attempts = attempt
					current.NextAttemptAt = time.Now().Add(delay)
					c.pending[key] = current
					scheduled = true
				}
			}
		}
		c.mu.Unlock()

		if shouldFallback && c.svc != nil {
			_ = c.svc.applyFallbackThreadTitleOnce(context.Background(), req, attempt)
			return
		}
		if scheduled && c.svc != nil && c.svc.log != nil {
			c.svc.log.Info("thread auto title retry scheduled",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempt,
				"retry_in_ms", delay.Milliseconds(),
				"reason", result.Reason,
				"error", result.Err,
			)
		}
	default:
		c.mu.Lock()
		current, ok := c.inFlight[key]
		if ok && autoThreadTitleRequestsMatch(current, req) {
			delete(c.inFlight, key)
		}
		c.mu.Unlock()
	}
}

func autoThreadTitleRequestsMatch(current autoThreadTitleRequest, req autoThreadTitleRequest) bool {
	return current.EndpointID == req.EndpointID &&
		current.ThreadID == req.ThreadID &&
		current.MessageID == req.MessageID &&
		current.MessageRowID == req.MessageRowID &&
		current.MessageCreatedAtUnixMs == req.MessageCreatedAtUnixMs &&
		current.PublicText == req.PublicText
}

func autoThreadTitleRequestIsOlder(candidate autoThreadTitleRequest, current autoThreadTitleRequest) bool {
	if candidate.MessageRowID > 0 && current.MessageRowID > 0 && candidate.MessageRowID != current.MessageRowID {
		return candidate.MessageRowID < current.MessageRowID
	}
	if candidate.MessageCreatedAtUnixMs > 0 && current.MessageCreatedAtUnixMs > 0 && candidate.MessageCreatedAtUnixMs != current.MessageCreatedAtUnixMs {
		return candidate.MessageCreatedAtUnixMs < current.MessageCreatedAtUnixMs
	}
	return false
}

func autoThreadTitleRetryDelay(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return 500 * time.Millisecond
	case attempt == 2:
		return 2 * time.Second
	case attempt == 3:
		return 5 * time.Second
	case attempt == 4:
		return 15 * time.Second
	default:
		return 30 * time.Second
	}
}

func canRegenerateFromFallbackTitle(th *threadstore.Thread, req autoThreadTitleRequest) bool {
	if th == nil {
		return false
	}
	if strings.TrimSpace(th.TitleSource) != threadstore.ThreadTitleSourceAutoFallback {
		return false
	}
	if strings.TrimSpace(th.Title) == "" {
		return false
	}
	return strings.TrimSpace(th.TitleInputMessageID) != "" && strings.TrimSpace(th.TitleInputMessageID) != strings.TrimSpace(req.MessageID)
}

func (s *Service) recoverAutoThreadTitleRequest(ctx context.Context, endpointID string, threadID string) (autoThreadTitleRequest, bool, error) {
	if s == nil {
		return autoThreadTitleRequest{}, false, nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return autoThreadTitleRequest{}, false, nil
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return autoThreadTitleRequest{}, false, nil
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	loadCtx, cancel := context.WithTimeout(ctx, persistTO)
	messages, err := db.ListRecentTranscriptMessages(loadCtx, endpointID, threadID, 24)
	cancel()
	if err != nil {
		return autoThreadTitleRequest{}, false, err
	}

	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if !strings.EqualFold(strings.TrimSpace(msg.Role), "user") {
			continue
		}
		publicText := strings.TrimSpace(msg.TextContent)
		if publicText == "" {
			continue
		}
		return autoThreadTitleRequest{
			EndpointID:             endpointID,
			ThreadID:               threadID,
			MessageID:              strings.TrimSpace(msg.MessageID),
			MessageRowID:           msg.ID,
			MessageCreatedAtUnixMs: msg.CreatedAtUnixMs,
			PublicText:             publicText,
			UpdatedByID:            strings.TrimSpace(msg.AuthorUserPublicID),
			UpdatedByEmail:         strings.TrimSpace(msg.AuthorUserEmail),
		}, true, nil
	}
	return autoThreadTitleRequest{}, false, nil
}

func (s *Service) applyAutoThreadTitleOnce(ctx context.Context, req autoThreadTitleRequest) autoThreadTitleApplyResult {
	if s == nil {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "nil_service"}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.MessageID = strings.TrimSpace(req.MessageID)
	req.PublicText = strings.TrimSpace(req.PublicText)
	req.UpdatedByID = strings.TrimSpace(req.UpdatedByID)
	req.UpdatedByEmail = strings.TrimSpace(req.UpdatedByEmail)
	if req.EndpointID == "" || req.ThreadID == "" || req.PublicText == "" {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "invalid_request"}
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
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusRetry, Reason: "service_not_ready"}
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	loadCtx, loadCancel := context.WithTimeout(opCtx, persistTO)
	th, err := db.GetThread(loadCtx, req.EndpointID, req.ThreadID)
	loadCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title load failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusRetry, Reason: "load_failed", Err: err}
	}
	if th == nil {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "missing_thread"}
	}
	if strings.TrimSpace(th.Title) != "" && !canRegenerateFromFallbackTitle(th, req) {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"reason", "title_already_present",
				"title_source", strings.TrimSpace(th.TitleSource),
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "title_already_present"}
	}
	if strings.TrimSpace(th.TitleSource) == threadstore.ThreadTitleSourceUser {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"reason", "user_title_locked",
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "user_title_locked"}
	}

	resolved, err := s.resolveRunModel(opCtx, cfg, "", strings.TrimSpace(th.ModelID), th.ModelLocked, nil)
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title resolve model failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusRetry, Reason: "resolve_model_failed", Err: err}
	}
	decision, err := s.generateAutoThreadTitleByModel(opCtx, resolved, req.PublicText)
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title generation failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusRetry, Reason: "generation_failed", Err: err}
	}

	generatedAtUnixMs := time.Now().UnixMilli()
	saveCtx, saveCancel := context.WithTimeout(opCtx, persistTO)
	updated, err := db.SetAutoThreadTitle(
		saveCtx,
		req.EndpointID,
		req.ThreadID,
		decision.Title,
		req.MessageID,
		resolved.ID,
		autoThreadTitlePromptVersion,
		generatedAtUnixMs,
		req.UpdatedByID,
		req.UpdatedByEmail,
	)
	saveCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title persist failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusRetry, Reason: "persist_failed", Err: err}
	}
	if !updated {
		if logger != nil {
			logger.Info("thread auto title skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"model_id", resolved.ID,
				"prompt_version", autoThreadTitlePromptVersion,
				"reason", "store_guard_rejected",
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "store_guard_rejected"}
	}

	if logger != nil {
		logger.Info("thread auto title applied",
			"endpoint_id", req.EndpointID,
			"thread_id", req.ThreadID,
			"message_id", req.MessageID,
			"model_id", resolved.ID,
			"prompt_version", autoThreadTitlePromptVersion,
			"title_source", threadstore.ThreadTitleSourceAuto,
			"decision_reason", decision.Reason,
		)
	}
	s.broadcastThreadSummary(req.EndpointID, req.ThreadID)
	return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusApplied, Reason: "applied"}
}

func (s *Service) applyFallbackThreadTitleOnce(ctx context.Context, req autoThreadTitleRequest, attempts int) autoThreadTitleApplyResult {
	if s == nil {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "nil_service"}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.MessageID = strings.TrimSpace(req.MessageID)
	req.UpdatedByID = strings.TrimSpace(req.UpdatedByID)
	req.UpdatedByEmail = strings.TrimSpace(req.UpdatedByEmail)
	if req.EndpointID == "" || req.ThreadID == "" {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "invalid_request"}
	}

	opCtx := ctx
	cancel := func() {}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		opCtx, cancel = context.WithTimeout(ctx, 20*time.Second)
	}
	defer cancel()

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	logger := s.log
	s.mu.Unlock()
	if db == nil {
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "service_not_ready"}
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	loadCtx, loadCancel := context.WithTimeout(opCtx, persistTO)
	firstUser, err := db.GetFirstUserThreadMessage(loadCtx, req.EndpointID, req.ThreadID)
	loadCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title fallback load failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempts,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "fallback_load_failed", Err: err}
	}
	if firstUser == nil {
		if logger != nil {
			logger.Info("thread auto title fallback skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempts,
				"reason", "fallback_missing_first_user_message",
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "fallback_missing_first_user_message"}
	}

	title := normalizeAutoThreadTitle(firstUser.TextContent)
	if title == "" {
		if logger != nil {
			logger.Info("thread auto title fallback skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempts,
				"reason", "fallback_empty_first_user_message",
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "fallback_empty_first_user_message"}
	}

	generatedAtUnixMs := time.Now().UnixMilli()
	saveCtx, saveCancel := context.WithTimeout(opCtx, persistTO)
	updated, err := db.SetFallbackThreadTitle(
		saveCtx,
		req.EndpointID,
		req.ThreadID,
		title,
		strings.TrimSpace(firstUser.MessageID),
		generatedAtUnixMs,
		req.UpdatedByID,
		req.UpdatedByEmail,
	)
	saveCancel()
	if err != nil {
		if logger != nil {
			logger.Warn("thread auto title fallback persist failed",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempts,
				"error", err,
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "fallback_persist_failed", Err: err}
	}
	if !updated {
		if logger != nil {
			logger.Info("thread auto title fallback skipped",
				"endpoint_id", req.EndpointID,
				"thread_id", req.ThreadID,
				"message_id", req.MessageID,
				"attempt", attempts,
				"reason", "fallback_guard_rejected",
			)
		}
		return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusTerminal, Reason: "fallback_guard_rejected"}
	}

	if logger != nil {
		logger.Info("thread auto title fallback applied",
			"endpoint_id", req.EndpointID,
			"thread_id", req.ThreadID,
			"message_id", req.MessageID,
			"attempt", attempts,
			"title_source", threadstore.ThreadTitleSourceAutoFallback,
			"title_input_message_id", strings.TrimSpace(firstUser.MessageID),
		)
	}
	s.broadcastThreadSummary(req.EndpointID, req.ThreadID)
	return autoThreadTitleApplyResult{Status: autoThreadTitleApplyStatusApplied, Reason: "fallback_applied"}
}
