package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

func newProductRequestID(prefix string) (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.TrimSpace(prefix) + base64.RawURLEncoding.EncodeToString(b), nil
}

func threadPermissionType(th *threadstore.ThreadSettings) (FlowerPermissionType, error) {
	if th == nil {
		return "", errors.New("thread permission settings are missing")
	}
	raw := strings.TrimSpace(th.PermissionType)
	if raw == "" {
		return "", errors.New("thread permission setting is empty")
	}
	permissionType, err := parsePermissionType(raw)
	if err != nil {
		return "", fmt.Errorf("parse thread permission setting: %w", err)
	}
	return permissionType, nil
}

func threadWorkingDir(th *threadstore.ThreadSettings) (string, error) {
	if th == nil {
		return "", errors.New("thread working directory settings are missing")
	}
	workingDir := strings.TrimSpace(th.WorkingDir)
	if workingDir == "" {
		return "", errors.New("thread working directory setting is empty")
	}
	return workingDir, nil
}

func (s *Service) threadViewFromRecord(ctx context.Context, th *threadstore.ThreadSettings, current flruntime.ThreadView, summary *flruntime.ThreadSummary) (ThreadView, error) {
	if th == nil {
		return ThreadView{}, errors.New("thread settings are missing")
	}
	permissionType, err := threadPermissionType(th)
	if err != nil {
		return ThreadView{}, err
	}
	runStatus, runErrorCode, runError := threadViewRunState(current)
	activeRunID := ""
	if current.Activity == flruntime.ThreadActivityActive {
		activeRunID = strings.TrimSpace(current.TurnID.String())
	}
	lastMessageAt, lastMessagePreview := currentThreadPreview(current)
	waitingPrompt := requestUserInputPromptFromCurrent(current)
	workingDir, err := threadWorkingDir(th)
	if err != nil {
		return ThreadView{}, err
	}
	capability, _, _, err := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
	if err != nil {
		return ThreadView{}, err
	}
	reasoningSelection, err := parseStoredReasoningSelection(th.ReasoningSelectionJSON)
	if err != nil {
		return ThreadView{}, err
	}
	if err := config.ValidateAIReasoningSelection(capability, reasoningSelection); err != nil {
		return ThreadView{}, reasoningSelectionError(strings.TrimSpace(th.ModelID), err)
	}
	createdAt := th.SettingsCreatedAtUnixMs
	updatedAt := th.SettingsUpdatedAtUnixMs
	title := ""
	titleStatus := ""
	if summary != nil {
		title = strings.TrimSpace(summary.Title)
		titleStatus = strings.TrimSpace(string(summary.TitleStatus))
		if !summary.CreatedAt.IsZero() {
			createdAt = summary.CreatedAt.UnixMilli()
		}
		if !summary.UpdatedAt.IsZero() {
			updatedAt = summary.UpdatedAt.UnixMilli()
		}
		if lastMessageAt == 0 && lastMessagePreview != "" {
			lastMessageAt = updatedAt
		}
	}
	view := ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               title,
		TitleStatus:         titleStatus,
		ModelID:             strings.TrimSpace(th.ModelID),
		PermissionType:      permissionTypeString(permissionType),
		WorkingDir:          workingDir,
		QueuedTurnCount:     len(current.Queue),
		RunStatus:           runStatus,
		RunUpdatedAtUnixMs:  updatedAt,
		RunErrorCode:        runErrorCode,
		RunError:            runError,
		WaitingPrompt:       waitingPrompt,
		ActiveRunID:         activeRunID,
		ReasoningSelection:  reasoningSelection,
		ReasoningCapability: capability,
		PinnedAtUnixMs:      th.PinnedAtUnixMs,
		CreatedAtUnixMs:     createdAt,
		UpdatedAtUnixMs:     updatedAt,
		LastMessageAtUnixMs: lastMessageAt,
		LastMessagePreview:  lastMessagePreview,
		FlowerActivity: FlowerThreadReadSnapshot{
			ActivityRevision:    max(updatedAt, lastMessageAt),
			LastMessageAtUnixMs: lastMessageAt,
			ActivitySignature:   fmt.Sprintf("%s:%d:%s:%d:%d", strings.TrimSpace(th.ThreadID), max(updatedAt, lastMessageAt), current.Activity, current.Attention.ApprovalCount, current.Attention.InputCount),
			WaitingPromptID:     waitingPromptID(waitingPrompt),
		},
	}
	children, err := s.listFlowerSubagentsForParent(ctx, current.ThreadID)
	if err != nil {
		return ThreadView{}, err
	}
	view.Subagents = children
	return view, nil
}

