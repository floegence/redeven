package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

// NewThreadID generates a cryptographically random thread id.
func NewThreadID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "th_" + base64.RawURLEncoding.EncodeToString(b), nil
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

func (s *Service) threadViewFromRecord(ctx context.Context, th *threadstore.ThreadSettings, queuedTurnCount int, snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) (ThreadView, error) {
	if th == nil {
		return ThreadView{}, errors.New("thread settings are missing")
	}
	permissionType, err := threadPermissionType(th)
	if err != nil {
		return ThreadView{}, err
	}
	runStatus, runErrorCode, runError, err := threadViewRunState(snapshot, latest)
	if err != nil {
		return ThreadView{}, err
	}
	activeRunID := ""
	if snapshot.Status == flruntime.ThreadStatusRunning || snapshot.Status == flruntime.ThreadStatusWaiting || snapshot.Status == flruntime.ThreadStatusInterrupted {
		activeRunID = strings.TrimSpace(string(snapshot.LatestRunID))
	}
	lastMessageAt, lastMessagePreview := canonicalThreadPreview(latest)
	waitingPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return ThreadView{}, err
	}
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
	view := ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               strings.TrimSpace(snapshot.Title),
		TitleStatus:         strings.TrimSpace(snapshot.TitleStatus),
		ModelID:             strings.TrimSpace(th.ModelID),
		PermissionType:      permissionTypeString(permissionType),
		WorkingDir:          workingDir,
		QueuedTurnCount:     queuedTurnCount,
		RunStatus:           runStatus,
		RunUpdatedAtUnixMs:  snapshot.UpdatedAt.UnixMilli(),
		RunErrorCode:        runErrorCode,
		RunError:            runError,
		WaitingPrompt:       waitingPrompt,
		ActiveRunID:         activeRunID,
		ReasoningSelection:  reasoningSelection,
		ReasoningCapability: capability,
		PinnedAtUnixMs:      th.PinnedAtUnixMs,
		CreatedAtUnixMs:     snapshot.CreatedAt.UnixMilli(),
		UpdatedAtUnixMs:     snapshot.UpdatedAt.UnixMilli(),
		LastMessageAtUnixMs: lastMessageAt,
		LastMessagePreview:  lastMessagePreview,
		FlowerActivity: FlowerThreadReadSnapshot{
			ActivityRevision:    snapshot.ThroughOrdinal,
			LastMessageAtUnixMs: lastMessageAt,
			ActivitySignature:   fmt.Sprintf("%s:%d", strings.TrimSpace(th.ThreadID), snapshot.ThroughOrdinal),
			WaitingPromptID:     waitingPromptID(waitingPrompt),
		},
	}
	return view, nil
}

func (s *Service) readCanonicalThreadState(ctx context.Context, threadID string) (flruntime.ThreadSnapshot, *flruntime.ThreadTurnSnapshot, error) {
	host, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	canonicalThreadID := flruntime.ThreadID(strings.TrimSpace(threadID))
	overview, err := host.ReadThreadOverview(ctx, canonicalThreadID)
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	return overview.Thread, overview.LatestTurn, nil
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
	if s.threadMgr == nil {
		return nil, nil, nil, errors.New("thread manager not ready")
	}
	unlock, err := s.threadMgr.lockThreadLifecycle(endpointID, threadID)
	if err != nil {
		return nil, nil, nil, err
	}
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
	if _, _, err := s.readCanonicalThreadState(ctxOrBackground(ctx), threadID); err != nil {
		return fail(err)
	}
	return db, settings, unlock, nil
}

