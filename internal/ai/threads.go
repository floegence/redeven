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

func threadPermissionTypeString(th *threadstore.Thread) string {
	if th == nil {
		return permissionTypeString(FlowerPermissionApprovalRequired)
	}
	permissionType, err := normalizePermissionType(strings.TrimSpace(th.PermissionType), "")
	if err == nil {
		return permissionTypeString(permissionType)
	}
	return permissionTypeString(FlowerPermissionApprovalRequired)
}

func applyFlowerThreadMetadataView(view *ThreadView, meta *threadstore.FlowerThreadMetadata) {
	if view == nil {
		return
	}
	if meta != nil {
		view.OwnerKind = strings.TrimSpace(strings.ToLower(meta.OwnerKind))
		view.OwnerID = strings.TrimSpace(meta.OwnerID)
		view.ParentThreadID = strings.TrimSpace(meta.ParentThreadID)
	}
}

func (s *Service) threadViewFromRecord(ctx context.Context, th *threadstore.Thread, flowerMeta *threadstore.FlowerThreadMetadata, queuedTurnCount int, snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) ThreadView {
	if th == nil {
		return ThreadView{}
	}
	runStatus, runErrorCode, runError := threadViewRunState(snapshot, latest)
	activeRunID := ""
	if snapshot.Status == flruntime.ThreadStatusRunning || snapshot.Status == flruntime.ThreadStatusWaiting || snapshot.Status == flruntime.ThreadStatusInterrupted {
		activeRunID = strings.TrimSpace(string(snapshot.LatestRunID))
	}
	updatedAt := th.UpdatedAtUnixMs
	if snapshot.UpdatedAt.UnixMilli() > updatedAt {
		updatedAt = snapshot.UpdatedAt.UnixMilli()
	}
	lastMessageAt, lastMessagePreview := canonicalThreadPreview(latest)
	waitingPrompt := requestUserInputPromptFromFloretTurn(latest)
	workingDir := strings.TrimSpace(th.WorkingDir)
	if workingDir == "" && s != nil {
		workingDir = strings.TrimSpace(s.agentHomeDir)
	}
	capability, _, _ := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
	view := ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               strings.TrimSpace(th.Title),
		ModelID:             strings.TrimSpace(th.ModelID),
		PermissionType:      threadPermissionTypeString(th),
		WorkingDir:          workingDir,
		QueuedTurnCount:     queuedTurnCount,
		RunStatus:           runStatus,
		RunUpdatedAtUnixMs:  snapshot.UpdatedAt.UnixMilli(),
		RunErrorCode:        runErrorCode,
		RunError:            runError,
		WaitingPrompt:       waitingPrompt,
		ActiveRunID:         activeRunID,
		ReasoningSelection:  unmarshalReasoningSelection(th.ReasoningSelectionJSON),
		ReasoningCapability: capability,
		PinnedAtUnixMs:      th.PinnedAtUnixMs,
		CreatedAtUnixMs:     th.CreatedAtUnixMs,
		UpdatedAtUnixMs:     updatedAt,
		LastMessageAtUnixMs: lastMessageAt,
		LastMessagePreview:  lastMessagePreview,
		FlowerActivity: FlowerThreadReadSnapshot{
			ActivityRevision:    snapshot.ThroughOrdinal,
			LastMessageAtUnixMs: lastMessageAt,
			ActivitySignature:   fmt.Sprintf("%s:%d", strings.TrimSpace(th.ThreadID), snapshot.ThroughOrdinal),
			WaitingPromptID:     waitingPromptID(waitingPrompt),
		},
	}
	applyFlowerThreadMetadataView(&view, flowerMeta)
	return view
}

func (s *Service) readCanonicalThreadState(ctx context.Context, threadID string) (flruntime.ThreadSnapshot, *flruntime.ThreadTurnSnapshot, error) {
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	snapshot, err := host.ReadThread(ctx, flruntime.ThreadID(strings.TrimSpace(threadID)))
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	page, err := host.ListThreadTurns(ctx, flruntime.ListThreadTurnsRequest{ThreadID: snapshot.ID, Tail: 1})
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	latest, err := canonicalThreadStateFromPage(snapshot, page)
	if err != nil {
		return flruntime.ThreadSnapshot{}, nil, err
	}
	return snapshot, latest, nil
}