func (s *Service) readCanonicalThreadState(ctx context.Context, threadID string) (flruntime.ThreadView, error) {
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	return typed.View(ctxOrBackground(ctx), identity.ThreadID(strings.TrimSpace(threadID)))
}

func (s *Service) lockCanonicalThreadSettingsMutation(ctx context.Context, endpointID string, threadID string) (*threadstore.Store, *threadstore.ThreadSettings, func(), error) {
	if s == nil {
		return nil, nil, nil, errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, nil, nil, errors.New("invalid thread identity")
	}
	unlock := func() {}
	fail := func(err error) (*threadstore.Store, *threadstore.ThreadSettings, func(), error) {
		unlock()
		return nil, nil, nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return fail(errors.New("threads store not ready"))
	}
	if err := db.RequireThreadSettingsWritable(ctxOrBackground(ctx), endpointID, threadID); err != nil {
		return fail(err)
	}
	settings, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return fail(err)
	}
	if settings == nil {
		return fail(sql.ErrNoRows)
	}
	if _, err := s.readCanonicalThreadState(ctxOrBackground(ctx), threadID); err != nil {
		return fail(err)
	}
	return db, settings, unlock, nil
}

func threadViewRunState(current flruntime.ThreadView) (string, string, string) {
	hasInput := false
	hasApproval := false
	for _, interaction := range current.Interactions {
		if interaction.Resolved {
			continue
		}
		hasInput = hasInput || interaction.Kind == flruntime.ThreadInteractionInput
		hasApproval = hasApproval || interaction.Kind == flruntime.ThreadInteractionApproval || interaction.Kind == flruntime.ThreadInteractionEffectRetry
	}
	switch {
	case hasInput:
		return string(RunStateWaitingUser), "", ""
	case hasApproval:
		return string(RunStateWaitingApproval), "", ""
	case current.Activity == flruntime.ThreadActivityActive:
		return string(RunStateRunning), "", ""
	case current.LastOutcome == nil:
		return string(RunStateIdle), "", ""
	case *current.LastOutcome == flruntime.TurnOutcomeCompleted:
		return string(RunStateSuccess), "", ""
	case *current.LastOutcome == flruntime.TurnOutcomeCancelled:
		return string(RunStateCanceled), "", ""
	case *current.LastOutcome == flruntime.TurnOutcomeInterrupted:
		return string(RunStateFailed), "floret_turn_interrupted", strings.TrimSpace(current.Error)
	default:
		return string(RunStateFailed), "floret_turn_failed", strings.TrimSpace(current.Error)
	}
}

func currentThreadPreview(current flruntime.ThreadView) (int64, string) {
	for index := len(current.Items) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(current.Items[index].Text); text != "" {
			return 0, truncateRunes(text, 160)
		}
	}
	return 0, ""
}

func requestUserInputPromptFromCurrent(current flruntime.ThreadView) *RequestUserInputPrompt {
	for index := len(current.Interactions) - 1; index >= 0; index-- {
		interaction := current.Interactions[index]
		if interaction.Resolved || interaction.Kind != flruntime.ThreadInteractionInput || interaction.Input == nil {
			continue
		}
		questions := make([]RequestUserInputQuestion, 0, len(interaction.Input.Questions))
		containsSecret := false
		for _, source := range interaction.Input.Questions {
			choices := make([]RequestUserInputChoice, 0, len(source.Options))
			for _, option := range source.Options {
				option = strings.TrimSpace(option)
				if option != "" {
					choices = append(choices, RequestUserInputChoice{ChoiceID: option, Label: option, Kind: "choice"})
				}
			}
			mode := strings.TrimSpace(source.Kind)
			if mode == "" {
				mode = "write"
			}
			questions = append(questions, RequestUserInputQuestion{
				ID: source.ID, Header: source.Prompt, Question: source.Prompt, IsSecret: source.Secret,
				ResponseMode: mode, WriteLabel: source.WriteLabel, Choices: choices,
			})
			containsSecret = containsSecret || source.Secret
		}
		return &RequestUserInputPrompt{
			PromptID: interaction.ID, MessageID: interaction.TurnID.String(), ToolID: interaction.ToolCallID,
			ToolName: "ask_user", Questions: questions, PublicSummary: interaction.Input.Summary, ContainsSecret: containsSecret,
		}
	}
	return nil
}