func threadViewRunState(snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) (string, string, string, error) {
	switch snapshot.Status {
	case flruntime.ThreadStatusRunning:
		return string(RunStateRunning), "", "", nil
	case flruntime.ThreadStatusWaiting:
		waitingPrompt, err := requestUserInputPromptFromFloretTurn(latest)
		if err != nil {
			return "", "", "", err
		}
		if waitingPrompt != nil {
			return string(RunStateWaitingUser), "", "", nil
		}
		return string(RunStateWaitingApproval), "", "", nil
	case flruntime.ThreadStatusCompleted:
		return string(RunStateSuccess), "", "", nil
	case flruntime.ThreadStatusFailed:
		failure := ""
		if latest != nil && latest.Failure != nil {
			failure = strings.TrimSpace(latest.Failure.Message)
		}
		return string(RunStateFailed), "floret_turn_failed", failure, nil
	case flruntime.ThreadStatusCancelled:
		return string(RunStateCanceled), "", "", nil
	case flruntime.ThreadStatusInterrupted:
		return string(RunStateRecovering), "", "", nil
	case flruntime.ThreadStatusIdle:
		return string(RunStateIdle), "", "", nil
	default:
		return "", "", "", fmt.Errorf("unsupported Floret thread status %q", snapshot.Status)
	}
}

func canonicalThreadPreview(latest *flruntime.ThreadTurnSnapshot) (int64, string) {
	if latest == nil {
		return 0, ""
	}
	preview := ""
	for index := len(latest.Projection.Segments) - 1; index >= 0; index-- {
		segment := latest.Projection.Segments[index]
		preview = strings.TrimSpace(segment.Text)
		if preview == "" && segment.Signal != nil {
			preview = strings.TrimSpace(segment.Signal.Text)
		}
		if preview != "" {
			break
		}
	}
	if preview == "" {
		preview = strings.TrimSpace(latest.UserInput)
	}
	return latest.UpdatedAt.UnixMilli(), truncateRunes(preview, 160)
}

func requestUserInputPromptFromFloretTurn(turn *flruntime.ThreadTurnSnapshot) (*RequestUserInputPrompt, error) {
	if turn == nil || turn.Status != flruntime.TurnStatusWaiting {
		return nil, nil
	}
	for index := len(turn.ControlSignals) - 1; index >= 0; index-- {
		signal := turn.ControlSignals[index]
		if strings.TrimSpace(signal.Name) != "ask_user" {
			continue
		}
		payload := make(map[string]any, len(signal.Payload)+4)
		for key, value := range signal.Payload {
			payload[key] = value
		}
		payload["prompt_id"] = "rui_" + strings.TrimSpace(string(turn.TurnID)) + "_" + strings.TrimSpace(signal.CallID)
		payload["message_id"] = strings.TrimSpace(string(turn.TurnID))
		payload["tool_id"] = strings.TrimSpace(signal.CallID)
		payload["tool_name"] = "ask_user"
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal Floret ask_user payload: %w", err)
		}
		prompt := parseRequestUserInputPromptJSON(string(raw))
		if prompt == nil {
			return nil, errors.New("Floret ask_user payload is malformed")
		}
		return prompt, nil
	}
	return nil, nil
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
	if err := requireRWX(meta); err != nil {
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
	queuedTurnCount, err := db.CountFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	if err != nil {
		return nil, err
	}

	snapshot, latest, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return nil, fmt.Errorf("read canonical Floret thread %s: %w", threadID, err)
	}
	view, err := s.threadViewFromRecord(ctx, th, queuedTurnCount, snapshot, latest)
	if err != nil {
		return nil, err
	}
	view.QueuedTurns = make([]QueuedTurnView, 0, queuedTurnCount)
	if queuedTurnCount > 0 {
		queued, listErr := db.ListFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued, queuedTurnCount)
		if listErr != nil {
			return nil, listErr
		}
		for _, record := range queued {
			queuedView, err := queuedTurnRecordToThreadView(record)
			if err != nil {
				return nil, fmt.Errorf("decode queued turn %q: %w", record.QueueID, err)
			}
			view.QueuedTurns = append(view.QueuedTurns, queuedView)
		}
	}
	return &view, nil
}