func canonicalThreadStateFromPage(snapshot flruntime.ThreadSnapshot, page flruntime.ThreadTurnsPage) (*flruntime.ThreadTurnSnapshot, error) {
	threadID := strings.TrimSpace(string(snapshot.ID))
	if threadID == "" || strings.TrimSpace(string(page.ThreadID)) != threadID {
		return nil, canonicalTimelineResyncErrorf("thread snapshot and turn page identities differ")
	}
	if len(page.Turns) > 1 {
		return nil, canonicalTimelineResyncErrorf("tail page returned %d turns", len(page.Turns))
	}
	if len(page.Turns) == 0 {
		return nil, nil
	}

	latest := page.Turns[0]
	if latest.Ordinal <= 0 || strings.TrimSpace(latest.UserEntryID) == "" {
		return nil, canonicalTimelineResyncErrorf("latest turn has incomplete canonical identity")
	}
	if latest.ThroughOrdinal <= 0 || latest.ThroughOrdinal > page.ThroughOrdinal {
		return nil, canonicalTimelineResyncErrorf("latest turn projection ordinal %d is outside the page ordinal %d", latest.ThroughOrdinal, page.ThroughOrdinal)
	}
	if err := latest.Projection.Validate(); err != nil {
		return nil, canonicalTimelineResyncErrorf("latest turn projection is invalid: %v", err)
	}
	if latest.Projection.ThreadID != page.ThreadID || latest.Projection.TurnID != latest.TurnID || latest.Projection.RunID != latest.RunID || latest.Projection.ThroughOrdinal != latest.ThroughOrdinal {
		return nil, canonicalTimelineResyncErrorf("latest turn projection identity differs from the turn page")
	}
	return &latest, nil
}