func waitingPromptID(prompt *RequestUserInputPrompt) string {
	if prompt == nil {
		return ""
	}
	return strings.TrimSpace(prompt.PromptID)
}

func (s *Service) threadReasoningDefaults(ctx context.Context, modelID string) (config.AIReasoningCapability, config.AIReasoningSelection, bool, error) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || s == nil {
		return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false, nil
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if capability, selection, ok := modelReasoningDefaultsFromConfig(cfg, modelID); ok {
		return capability, selection, true, nil
	}
	if isDesktopModelSourceModelID(modelID) {
		model, ok, err := s.desktopModelSourceModel(ctx, modelID)
		if err != nil {
			return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false, err
		}
		if ok {
			capability := desktopModelSourceModelCapability(model).ReasoningCapability
			if capability.IsZero() {
				return capability, config.AIReasoningSelection{}, true, nil
			}
			if strings.TrimSpace(capability.DefaultLevel) != "" {
				return capability, config.AIReasoningSelection{Level: config.AIReasoningLevel(capability.DefaultLevel)}, true, nil
			}
			return capability, config.AIReasoningSelection{}, true, nil
		}
	}
	return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false, nil
}

func (s *Service) GetThread(ctx context.Context, meta *session.Meta, threadID string) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	th, err := db.GetThreadSettings(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, nil
	}
	current, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return nil, fmt.Errorf("read canonical Floret thread %s: %w", threadID, err)
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	summaries, err := typed.List(ctxOrBackground(ctx), flruntime.ThreadScope{})
	if err != nil {
		return nil, err
	}
	var summary *flruntime.ThreadSummary
	for index := range summaries {
		if summaries[index].ID == current.ThreadID {
			summary = &summaries[index]
			break
		}
	}
	if summary == nil {
		return nil, fmt.Errorf("product thread settings reference missing canonical Floret root %q", threadID)
	}
	view, err := s.threadViewFromRecord(ctx, th, current, summary)
	if err != nil {
		return nil, err
	}
	view.QueuedTurns = make([]QueuedTurnView, 0, len(current.Queue))
	for _, queued := range current.Queue {
		view.QueuedTurns = append(view.QueuedTurns, queuedInputView(queued))
	}
	applyThreadRuntimeSummary(&view, current)
	return &view, nil
}