func (s *Service) ListThreads(ctx context.Context, meta *session.Meta, limit int, cursor string) (*ListThreadsResponse, error) {
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

	c, ok := threadstore.DecodeCursor(cursor)
	if !ok {
		return nil, errors.New("invalid cursor")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	list, next, err := db.ListThreadSettings(ctx, endpointID, limit, c)
	if err != nil {
		return nil, err
	}
	threadIDs := make([]string, 0, len(list))
	for _, t := range list {
		threadIDs = append(threadIDs, strings.TrimSpace(t.ThreadID))
	}
	queuedTurnCounts, err := db.CountFollowupsByThreadAndLane(ctx, endpointID, threadIDs, threadstore.FollowupLaneQueued)
	if err != nil {
		return nil, err
	}
	canonicalByThread := make(map[string]flruntime.ThreadSnapshot, len(threadIDs))
	latestByThread := make(map[string]*flruntime.ThreadTurnSnapshot, len(threadIDs))
	for _, threadID := range threadIDs {
		snapshot, latest, err := s.readCanonicalThreadState(ctx, threadID)
		if err != nil {
			return nil, fmt.Errorf("read canonical Floret thread %s: %w", threadID, err)
		}
		canonicalByThread[threadID] = snapshot
		latestByThread[threadID] = latest
	}
	out := &ListThreadsResponse{Threads: make([]ThreadView, 0, len(list)), NextCursor: strings.TrimSpace(next)}
	for _, t := range list {
		threadID := strings.TrimSpace(t.ThreadID)
		view, err := s.threadViewFromRecord(ctx, &t, queuedTurnCounts[threadID], canonicalByThread[threadID], latestByThread[threadID])
		if err != nil {
			return nil, fmt.Errorf("build thread %s view: %w", threadID, err)
		}
		out.Threads = append(out.Threads, view)
	}
	return out, nil
}

func (s *Service) CreateThread(ctx context.Context, meta *session.Meta, title string, modelID string, permissionType string, workingDir string) (*ThreadView, error) {
	return s.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		Title:          title,
		ModelID:        modelID,
		PermissionType: strings.TrimSpace(permissionType),
		WorkingDir:     workingDir,
	})
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
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	id, err := NewThreadID()
	if err != nil {
		return nil, err
	}

	modelID := strings.TrimSpace(req.ModelID)
	defaultPermission := FlowerPermissionApprovalRequired
	if cfg != nil {
		p, err := permissionTypeOrDefault(cfg.EffectivePermissionType(), defaultPermission)
		if err != nil {
			return nil, fmt.Errorf("invalid configured permission type: %w", err)
		}
		defaultPermission = p
	}
	permissionType, err := permissionTypeOrDefault(req.PermissionType, defaultPermission)
	if err != nil {
		return nil, err
	}
	if modelID != "" {
		if _, _, ok := strings.Cut(modelID, "/"); !ok && !isDesktopModelSourceModelID(modelID) {
			return nil, errors.New("invalid model")
		}
		if cfg.HasModelProfile() && cfg.IsAllowedModelID(modelID) {
			// The model is provided by the runtime config.
		} else if ok, err := s.desktopModelSourceModelAllowed(ctx, modelID); err != nil {
			return nil, err
		} else if !ok {
			return nil, fmt.Errorf("model not allowed: %s", modelID)
		}
	}
	if modelID == "" {
		if id, ok := s.resolvedDesktopModelSourceOverrideModel(ctx); ok {
			modelID = id
		}
	}
	if modelID == "" {
		if id, ok := s.resolvedDesktopModelSourceDefaultModel(ctx); ok {
			modelID = id
		}
	}
	if modelID == "" && cfg.HasModelProfile() {
		if id := strings.TrimSpace(cfg.CurrentModelID); id != "" && cfg.IsAllowedModelID(id) {
			modelID = id
		}
	}

	reasoningCapability, modelDefaultReasoning, _, err := s.threadReasoningDefaults(ctx, modelID)
	if err != nil {
		return nil, err
	}
	reasoningSelection, err := normalizeRequestedReasoningOrReject(reasoningCapability, req.ReasoningSelection)
	if err != nil {
		return nil, reasoningSelectionError(modelID, err)
	}
	if reasoningSelection.IsZero() {
		reasoningSelection = modelDefaultReasoning
	}
	if err := config.ValidateAIReasoningSelection(reasoningCapability, reasoningSelection); err != nil {
		return nil, reasoningSelectionError(modelID, err)
	}
	reasoningSelectionJSON, err := marshalReasoningSelection(reasoningSelection)
	if err != nil {
		return nil, err
	}

	fallbackWorkingDir := strings.TrimSpace(s.agentHomeDir)
	workingDir := strings.TrimSpace(req.WorkingDir)
	if workingDir == "" {
		workingDir = fallbackWorkingDir
	}
	workingDirClean, err := validateThreadWorkingDir(workingDir, s.scope)
	if err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()
	t := threadstore.ThreadSettings{
		ThreadID:                id,
		EndpointID:              strings.TrimSpace(meta.EndpointID),
		NamespacePublicID:       strings.TrimSpace(meta.NamespacePublicID),
		ModelID:                 modelID,
		ReasoningSelectionJSON:  reasoningSelectionJSON,
		PermissionType:          permissionTypeString(permissionType),
		WorkingDir:              workingDirClean,
		CreatedByUserPublicID:   strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:      strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID:   strings.TrimSpace(meta.UserPublicID),
		UpdatedByUserEmail:      strings.TrimSpace(meta.UserEmail),
		SettingsCreatedAtUnixMs: now,
		SettingsUpdatedAtUnixMs: now,
	}
	operation, err := db.PrepareThreadCreateOperation(ctx, threadstore.PrepareThreadCreateRequest{
		Settings: t, ExplicitTitle: strings.TrimSpace(req.Title), CreatedAtMS: now,
	})
	if err != nil {
		return nil, err
	}
	t, err = s.resumeThreadCreateOperation(ctx, operation)
	if err != nil {
		return nil, fmt.Errorf("create thread: %w", err)
	}
	snapshot, latest, err := s.readCanonicalThreadState(ctx, id)
	if err != nil {
		return nil, err
	}
	view, err := s.threadViewFromRecord(ctx, &t, 0, snapshot, latest)
	if err != nil {
		return nil, err
	}
	return &view, nil
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