func threadViewRunState(snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) (string, string, string) {
	switch snapshot.Status {
	case flruntime.ThreadStatusRunning:
		return string(RunStateRunning), "", ""
	case flruntime.ThreadStatusWaiting:
		if requestUserInputPromptFromFloretTurn(latest) != nil {
			return string(RunStateWaitingUser), "", ""
		}
		return string(RunStateWaitingApproval), "", ""
	case flruntime.ThreadStatusCompleted:
		return string(RunStateSuccess), "", ""
	case flruntime.ThreadStatusFailed:
		failure := ""
		if latest != nil {
			failure = strings.TrimSpace(latest.Failure)
		}
		return string(RunStateFailed), "floret_turn_failed", failure
	case flruntime.ThreadStatusCancelled:
		return string(RunStateCanceled), "", ""
	case flruntime.ThreadStatusInterrupted:
		return string(RunStateRecovering), "", ""
	default:
		return string(RunStateIdle), "", ""
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

func requestUserInputPromptFromFloretTurn(turn *flruntime.ThreadTurnSnapshot) *RequestUserInputPrompt {
	if turn == nil || turn.Status != flruntime.TurnStatusWaiting {
		return nil
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
			return nil
		}
		return parseRequestUserInputPromptJSON(string(raw))
	}
	return nil
}

func waitingPromptID(prompt *RequestUserInputPrompt) string {
	if prompt == nil {
		return ""
	}
	return strings.TrimSpace(prompt.PromptID)
}

func (s *Service) threadReasoningDefaults(ctx context.Context, modelID string) (config.AIReasoningCapability, config.AIReasoningSelection, bool) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || s == nil {
		return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if capability, selection, ok := modelReasoningDefaultsFromConfig(cfg, modelID); ok {
		return capability, selection, true
	}
	if isDesktopModelSourceModelID(modelID) {
		model, ok, err := s.desktopModelSourceModel(ctx, modelID)
		if err == nil && ok {
			capability := desktopModelSourceModelCapability(model).ReasoningCapability
			if capability.IsZero() {
				return capability, config.AIReasoningSelection{}, true
			}
			if strings.TrimSpace(capability.DefaultLevel) != "" {
				return capability, config.AIReasoningSelection{Level: config.AIReasoningLevel(capability.DefaultLevel)}, true
			}
			return capability, config.AIReasoningSelection{}, true
		}
	}
	return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
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
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, nil
	}
	flowerMeta, err := db.GetFlowerThreadMetadata(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	queuedTurnCount, err := db.CountFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	if err != nil {
		return nil, err
	}

	snapshot, latest, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return nil, fmt.Errorf("read canonical Floret thread %s: %w", threadID, err)
	}
	view := s.threadViewFromRecord(ctx, th, flowerMeta, queuedTurnCount, snapshot, latest)
	if queuedTurnCount > 0 {
		queued, listErr := db.ListFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued, queuedTurnCount)
		if listErr != nil {
			return nil, listErr
		}
		view.QueuedTurns = make([]QueuedTurnView, 0, len(queued))
		for _, record := range queued {
			view.QueuedTurns = append(view.QueuedTurns, queuedTurnRecordToThreadView(record))
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
	list, next, err := db.ListThreads(ctx, endpointID, limit, c)
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
	flowerMetaByThread := make(map[string]*threadstore.FlowerThreadMetadata, len(threadIDs))
	canonicalByThread := make(map[string]flruntime.ThreadSnapshot, len(threadIDs))
	latestByThread := make(map[string]*flruntime.ThreadTurnSnapshot, len(threadIDs))
	for _, threadID := range threadIDs {
		meta, err := db.GetFlowerThreadMetadata(ctx, endpointID, threadID)
		if err != nil {
			return nil, err
		}
		if meta != nil {
			flowerMetaByThread[threadID] = meta
		}
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
		out.Threads = append(out.Threads, s.threadViewFromRecord(ctx, &t, flowerMetaByThread[threadID], queuedTurnCounts[threadID], canonicalByThread[threadID], latestByThread[threadID]))
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
	permissionFallback := FlowerPermissionApprovalRequired
	if cfg != nil {
		if p, err := normalizePermissionType(cfg.EffectivePermissionType(), permissionFallback); err == nil {
			permissionFallback = p
		}
	}
	permissionType, err := normalizePermissionType(strings.TrimSpace(req.PermissionType), permissionFallback)
	if err != nil && strings.TrimSpace(req.PermissionType) != "" {
		return nil, err
	}
	if err != nil {
		permissionType = permissionFallback
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

	reasoningCapability, modelDefaultReasoning, _ := s.threadReasoningDefaults(ctx, modelID)
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
	t := threadstore.Thread{
		ThreadID:               id,
		EndpointID:             strings.TrimSpace(meta.EndpointID),
		NamespacePublicID:      strings.TrimSpace(meta.NamespacePublicID),
		ModelID:                modelID,
		ReasoningSelectionJSON: marshalReasoningSelection(reasoningSelection),
		PermissionType:         permissionTypeString(permissionType),
		WorkingDir:             workingDirClean,
		Title:                  strings.TrimSpace(req.Title),
		CreatedByUserPublicID:  strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:     strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID:  strings.TrimSpace(meta.UserPublicID),
		UpdatedByUserEmail:     strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:        now,
		UpdatedAtUnixMs:        now,
	}
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		return nil, err
	}
	if _, err := host.EnsureThread(ctx, flruntime.EnsureThreadRequest{ThreadID: flruntime.ThreadID(id)}); err != nil {
		return nil, fmt.Errorf("create canonical Floret thread: %w", err)
	}
	if err := db.CreateThread(ctx, t); err != nil {
		if cleanupErr := host.DeleteThread(ctx, flruntime.ThreadID(id)); cleanupErr != nil {
			return nil, fmt.Errorf("create product thread: %w; delete canonical Floret thread: %v", err, cleanupErr)
		}
		return nil, err
	}
	snapshot, latest, err := s.readCanonicalThreadState(ctx, id)
	if err != nil {
		return nil, err
	}
	view := s.threadViewFromRecord(ctx, &t, nil, 0, snapshot, latest)
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

func (s *Service) RenameThread(ctx context.Context, meta *session.Meta, threadID string, title string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	if err := db.RenameThread(ctx, endpointID, threadID, title, meta.UserPublicID, meta.UserEmail); err != nil {
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
	source, err := db.GetThread(ctx, endpointID, sourceThreadID)
	if err != nil {
		return nil, err
	}
	if source == nil {
		return nil, sql.ErrNoRows
	}
	sourceSnapshot, sourceLatest, err := s.readCanonicalThreadState(ctx, sourceThreadID)
	if err != nil {
		return nil, fmt.Errorf("read canonical Floret thread %s: %w", sourceThreadID, err)
	}
	if s.HasActiveThreadForEndpoint(endpointID, sourceThreadID) || threadForkBlockedByRunState(sourceSnapshot) {
		return nil, ErrThreadForkUnavailable
	}
	destinationID, err := NewThreadID()
	if err != nil {
		return nil, err
	}
	_, sourcePreview := canonicalThreadPreview(sourceLatest)
	title = normalizeForkThreadTitle(title, source.Title, sourcePreview)
	createdAtUnixMs := time.Now().UnixMilli()
	operation, err := db.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID:           "fork_" + destinationID,
		EndpointID:            endpointID,
		SourceThreadID:        sourceThreadID,
		DestinationThreadID:   destinationID,
		Title:                 title,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       createdAtUnixMs,
	})
	if err != nil {
		return nil, err
	}
	forked, err := s.resumeThreadForkOperation(ctx, db, operation)
	if err != nil {
		return nil, err
	}
	return s.GetThread(ctx, meta, forked.ThreadID)
}

func (s *Service) forkFloretThread(ctx context.Context, operationID string, sourceThreadID string, destinationThreadID string) (flruntime.ForkThreadResult, error) {
	if s == nil {
		return flruntime.ForkThreadResult{}, errors.New("nil service")
	}
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		return flruntime.ForkThreadResult{}, err
	}
	return forkFloretThreadWithHost(ctx, host, operationID, sourceThreadID, destinationThreadID)
}

func forkFloretThreadWithHost(ctx context.Context, host floretForkHost, operationID string, sourceThreadID string, destinationThreadID string) (flruntime.ForkThreadResult, error) {
	if host == nil {
		return flruntime.ForkThreadResult{}, errors.New("Floret fork host unavailable")
	}
	return host.ForkThread(ctx, flruntime.ForkThreadRequest{
		OperationID:         flruntime.ForkOperationID(strings.TrimSpace(operationID)),
		SourceThreadID:      flruntime.ThreadID(strings.TrimSpace(sourceThreadID)),
		DestinationThreadID: flruntime.ThreadID(strings.TrimSpace(destinationThreadID)),
	})
}

func threadstoreForkTurnRefs(refs []flruntime.ForkedTurnRef) []threadstore.ForkTurnRef {
	if len(refs) == 0 {
		return nil
	}
	out := make([]threadstore.ForkTurnRef, 0, len(refs))
	for _, ref := range refs {
		var createdAtUnixMs int64
		if !ref.CreatedAt.IsZero() {
			createdAtUnixMs = ref.CreatedAt.UnixMilli()
		}
		out = append(out, threadstore.ForkTurnRef{
			SourceTurnID:      string(ref.SourceTurnID),
			SourceRunID:       string(ref.SourceRunID),
			DestinationTurnID: string(ref.DestinationTurnID),
			DestinationRunID:  string(ref.DestinationRunID),
			CreatedAtUnixMs:   createdAtUnixMs,
		})
	}
	return out
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

func normalizeForkThreadTitle(requested string, sourceTitle string, sourcePreview string) string {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		return truncateRunes(requested, 200)
	}
	base := firstNonEmpty(strings.TrimSpace(sourceTitle), strings.TrimSpace(sourcePreview), "Untitled conversation")
	suffix := " (fork)"
	maxBase := 200 - len(suffix)
	if maxBase < 1 {
		return truncateRunes(base, 200)
	}
	return truncateRunes(base, maxBase) + suffix
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
	db := s.threadsDB
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
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
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
	}
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

	reasoningCapability, modelDefaultReasoning, _ := s.threadReasoningDefaults(ctx, modelID)
	normalizedReasoning, _, err := normalizeReasoningForModelSwitch(reasoningCapability, unmarshalReasoningSelection(th.ReasoningSelectionJSON), modelDefaultReasoning)
	if err != nil {
		return reasoningSelectionError(modelID, err)
	}
	if err := config.ValidateAIReasoningSelection(reasoningCapability, normalizedReasoning); err != nil {
		return reasoningSelectionError(modelID, err)
	}
	if err := db.UpdateThreadModelAndReasoningSelection(ctx, endpointID, threadID, modelID, marshalReasoningSelection(normalizedReasoning)); err != nil {
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
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
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
	capability, modelDefault, _ := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
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
	if err := db.UpdateThreadReasoningSelection(ctx, endpointID, threadID, marshalReasoningSelection(normalized)); err != nil {
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
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
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

	s.mu.Lock()
	db := s.threadsDB
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}

	permissionFallback := FlowerPermissionApprovalRequired
	if cfg != nil {
		if p, err := normalizePermissionType(cfg.EffectivePermissionType(), permissionFallback); err == nil {
			permissionFallback = p
		}
	}
	normalizedPermissionType, err := normalizePermissionType(strings.TrimSpace(permissionType), permissionFallback)
	if err != nil {
		return err
	}

	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
	}
	currentPermissionType, err := normalizePermissionType(strings.TrimSpace(th.PermissionType), "")
	if err != nil {
		currentPermissionType = permissionFallback
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

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if runID != "" {
		return s.CancelRun(meta, runID)
	}
	if s.idleThreadCompactionRequestID(endpointID, threadID) != "" {
		_, err := s.StopThread(context.Background(), meta, threadID)
		return err
	}

	s.closeThreadSubagents(context.Background(), endpointID, threadID, persistTO)
	s.broadcastThreadSummary(endpointID, threadID)
	return nil
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
	runID := strings.TrimSpace(s.activeRunByTh[thKey])
	finalizingRunID := strings.TrimSpace(s.stopFinalizingByTh[thKey])
	r := s.runs[runID]
	idleCompaction := s.idleCompactionByTh[thKey]
	if idleCompaction != nil && idleCompaction.isCancelled() {
		idleCompaction = nil
	}
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
	existingCtx, existingCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	existingOperation, err := db.GetThreadDeleteOperation(existingCtx, endpointID, threadID)
	existingCancel()
	if err != nil {
		return ThreadDeleteResult{}, err
	}
	if existingOperation != nil {
		operation, replayErr := s.replayThreadDeleteOperation(ctx, *existingOperation)
		return threadDeleteResult(operation), replayErr
	}
	loadCtx, loadCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	th, err := db.GetThread(loadCtx, endpointID, threadID)
	loadCancel()
	if err != nil {
		return ThreadDeleteResult{}, err
	}
	if th == nil {
		return ThreadDeleteResult{}, sql.ErrNoRows
	}

	if runID != "" {
		if !force {
			return ThreadDeleteResult{}, ErrThreadBusy
		}
		// Force delete must be able to unblock a stuck run:
		// - best-effort cancel the run
		// - detach in-memory active mappings immediately
		// - delete the thread without waiting for graceful shutdown
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
	}
	if runID == "" && finalizingRunID != "" {
		if !force {
			return ThreadDeleteResult{}, ErrThreadBusy
		}
		s.mu.Lock()
		if strings.TrimSpace(s.stopFinalizingByTh[thKey]) == finalizingRunID {
			delete(s.stopFinalizingByTh, thKey)
		}
		s.mu.Unlock()
	}
	if idleCompaction != nil {
		if !force {
			return ThreadDeleteResult{}, ErrThreadBusy
		}
		s.cancelIdleThreadCompactionWithBroadcast(endpointID, threadID)
	}

	deleteCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	operation, err := db.PrepareThreadDeleteOperation(deleteCtx, endpointID, threadID, readStateRequired)
	cancel()
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
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, sql.ErrNoRows
	}

	host, err := s.openFloretMaintenanceHost()
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