// GetFlowerThreadDetail is the single detail read boundary for Flower. The
// product thread metadata remains owned by Redeven while Floret supplies the
// renderable current view; callers must replace both fields together.
func (s *Service) GetFlowerThreadDetail(ctx context.Context, meta *session.Meta, threadID string) (*FlowerThreadDetail, error) {
	thread, err := s.GetThread(ctx, meta, threadID)
	if err != nil || thread == nil {
		return nil, err
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	current, err := runtime.View(ctx, identity.ThreadID(strings.TrimSpace(threadID)))
	if err != nil {
		return nil, fmt.Errorf("read thread runtime view: %w", err)
	}
	applyThreadRuntimeSummary(thread, current)
	return &FlowerThreadDetail{Thread: *thread, Current: publicFloretThreadView(current)}, nil
}

func (s *Service) ListThreads(ctx context.Context, meta *session.Meta, limit int, cursor string) (*ListThreadsResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	c, ok := threadstore.DecodeCursor(cursor)
	if !ok {
		return nil, errors.New("invalid cursor")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	list, next, err := db.ListThreadSettings(ctx, endpointID, limit, c)
	if err != nil {
		return nil, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	summaries, err := typed.List(ctxOrBackground(ctx), flruntime.ThreadScope{})
	if err != nil {
		return nil, err
	}
	summaryByThread := make(map[string]flruntime.ThreadSummary, len(summaries))
	for _, summary := range summaries {
		summaryByThread[summary.ID.String()] = summary
	}
	out := &ListThreadsResponse{Threads: make([]ThreadView, 0, len(list)), NextCursor: strings.TrimSpace(next)}
	for _, t := range list {
		threadID := strings.TrimSpace(t.ThreadID)
		summary, found := summaryByThread[threadID]
		if !found {
			return nil, fmt.Errorf("product thread settings reference missing canonical Floret root %q", threadID)
		}
		current, currentErr := typed.View(ctxOrBackground(ctx), identity.ThreadID(threadID))
		if currentErr != nil {
			return nil, fmt.Errorf("read thread %s runtime view: %w", threadID, currentErr)
		}
		view, err := s.threadViewFromRecord(ctx, &t, current, &summary)
		if err != nil {
			return nil, fmt.Errorf("build thread %s view: %w", threadID, err)
		}
		applyThreadRuntimeSummary(&view, current)
		out.Threads = append(out.Threads, view)
	}
	return out, nil
}

func applyThreadRuntimeSummary(view *ThreadView, current flruntime.ThreadView) {
	if view == nil || strings.TrimSpace(view.ThreadID) == "" || current.ThreadID.String() != strings.TrimSpace(view.ThreadID) {
		return
	}
	view.QueuedTurnCount = len(current.Queue)
	view.RunErrorCode = ""
	view.RunError = ""
	hasInput := false
	approvalCount := 0
	for _, interaction := range current.Interactions {
		if interaction.Resolved {
			continue
		}
		switch interaction.Kind {
		case flruntime.ThreadInteractionInput:
			hasInput = true
		case flruntime.ThreadInteractionApproval:
			approvalCount++
		}
	}
	pending := approvalCount > 0
	view.ApprovalPending = &pending
	view.ApprovalPendingCount = approvalCount
	switch {
	case hasInput:
		view.RunStatus = string(RunStateWaitingUser)
	case pending:
		view.RunStatus = string(RunStateWaitingApproval)
	case current.Activity == flruntime.ThreadActivityActive:
		view.RunStatus = string(RunStateRunning)
	case current.LastOutcome != nil && *current.LastOutcome == flruntime.TurnOutcomeCompleted:
		view.RunStatus = string(RunStateSuccess)
	case current.LastOutcome != nil && *current.LastOutcome == flruntime.TurnOutcomeFailed:
		view.RunStatus = string(RunStateFailed)
		view.RunErrorCode = "floret_turn_failed"
		view.RunError = strings.TrimSpace(current.Error)
	case current.LastOutcome != nil && *current.LastOutcome == flruntime.TurnOutcomeCancelled:
		view.RunStatus = string(RunStateCanceled)
	}
	if current.Activity == flruntime.ThreadActivityActive && current.TurnID != "" {
		view.ActiveRunID = current.TurnID.String()
	} else if current.Activity != flruntime.ThreadActivityActive {
		view.ActiveRunID = ""
	}
}

func (s *Service) CreateThread(ctx context.Context, meta *session.Meta, title string, modelID string, permissionType string, workingDir string) (*ThreadView, error) {
	clientRequestID, err := newProductRequestID("create_")
	if err != nil {
		return nil, err
	}
	return s.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		ClientRequestID: clientRequestID,
		Title:           title,
		ModelID:         modelID,
		PermissionType:  strings.TrimSpace(permissionType),
		WorkingDir:      workingDir,
	})
}

func (s *Service) buildThreadCreateSettings(ctx context.Context, meta *session.Meta, req CreateThreadRequest) (threadstore.ThreadSettings, error) {
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	modelID := strings.TrimSpace(req.ModelID)
	defaultPermission := FlowerPermissionApprovalRequired
	if cfg != nil {
		configured, err := permissionTypeOrDefault(cfg.EffectivePermissionType(), defaultPermission)
		if err != nil {
			return threadstore.ThreadSettings{}, fmt.Errorf("invalid configured permission type: %w", err)
		}
		defaultPermission = configured
	}
	permissionType, err := permissionTypeOrDefault(req.PermissionType, defaultPermission)
	if err != nil {
		return threadstore.ThreadSettings{}, err
	}
	if modelID != "" {
		if _, _, ok := strings.Cut(modelID, "/"); !ok && !isDesktopModelSourceModelID(modelID) {
			return threadstore.ThreadSettings{}, errors.New("invalid model")
		}
		if cfg != nil && cfg.HasModelProfile() && cfg.IsAllowedModelID(modelID) {
		} else if ok, allowErr := s.desktopModelSourceModelAllowed(ctx, modelID); allowErr != nil {
			return threadstore.ThreadSettings{}, allowErr
		} else if !ok {
			return threadstore.ThreadSettings{}, fmt.Errorf("model not allowed: %s", modelID)
		}
	}
	if modelID == "" {
		if candidate, ok := s.resolvedDesktopModelSourceOverrideModel(ctx); ok {
			modelID = candidate
		}
	}
	if modelID == "" {
		if candidate, ok := s.resolvedDesktopModelSourceDefaultModel(ctx); ok {
			modelID = candidate
		}
	}
	if modelID == "" && cfg != nil && cfg.HasModelProfile() {
		if candidate := strings.TrimSpace(cfg.CurrentModelID); candidate != "" && cfg.IsAllowedModelID(candidate) {
			modelID = candidate
		}
	}
	reasoningCapability, modelDefaultReasoning, _, err := s.threadReasoningDefaults(ctx, modelID)
	if err != nil {
		return threadstore.ThreadSettings{}, err
	}
	reasoningSelection, err := normalizeRequestedReasoningOrReject(reasoningCapability, req.ReasoningSelection)
	if err != nil {
		return threadstore.ThreadSettings{}, reasoningSelectionError(modelID, err)
	}
	if reasoningSelection.IsZero() {
		reasoningSelection = modelDefaultReasoning
	}
	if err := config.ValidateAIReasoningSelection(reasoningCapability, reasoningSelection); err != nil {
		return threadstore.ThreadSettings{}, reasoningSelectionError(modelID, err)
	}
	reasoningSelectionJSON, err := marshalReasoningSelection(reasoningSelection)
	if err != nil {
		return threadstore.ThreadSettings{}, err
	}
	workingDir := strings.TrimSpace(req.WorkingDir)
	if workingDir == "" {
		workingDir = strings.TrimSpace(s.agentHomeDir)
	}
	workingDir, err = validateThreadWorkingDir(workingDir, s.scope)
	if err != nil {
		return threadstore.ThreadSettings{}, err
	}
	now := time.Now().UnixMilli()
	return threadstore.ThreadSettings{
		EndpointID: strings.TrimSpace(meta.EndpointID), NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
		ModelID: modelID, ReasoningSelectionJSON: reasoningSelectionJSON, PermissionType: permissionTypeString(permissionType), WorkingDir: workingDir,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), CreatedByUserEmail: strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), UpdatedByUserEmail: strings.TrimSpace(meta.UserEmail),
		SettingsCreatedAtUnixMs: now, SettingsUpdatedAtUnixMs: now,
	}, nil
}