type threadTitleFloretCoordinator struct {
	authority floretThreadTitleAuthority
}

func (c *threadTitleFloretCoordinator) set(ctx context.Context, threadID string, title string) (flruntime.ThreadSnapshot, error) {
	if c == nil || c.authority == nil {
		return flruntime.ThreadSnapshot{}, errors.New("Floret title coordinator authority is unavailable")
	}
	return c.authority.SetThreadTitle(ctxOrBackground(ctx), flruntime.ThreadID(strings.TrimSpace(threadID)), title)
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
	_, _, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	defer unlockLifecycle()
	if s.threadTitleFloret == nil {
		return errors.New("Floret title coordinator authority is unavailable")
	}
	if _, err := s.threadTitleFloret.set(ctx, threadID, title); err != nil {
		return err
	}
	s.broadcastThreadSummary(endpointID, threadID)
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
	db, _, unlockLifecycle, err := s.lockCanonicalThreadSettingsMutation(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	defer unlockLifecycle()
	if _, err := db.SetThreadPinned(ctx, endpointID, threadID, pinned, meta.UserPublicID, meta.UserEmail); err != nil {
		return nil, err
	}
	s.broadcastThreadSummary(endpointID, threadID)
	return s.GetThread(ctx, meta, threadID)
}

func (s *Service) ForkThread(ctx context.Context, meta *session.Meta, sourceThreadID string, title string) (*ThreadView, error) {
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
	destinationID, err := NewThreadID()
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	createdAtUnixMs := time.Now().UnixMilli()
	operation, err := func() (*threadstore.ForkOperation, error) {
		if s.threadMgr == nil {
			return nil, errors.New("thread manager not ready")
		}
		unlockLifecycle, err := s.threadMgr.lockThreadLifecycle(endpointID, sourceThreadID)
		if err != nil {
			return nil, err
		}
		defer unlockLifecycle()
		source, err := db.GetThreadSettings(ctx, endpointID, sourceThreadID)
		if err != nil {
			return nil, err
		}
		if source == nil {
			return nil, sql.ErrNoRows
		}
		sourceSnapshot, _, err := s.readCanonicalThreadState(ctx, sourceThreadID)
		if err != nil {
			return nil, fmt.Errorf("read canonical Floret thread %s: %w", sourceThreadID, err)
		}
		s.mu.Lock()
		thKey := runThreadKey(endpointID, sourceThreadID)
		activeRunID := strings.TrimSpace(s.activeRunByTh[thKey])
		finalizingRunID := strings.TrimSpace(s.stopFinalizingByTh[thKey])
		idleCompaction := s.idleCompactionByTh[thKey]
		idleBusy := idleCompaction != nil && idleCompaction.busy()
		s.mu.Unlock()
		if activeRunID != "" || finalizingRunID != "" || idleBusy || threadForkBlockedByRunState(sourceSnapshot) {
			return nil, ErrThreadForkUnavailable
		}
		if err := s.reconcileCanonicalPendingTurnCommands(ctx, endpointID, sourceThreadID, db); err != nil {
			return nil, fmt.Errorf("reconcile canonical pending turns before fork: %w", err)
		}
		return db.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
			OperationID:           "fork_" + destinationID,
			EndpointID:            endpointID,
			SourceThreadID:        sourceThreadID,
			DestinationThreadID:   destinationID,
			Title:                 title,
			CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
			CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
			CreatedAtUnixMs:       createdAtUnixMs,
		})
	}()
	if err != nil {
		return nil, err
	}
	forked, err := s.resumeThreadForkOperation(ctx, db, operation)
	if err != nil {
		return nil, err
	}
	return s.GetThread(ctx, meta, forked.ThreadID)
}