func (s *Service) CreateThreadWithOptions(ctx context.Context, meta *session.Meta, req CreateThreadRequest) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	clientRequestID := strings.TrimSpace(req.ClientRequestID)
	if !validUploadStagingTargetID(clientRequestID) {
		return nil, errors.New("invalid client_request_id")
	}
	t, err := s.buildThreadCreateSettings(ctxOrBackground(ctx), meta, req)
	if err != nil {
		return nil, err
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	current, err := runtime.Create(ctxOrBackground(ctx), flruntime.CreateThreadInput{RequestKey: flruntime.RequestKey(clientRequestID)})
	if err != nil {
		return nil, fmt.Errorf("create thread: %w", err)
	}
	t.ThreadID = current.ThreadID.String()
	if err := db.AdoptCanonicalRootSettings(ctxOrBackground(ctx), t); err != nil {
		return nil, err
	}
	title := strings.TrimSpace(req.Title)
	if title != "" {
		current, err = runtime.SetTitle(ctxOrBackground(ctx), flruntime.SetTitleInput{
			ThreadID: current.ThreadID, Title: title, RequestKey: flruntime.RequestKey(clientRequestID + ":title"),
		})
		if err != nil {
			return nil, err
		}
	}
	summary, err := threadSummaryFromRuntime(ctxOrBackground(ctx), runtime, current.ThreadID)
	if err != nil {
		return nil, err
	}
	view := threadViewFromRuntimeCurrent(t, current, summary)
	return &view, nil
}

func threadSummaryFromRuntime(ctx context.Context, runtime flruntime.ThreadService, threadID identity.ThreadID) (flruntime.ThreadSummary, error) {
	summaries, err := runtime.List(ctxOrBackground(ctx), flruntime.ThreadScope{})
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == threadID {
			return summary, nil
		}
	}
	return flruntime.ThreadSummary{}, fmt.Errorf("canonical Floret summary is missing for thread %q", threadID)
}

func threadViewFromRuntimeCurrent(settings threadstore.ThreadSettings, current flruntime.ThreadView, summary flruntime.ThreadSummary) ThreadView {
	runStatus := string(RunStateIdle)
	if current.Activity == flruntime.ThreadActivityActive {
		switch {
		case current.Attention.InputCount > 0:
			runStatus = string(RunStateWaitingUser)
		case current.Attention.ApprovalCount > 0:
			runStatus = string(RunStateWaitingApproval)
		default:
			runStatus = string(RunStateRunning)
		}
	}
	preview := ""
	for index := len(current.Items) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(current.Items[index].Text); text != "" {
			preview = text
			break
		}
	}
	return ThreadView{
		ThreadID: current.ThreadID.String(), Title: strings.TrimSpace(summary.Title), TitleStatus: strings.TrimSpace(string(summary.TitleStatus)), ModelID: settings.ModelID,
		PermissionType: settings.PermissionType, WorkingDir: settings.WorkingDir,
		QueuedTurnCount: len(current.Queue), RunStatus: runStatus,
		ApprovalPendingCount: current.Attention.ApprovalCount, ActiveRunID: current.TurnID.String(),
		PinnedAtUnixMs: settings.PinnedAtUnixMs, CreatedAtUnixMs: settings.SettingsCreatedAtUnixMs,
		UpdatedAtUnixMs: settings.SettingsUpdatedAtUnixMs, LastMessageAtUnixMs: settings.SettingsUpdatedAtUnixMs,
		LastMessagePreview: preview,
	}
}

func (s *Service) ValidateWorkingDir(workingDir string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	fallbackWorkingDir := strings.TrimSpace(s.agentHomeDir)
	workingDir = strings.TrimSpace(workingDir)
	if workingDir == "" {
		workingDir = fallbackWorkingDir
	}
	return validateThreadWorkingDir(workingDir, s.scope)
}

func validateThreadWorkingDir(workingDir string, scope *filesystemscope.Registry) (string, error) {
	if strings.TrimSpace(workingDir) == "" {
		return "", errors.New("missing working_dir")
	}
	resolved, err := scope.Resolve(workingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		msg := strings.TrimSpace(err.Error())
		switch {
		case msg == "path must be absolute":
			return "", errors.New("working_dir must be absolute")
		case errors.Is(err, filesystemscope.ErrPathOutsideScope):
			return "", errors.New("working_dir is outside the configured filesystem roots")
		case errors.Is(err, os.ErrNotExist):
			return "", errors.New("working_dir does not exist")
		case errors.Is(err, filesystemscope.ErrPathNotDirectory):
			return "", errors.New("working_dir must be a directory")
		default:
			return "", errors.New("working_dir is not accessible")
		}
	}
	return resolved.RealAbs, nil
}

func (s *Service) RenameThread(ctx context.Context, meta *session.Meta, threadID string, title string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	if endpointID == "" {
		return errors.New("invalid request")
	}
	db, _, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return err
	}
	requestID, err := newProductRequestID("title_")
	if err != nil {
		return err
	}
	if _, err := runtime.SetTitle(ctxOrBackground(ctx), flruntime.SetTitleInput{
		ThreadID: identity.ThreadID(threadID), Title: title, RequestKey: flruntime.RequestKey(requestID),
	}); err != nil {
		return err
	}
	_ = db
	_ = s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) SetThreadPinned(ctx context.Context, meta *session.Meta, threadID string, pinned bool) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	pinnedAt, err := db.SetThreadPinned(ctx, endpointID, threadID, pinned, meta.UserPublicID, meta.UserEmail)
	if err != nil {
		return nil, err
	}
	// Summary delivery observes the active run and may wait on Floret. Keep it
	// out of the pin receipt path so metadata changes remain responsive.
	go func() {
		_ = s.broadcastThreadSummary(endpointID, threadID)
	}()
	// Pinning is product metadata, independent of the active run lifecycle.
	// Return a receipt instead of waiting for a canonical transcript read.
	return &ThreadView{ThreadID: threadID, PinnedAtUnixMs: pinnedAt}, nil
}

func (s *Service) ForkThread(ctx context.Context, meta *session.Meta, sourceThreadID string, title string) (*ThreadView, error) {
	clientRequestID, err := newProductRequestID("fork_")
	if err != nil {
		return nil, err
	}
	return s.ForkThreadWithOptions(ctx, meta, sourceThreadID, ForkThreadRequest{ClientRequestID: clientRequestID, Title: title})
}