func threadForkBlockedByRunState(snapshot flruntime.ThreadSnapshot) bool {
	return canonicalThreadBusy(snapshot)
}

func canonicalThreadBusy(snapshot flruntime.ThreadSnapshot) bool {
	switch snapshot.Status {
	case flruntime.ThreadStatusRunning, flruntime.ThreadStatusWaiting, flruntime.ThreadStatusInterrupted:
		return true
	default:
		return false
	}
}

func (s *Service) threadPreferenceChangeBlocked(ctx context.Context, threadID string) (bool, error) {
	snapshot, _, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return false, err
	}
	return canonicalThreadBusy(snapshot), nil
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
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionRequestID(endpointID, threadID) != "" ||
		preferenceBlocked {
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
	s.broadcastThreadSummary(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))
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
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionRequestID(endpointID, threadID) != "" ||
		preferenceBlocked {
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
	s.broadcastThreadSummary(endpointID, threadID)
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
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionRequestID(endpointID, threadID) != "" ||
		preferenceBlocked {
		return ErrThreadBusy
	}
	if err := db.UpdateThreadReasoningSelection(ctx, endpointID, threadID, ""); err != nil {
		return err
	}
	s.broadcastThreadSummary(endpointID, threadID)
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
	s.broadcastThreadSummary(endpointID, threadID)
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

func (s *Service) DeleteThread(ctx context.Context, meta *session.Meta, threadID string, force bool) (ThreadDeleteResult, error) {
	if s == nil {
		return ThreadDeleteResult{}, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return ThreadDeleteResult{}, err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ThreadDeleteResult{}, errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return ThreadDeleteResult{}, errors.New("invalid request")
	}

	thKey := runThreadKey(endpointID, threadID)
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	readStateRequired := s.flowerReadStateCleaner != nil
	s.mu.Unlock()
	if db == nil {
		return ThreadDeleteResult{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	operation, err := func() (threadstore.ThreadDeleteOperation, error) {
		if s.threadMgr == nil {
			return threadstore.ThreadDeleteOperation{}, errors.New("thread manager not ready")
		}
		unlockLifecycle, err := s.threadMgr.lockThreadLifecycle(endpointID, threadID)
		if err != nil {
			return threadstore.ThreadDeleteOperation{}, err
		}
		defer unlockLifecycle()
		existingCtx, existingCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		existingOperation, err := db.GetThreadDeleteOperation(existingCtx, endpointID, threadID)
		existingCancel()
		if err != nil {
			return threadstore.ThreadDeleteOperation{}, err
		}
		var operation threadstore.ThreadDeleteOperation
		if existingOperation != nil {
			operation = *existingOperation
		} else {
			loadCtx, loadCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
			th, err := db.GetThreadSettings(loadCtx, endpointID, threadID)
			loadCancel()
			if err != nil {
				return threadstore.ThreadDeleteOperation{}, err
			}
			if th == nil {
				return threadstore.ThreadDeleteOperation{}, sql.ErrNoRows
			}
			s.mu.Lock()
			runID := strings.TrimSpace(s.activeRunByTh[thKey])
			finalizingRunID := strings.TrimSpace(s.stopFinalizingByTh[thKey])
			idleCompaction := s.idleCompactionByTh[thKey]
			if idleCompaction != nil && idleCompaction.isCancelled() {
				idleCompaction = nil
			}
			s.mu.Unlock()
			threadBusy := runID != "" || finalizingRunID != "" || idleCompaction != nil
			if threadBusy && !force {
				return threadstore.ThreadDeleteOperation{}, ErrThreadBusy
			}
			if !threadBusy {
				if err := s.reconcileCanonicalPendingTurnCommands(ctxOrBackground(ctx), endpointID, threadID, db); err != nil {
					return threadstore.ThreadDeleteOperation{}, fmt.Errorf("reconcile canonical pending turns before delete: %w", err)
				}
			}
			deleteCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
			operation, err = db.PrepareThreadDeleteOperation(deleteCtx, endpointID, threadID, readStateRequired)
			cancel()
			if err != nil {
				return threadstore.ThreadDeleteOperation{}, err
			}
		}
		s.mu.Lock()
		runID := strings.TrimSpace(s.activeRunByTh[thKey])
		finalizingRunID := strings.TrimSpace(s.stopFinalizingByTh[thKey])
		r := s.runs[runID]
		idleCompaction := s.idleCompactionByTh[thKey]
		if idleCompaction != nil && idleCompaction.isCancelled() {
			idleCompaction = nil
		}
		s.mu.Unlock()
		if runID != "" {
			if r != nil {
				r.markDetached()
				r.requestCancel("canceled")
			}
			s.mu.Lock()
			if strings.TrimSpace(s.activeRunByTh[thKey]) == runID {
				delete(s.activeRunByTh, thKey)
			}
			delete(s.stopFinalizingByTh, thKey)
			s.mu.Unlock()
		} else if finalizingRunID != "" {
			s.mu.Lock()
			if strings.TrimSpace(s.stopFinalizingByTh[thKey]) == finalizingRunID {
				delete(s.stopFinalizingByTh, thKey)
			}
			s.mu.Unlock()
		}
		if idleCompaction != nil {
			s.cancelIdleThreadCompactionWithBroadcast(endpointID, threadID)
		}
		return operation, nil
	}()
	if err != nil {
		return ThreadDeleteResult{}, err
	}
	if runtime := s.removeThreadSubagentRuntime(thKey); runtime != nil {
		runtime.release()
	}
	operation, replayErr := s.replayThreadDeleteOperation(ctx, operation)
	if operation.ProductDataDeletedAtUnixMs > 0 {
		s.scheduleThreadstoreCompaction("thread_delete")
	}
	return threadDeleteResult(operation), replayErr
}

func (s *Service) ListThreadMessages(ctx context.Context, meta *session.Meta, threadID string, limit int, beforeID int64) (*ListThreadMessagesResponse, error) {
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

func (s *Service) GetThreadTodos(ctx context.Context, meta *session.Meta, threadID string) (*ThreadTodosView, error) {
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
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("invalid request")
	}
	th, err := db.GetThreadSettings(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, sql.ErrNoRows
	}

	host, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return nil, err
	}
	snapshot, err := host.ReadThreadAgentTodos(ctx, flruntime.ThreadID(threadID))
	if err != nil {
		return nil, err
	}
	todos := make([]TodoItem, 0, len(snapshot.Items))
	for _, item := range snapshot.Items {
		todos = append(todos, TodoItem{ID: item.ID, Content: item.Content, Status: string(item.Status)})
	}
	return &ThreadTodosView{
		Version:         snapshot.Version,
		UpdatedAtUnixMs: snapshot.UpdatedAt.UnixMilli(),
		Todos:           append([]TodoItem(nil), todos...),
	}, nil
}