func (s *Service) ForkThreadWithOptions(ctx context.Context, meta *session.Meta, sourceThreadID string, req ForkThreadRequest) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	sourceThreadID = strings.TrimSpace(sourceThreadID)
	if sourceThreadID == "" {
		return nil, errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("invalid request")
	}
	clientRequestID := strings.TrimSpace(req.ClientRequestID)
	if !validUploadStagingTargetID(clientRequestID) {
		return nil, errors.New("invalid client_request_id")
	}
	title := strings.TrimSpace(req.Title)
	source, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, sourceThreadID)
	if err != nil {
		return nil, err
	}
	if source == nil {
		return nil, sql.ErrNoRows
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	current, err := runtime.Fork(ctxOrBackground(ctx), flruntime.ForkThreadInput{
		SourceThreadID: identity.ThreadID(sourceThreadID), RequestKey: flruntime.RequestKey(clientRequestID),
	})
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	forked := *source
	forked.ThreadID = current.ThreadID.String()
	forked.PinnedAtUnixMs = 0
	forked.CreatedByUserPublicID = strings.TrimSpace(meta.UserPublicID)
	forked.CreatedByUserEmail = strings.TrimSpace(meta.UserEmail)
	forked.UpdatedByUserPublicID = strings.TrimSpace(meta.UserPublicID)
	forked.UpdatedByUserEmail = strings.TrimSpace(meta.UserEmail)
	forked.SettingsCreatedAtUnixMs = now
	forked.SettingsUpdatedAtUnixMs = now
	if err := db.AdoptCanonicalRootSettings(ctxOrBackground(ctx), forked); err != nil {
		return nil, err
	}
	if title != "" {
		current, err = runtime.SetTitle(ctxOrBackground(ctx), flruntime.SetTitleInput{
			ThreadID: current.ThreadID, Title: title, RequestKey: flruntime.RequestKey(clientRequestID + ":title"),
		})
		if err != nil {
			return nil, err
		}
	}
	summary, err := threadSummaryFromRuntime(ctxOrBackground(ctx), runtime, current.ThreadID)
	if err != nil {
		return nil, err
	}
	view := threadViewFromRuntimeCurrent(forked, current, summary)
	return &view, nil
}

func canonicalThreadBusy(current flruntime.ThreadView) bool {
	if current.Activity == flruntime.ThreadActivityActive {
		return true
	}
	for _, interaction := range current.Interactions {
		if !interaction.Resolved {
			return true
		}
	}
	return false
}

func (s *Service) threadPreferenceChangeBlocked(ctx context.Context, threadID string) (bool, error) {
	current, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return false, err
	}
	return canonicalThreadBusy(current), nil
}

func (s *Service) SetThreadModel(ctx context.Context, meta *session.Meta, threadID string, modelID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return errors.New("missing model_id")
	}
	if _, _, ok := strings.Cut(modelID, "/"); !ok && !isDesktopModelSourceModelID(modelID) {
		return errors.New("invalid model")
	}

	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if !cfg.HasModelProfile() && !isDesktopModelSourceModelID(modelID) {
		return ErrNotConfigured
	}
	if cfg.HasModelProfile() && cfg.IsAllowedModelID(modelID) {
		// The model is provided by the runtime config.
	} else if ok, err := s.desktopModelSourceModelAllowed(ctx, modelID); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("model not allowed: %s", modelID)
	}
	db, th, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	currentModelID := strings.TrimSpace(th.ModelID)
	if currentModelID == modelID {
		return nil
	}
	preferenceBlocked, err := s.threadPreferenceChangeBlocked(ctx, threadID)
	if err != nil {
		return err
	}
	if preferenceBlocked {
		return ErrThreadBusy
	}

	reasoningCapability, modelDefaultReasoning, _, err := s.threadReasoningDefaults(ctx, modelID)
	if err != nil {
		return err
	}
	storedReasoning, err := parseStoredReasoningSelection(th.ReasoningSelectionJSON)
	if err != nil {
		return err
	}
	normalizedReasoning, _, err := normalizeReasoningForModelSwitch(reasoningCapability, storedReasoning, modelDefaultReasoning)
	if err != nil {
		return reasoningSelectionError(modelID, err)
	}
	if err := config.ValidateAIReasoningSelection(reasoningCapability, normalizedReasoning); err != nil {
		return reasoningSelectionError(modelID, err)
	}
	normalizedReasoningJSON, err := marshalReasoningSelection(normalizedReasoning)
	if err != nil {
		return err
	}
	if err := db.UpdateThreadModelAndReasoningSelection(ctx, endpointID, threadID, modelID, normalizedReasoningJSON); err != nil {
		return err
	}
	_ = s.broadcastThreadSummary(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))
	return nil
}

func (s *Service) SetThreadReasoningSelection(ctx context.Context, meta *session.Meta, threadID string, selection config.AIReasoningSelection) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}
	db, th, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	preferenceBlocked, err := s.threadPreferenceChangeBlocked(ctx, threadID)
	if err != nil {
		return err
	}
	if preferenceBlocked {
		return ErrThreadBusy
	}
	capability, modelDefault, _, err := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
	if err != nil {
		return err
	}
	normalized, err := normalizeRequestedReasoningOrReject(capability, selection)
	if err != nil {
		return reasoningSelectionError(th.ModelID, err)
	}
	if normalized.IsZero() {
		normalized = modelDefault
	}
	if err := config.ValidateAIReasoningSelection(capability, normalized); err != nil {
		return reasoningSelectionError(th.ModelID, err)
	}
	normalizedJSON, err := marshalReasoningSelection(normalized)
	if err != nil {
		return err
	}
	if err := db.UpdateThreadReasoningSelection(ctx, endpointID, threadID, normalizedJSON); err != nil {
		return err
	}
	_ = s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) ClearThreadReasoningSelection(ctx context.Context, meta *session.Meta, threadID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}
	db, _, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	preferenceBlocked, err := s.threadPreferenceChangeBlocked(ctx, threadID)
	if err != nil {
		return err
	}
	if preferenceBlocked {
		return ErrThreadBusy
	}
	if err := db.UpdateThreadReasoningSelection(ctx, endpointID, threadID, ""); err != nil {
		return err
	}
	_ = s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) SetThreadPermissionType(ctx context.Context, meta *session.Meta, threadID string, permissionType string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	normalizedPermissionType, err := parsePermissionType(permissionType)
	if err != nil {
		return err
	}
	db, th, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	currentPermissionType, err := threadPermissionType(th)
	if err != nil {
		return err
	}
	if currentPermissionType == normalizedPermissionType {
		return nil
	}
	if err := db.UpdateThreadPermissionType(ctx, endpointID, threadID, permissionTypeString(normalizedPermissionType)); err != nil {
		return err
	}
	_ = s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) CancelThread(meta *session.Meta, threadID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	_, err := s.StopThread(context.Background(), meta, threadID)
	return err
}

func (s *Service) DeleteThread(ctx context.Context, meta *session.Meta, threadID string, force bool) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	db := s.threadsDB
	readStateCleaner := s.flowerReadStateCleaner
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	settings, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return err
	}
	if settings == nil {
		return nil
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return err
	}
	view, err := runtime.View(ctxOrBackground(ctx), identity.ThreadID(threadID))
	canonicalDeleted := errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted)
	if err != nil && !canonicalDeleted {
		return err
	}
	if !canonicalDeleted && view.Activity == flruntime.ThreadActivityActive && !force {
		return ErrThreadBusy
	}
	requestKey := flruntime.RequestKey("delete:" + threadID)
	if !canonicalDeleted && force {
		_, _ = runtime.Cancel(ctxOrBackground(ctx), flruntime.CancelInput{
			ThreadID: identity.ThreadID(threadID), RequestKey: flruntime.RequestKey("delete-cancel:" + threadID),
		})
	}
	if !canonicalDeleted {
		if err := runtime.Delete(ctxOrBackground(ctx), flruntime.DeleteThreadInput{
			ThreadID: identity.ThreadID(threadID), RequestKey: requestKey,
		}); err != nil && !errors.Is(err, flruntime.ErrThreadNotFound) && !errors.Is(err, flruntime.ErrThreadDeleted) {
			return err
		}
	}
	if err := db.DeleteThreadProductData(ctxOrBackground(ctx), endpointID, threadID); err != nil {
		return err
	}
	if readStateCleaner != nil {
		go func() {
			if err := readStateCleaner.RetireFlowerThreadReadState(context.Background(), endpointID, threadID); err != nil && s.log != nil {
				s.log.Warn("retire Flower thread read state after canonical delete", "thread_id", threadID, "error", err)
			}
		}()
	}
	s.scheduleThreadstoreCompaction("thread_delete")
	return nil
}

func (s *Service) ListThreadMessages(ctx context.Context, meta *session.Meta, threadID string, limit int, beforeID int64) (*ListThreadMessagesResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	msgs, nextBeforeID, hasMore, err := s.listThreadTimelineMessages(ctx, meta.EndpointID, threadID, limit, beforeID)
	if err != nil {
		return nil, err
	}
	out := &ListThreadMessagesResponse{
		Messages:            make([]any, 0, len(msgs)),
		TimelineDecorations: make([]FlowerTimelineDecoration, 0),
		NextBeforeID:        nextBeforeID,
		HasMore:             hasMore,
	}
	for _, m := range msgs {
		if m.Decoration != nil {
			out.TimelineDecorations = append(out.TimelineDecorations, *m.Decoration)
			continue
		}
		if len(m.MessageJSON) == 0 {
			continue
		}
		out.Messages = append(out.Messages, m.MessageJSON)
	}
	out.TotalReturned = len(out.Messages)
	return out, nil
}
