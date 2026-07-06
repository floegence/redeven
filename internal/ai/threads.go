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

func newUserMessageID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "u_ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func normalizeThreadRunState(status string, runErrorCode string, runError string) (string, string, string) {
	s := NormalizeRunState(status)
	runErrorCode = strings.TrimSpace(runErrorCode)
	runError = strings.TrimSpace(runError)
	switch s {
	case RunStateFailed, RunStateTimedOut:
		return string(s), runErrorCode, runError
	case RunStateCanceled:
		if runErrorCode == threadstore.RuntimeRestartedRunErrorCode {
			return string(s), runErrorCode, runError
		}
		return string(s), "", ""
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateFinalizing, RunStateWaitingUser, RunStateSuccess:
		return string(s), "", ""
	default:
		return string(RunStateIdle), "", ""
	}
}

func threadPermissionTypeString(th *threadstore.Thread, modeFallback string) string {
	if th == nil {
		return permissionTypeString(FlowerPermissionApprovalRequired)
	}
	permissionType, err := normalizePermissionType(strings.TrimSpace(th.PermissionType), "")
	if err == nil {
		return permissionTypeString(permissionType)
	}
	return permissionTypeString(FlowerPermissionApprovalRequired)
}

func activeThreadEffectiveRunState(status string, runErrorCode string, runError string) (string, string, string) {
	runStatus, _, _ := normalizeThreadRunState(status, runErrorCode, runError)
	if IsActiveRunState(runStatus) {
		return runStatus, "", ""
	}
	return string(RunStateRunning), "", ""
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

func (s *Service) threadViewFromRecord(ctx context.Context, th *threadstore.Thread, flowerMeta *threadstore.FlowerThreadMetadata, queuedTurnCount int, active bool) ThreadView {
	if th == nil {
		return ThreadView{}
	}
	runStatus, runErrorCode, runError := normalizeThreadRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	if active {
		runStatus, runErrorCode, runError = activeThreadEffectiveRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	}
	workingDir := strings.TrimSpace(th.WorkingDir)
	if workingDir == "" && s != nil {
		workingDir = strings.TrimSpace(s.agentHomeDir)
	}
	capability, _, _ := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
	view := ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               strings.TrimSpace(th.Title),
		ModelID:             strings.TrimSpace(th.ModelID),
		PermissionType:      threadPermissionTypeString(th, ""),
		WorkingDir:          workingDir,
		QueuedTurnCount:     queuedTurnCount,
		RunStatus:           runStatus,
		RunUpdatedAtUnixMs:  th.RunUpdatedAtUnixMs,
		RunErrorCode:        runErrorCode,
		RunError:            runError,
		WaitingPrompt:       s.threadWaitingPrompt(ctx, th, runStatus),
		LastContextRunID:    strings.TrimSpace(th.LastContextRunID),
		ReasoningSelection:  unmarshalReasoningSelection(th.ReasoningSelectionJSON),
		ReasoningCapability: capability,
		PinnedAtUnixMs:      th.PinnedAtUnixMs,
		CreatedAtUnixMs:     th.CreatedAtUnixMs,
		UpdatedAtUnixMs:     th.UpdatedAtUnixMs,
		LastMessageAtUnixMs: th.LastMessageAtUnixMs,
		LastMessagePreview:  strings.TrimSpace(th.LastMessagePreview),
		FlowerActivity: FlowerThreadReadSnapshot{
			ActivityRevision:    th.FlowerActivityRevision,
			LastMessageAtUnixMs: th.LastMessageAtUnixMs,
			ActivitySignature:   strings.TrimSpace(th.FlowerActivitySignature),
			WaitingPromptID:     strings.TrimSpace(th.FlowerActivityWaitingPromptID),
		},
	}
	applyFlowerThreadMetadataView(&view, flowerMeta)
	return view
}

func (s *Service) threadReasoningDefaults(ctx context.Context, modelID string) (config.AIReasoningCapability, config.AIReasoningSelection, bool) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || s == nil {
		return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
	}
	s.mu.Lock()
	cfg := s.cfg
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	if capability, selection, ok := modelReasoningDefaultsFromConfig(cfg, modelID); ok {
		return capability, selection, true
	}
	if isDesktopModelSourceModelID(modelID) && modelSource != nil {
		checkCtx := ctx
		if checkCtx == nil {
			checkCtx = context.Background()
		}
		snapshot, err := modelSource.ListModels(checkCtx)
		if err == nil && snapshot != nil {
			for _, model := range snapshot.Models {
				if strings.TrimSpace(model.ID) != modelID {
					continue
				}
				capability := model.ReasoningCapability.Normalize()
				if capability.IsZero() {
					return capability, config.AIReasoningSelection{}, true
				}
				if strings.TrimSpace(capability.DefaultLevel) != "" {
					return capability, config.AIReasoningSelection{Level: config.AIReasoningLevel(capability.DefaultLevel)}, true
				}
				return capability, config.AIReasoningSelection{}, true
			}
		}
	}
	return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
}

func (s *Service) requireThreadMutable(ctx context.Context, db *threadstore.Store, endpointID string, threadID string) error {
	if db == nil {
		return errors.New("threads store not ready")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	_ = ctx
	return nil
}

func (s *Service) activeThreadRunSet(endpointID string) map[string]struct{} {
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" || s == nil {
		return map[string]struct{}{}
	}
	prefix := endpointID + ":"
	out := make(map[string]struct{})
	s.mu.Lock()
	for key, runID := range s.activeRunByTh {
		if strings.TrimSpace(runID) == "" {
			continue
		}
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		tid := strings.TrimPrefix(key, prefix)
		tid = strings.TrimSpace(tid)
		if tid == "" {
			continue
		}
		out[tid] = struct{}{}
	}
	s.mu.Unlock()
	return out
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

	view := s.threadViewFromRecord(ctx, th, flowerMeta, queuedTurnCount, s.HasActiveThreadForEndpoint(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(th.ThreadID)))
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
	activeThreads := s.activeThreadRunSet(endpointID)
	flowerMetaByThread := make(map[string]*threadstore.FlowerThreadMetadata, len(threadIDs))
	for _, threadID := range threadIDs {
		meta, err := db.GetFlowerThreadMetadata(ctx, endpointID, threadID)
		if err != nil {
			return nil, err
		}
		if meta != nil {
			flowerMetaByThread[threadID] = meta
		}
	}
	out := &ListThreadsResponse{Threads: make([]ThreadView, 0, len(list)), NextCursor: strings.TrimSpace(next)}
	for _, t := range list {
		_, active := activeThreads[strings.TrimSpace(t.ThreadID)]
		out.Threads = append(out.Threads, s.threadViewFromRecord(ctx, &t, flowerMetaByThread[strings.TrimSpace(t.ThreadID)], queuedTurnCounts[strings.TrimSpace(t.ThreadID)], active))
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
		if cfg != nil && cfg.IsAllowedModelID(modelID) {
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
	if modelID == "" && cfg != nil {
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
		RunStatus:              "idle",
		RunUpdatedAtUnixMs:     0,
		RunError:               "",
		CreatedByUserPublicID:  strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:     strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID:  strings.TrimSpace(meta.UserPublicID),
		UpdatedByUserEmail:     strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:        now,
		UpdatedAtUnixMs:        now,
		LastMessageAtUnixMs:    0,
		LastMessagePreview:     "",
	}
	if err := db.CreateThread(ctx, t); err != nil {
		return nil, err
	}

	view := s.threadViewFromRecord(ctx, &t, nil, 0, false)
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return nil, err
	}
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
	if err := s.requireThreadMutable(ctx, db, endpointID, sourceThreadID); err != nil {
		return nil, err
	}
	if s.HasActiveThreadForEndpoint(endpointID, sourceThreadID) || threadForkBlockedByRunState(source) {
		return nil, ErrThreadForkUnavailable
	}
	destinationID, err := NewThreadID()
	if err != nil {
		return nil, err
	}
	title = normalizeForkThreadTitle(title, source.Title, source.LastMessagePreview)
	floretFork, err := s.forkFloretThread(ctx, sourceThreadID, destinationID)
	if err != nil {
		return nil, err
	}
	forked, err := db.ForkThread(ctx, threadstore.ForkThreadRequest{
		EndpointID:            endpointID,
		SourceThreadID:        sourceThreadID,
		DestinationThreadID:   destinationID,
		Title:                 title,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       time.Now().UnixMilli(),
		FloretTurnRefs:        threadstoreForkTurnRefs(floretFork.Turns),
	})
	if err != nil {
		s.deleteFloretForkThread(context.Background(), destinationID)
		return nil, err
	}
	s.broadcastThreadSummary(endpointID, sourceThreadID)
	s.broadcastThreadSummary(endpointID, destinationID)
	return s.GetThread(ctx, meta, forked.ThreadID)
}

func (s *Service) forkFloretThread(ctx context.Context, sourceThreadID string, destinationThreadID string) (flruntime.ForkThreadResult, error) {
	if s == nil {
		return flruntime.ForkThreadResult{}, errors.New("nil service")
	}
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		return flruntime.ForkThreadResult{}, err
	}
	defer host.Close()
	return host.ForkThread(ctx, flruntime.ForkThreadRequest{
		SourceThreadID:      flruntime.ThreadID(strings.TrimSpace(sourceThreadID)),
		DestinationThreadID: flruntime.ThreadID(strings.TrimSpace(destinationThreadID)),
	})
}

func (s *Service) deleteFloretForkThread(ctx context.Context, destinationThreadID string) {
	if s == nil {
		return
	}
	destinationThreadID = strings.TrimSpace(destinationThreadID)
	if destinationThreadID == "" {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, defaultPersistOpTimeout)
	defer cancel()
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: open Floret maintenance host for fork cleanup failed", "thread_id", destinationThreadID, "error", err)
		}
		return
	}
	defer host.Close()
	if err := host.DeleteThread(cleanupCtx, flruntime.ThreadID(destinationThreadID)); err != nil && s.log != nil {
		s.log.Warn("ai: cleanup Floret fork thread failed", "thread_id", destinationThreadID, "error", err)
	}
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

func threadForkBlockedByRunState(th *threadstore.Thread) bool {
	return threadPreferenceChangeBlockedByRunState(th)
}

func threadPreferenceChangeBlockedByRunState(th *threadstore.Thread) bool {
	if th == nil {
		return false
	}
	if strings.TrimSpace(th.WaitingUserInputJSON) != "" {
		return true
	}
	state := NormalizeRunState(th.RunStatus)
	return IsActiveRunState(string(state)) || state == RunStateWaitingUser
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
	if cfg == nil && !isDesktopModelSourceModelID(modelID) {
		return ErrNotConfigured
	}
	if cfg != nil && cfg.IsAllowedModelID(modelID) {
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
	}
	currentModelID := strings.TrimSpace(th.ModelID)
	if currentModelID == modelID {
		return nil
	}
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionOperation(endpointID, threadID) != "" ||
		threadPreferenceChangeBlockedByRunState(th) {
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
	if err := db.ClearThreadProviderContinuation(ctx, endpointID, threadID); err != nil {
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
	}
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionOperation(endpointID, threadID) != "" ||
		threadPreferenceChangeBlockedByRunState(th) {
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
	}
	if s.HasActiveThreadForEndpoint(endpointID, threadID) ||
		s.idleThreadCompactionOperation(endpointID, threadID) != "" ||
		threadPreferenceChangeBlockedByRunState(th) {
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
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
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
	if err := s.requireThreadMutable(context.Background(), db, endpointID, threadID); err != nil {
		return err
	}
	if runID != "" {
		return s.CancelRun(meta, runID)
	}
	if s.idleThreadCompactionOperation(endpointID, threadID) != "" {
		_, err := s.StopThread(context.Background(), meta, threadID)
		return err
	}

	// Best-effort: if the thread was stuck in a running state without an active in-memory run,
	// allow the user to unblock the UI by marking it canceled.
	if db != nil {
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, "canceled", "", "", "", meta.UserPublicID, meta.UserEmail)
		cancel()
		s.broadcastThreadSummary(endpointID, threadID)
	}
	s.closeThreadSubagents(context.Background(), endpointID, threadID, persistTO)
	return nil
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
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if err := s.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return err
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	loadCtx, loadCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	th, err := db.GetThread(loadCtx, endpointID, threadID)
	loadCancel()
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
	}

	if runID != "" {
		if !force {
			return ErrThreadBusy
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
			return ErrThreadBusy
		}
		s.mu.Lock()
		if strings.TrimSpace(s.stopFinalizingByTh[thKey]) == finalizingRunID {
			delete(s.stopFinalizingByTh, thKey)
		}
		s.mu.Unlock()
	}
	if idleCompaction != nil {
		if !force {
			return ErrThreadBusy
		}
		if compaction, ok := s.cancelIdleThreadCompactionWithBroadcast(endpointID, threadID); ok {
			if compaction.isFinalizing() {
				waitCtx, waitCancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
				waitOK := s.waitIdleThreadCompaction(waitCtx, compaction)
				waitCancel()
				if !waitOK {
					return context.DeadlineExceeded
				}
			}
		}
	}

	if err := s.deleteFloretThreadTree(ctx, meta, *th, persistTO); err != nil {
		return err
	}

	deleteCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	result, err := db.DeleteThreadResources(deleteCtx, endpointID, threadID)
	cancel()
	if err != nil {
		return err
	}
	if _, err := s.processUploadCleanupCandidates(ctx, result.UploadsToDelete); err != nil {
		return err
	}
	s.scheduleThreadstoreCompaction("thread_delete")
	return nil
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
		Messages:      make([]any, 0, len(msgs)),
		NextBeforeID:  nextBeforeID,
		HasMore:       hasMore,
		TotalReturned: len(msgs),
	}
	for _, m := range msgs {
		if len(m.MessageJSON) == 0 {
			continue
		}
		out.Messages = append(out.Messages, m.MessageJSON)
	}
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

	snapshot, err := db.GetThreadTodosSnapshot(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	todos, err := decodeTodoItemsJSON(snapshot.TodosJSON)
	if err != nil {
		return nil, err
	}
	return &ThreadTodosView{
		Version:         snapshot.Version,
		UpdatedAtUnixMs: snapshot.UpdatedAtUnixMs,
		Todos:           append([]TodoItem(nil), todos...),
	}, nil
}

func (s *Service) ListRecentThreadToolCalls(ctx context.Context, meta *session.Meta, threadID string, limit int) ([]threadstore.ToolCallRecord, error) {
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
	return db.ListRecentThreadToolCalls(ctx, endpointID, threadID, limit)
}

func (s *Service) AppendThreadMessage(ctx context.Context, meta *session.Meta, threadID string, role string, text string, format string) error {
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
	if threadID == "" {
		return errors.New("missing thread_id")
	}

	role = strings.TrimSpace(role)
	if role == "" {
		role = "user"
	}
	if role != "user" {
		return fmt.Errorf("unsupported role: %s", role)
	}

	format = strings.TrimSpace(format)
	if format == "" {
		format = "markdown"
	}
	if format != "markdown" && format != "text" {
		return fmt.Errorf("unsupported format: %s", format)
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("missing text")
	}

	id, err := newUserMessageID()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()

	blocks := []any{}
	content := strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if format == "text" {
		blocks = append(blocks, map[string]any{"type": "text", "content": content})
	} else {
		blocks = append(blocks, map[string]any{"type": "markdown", "content": content})
	}
	msg := map[string]any{
		"id":        id,
		"role":      "user",
		"blocks":    blocks,
		"status":    "complete",
		"timestamp": now,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	rowID, err := db.AppendMessage(ctx, meta.EndpointID, threadID, threadstore.Message{
		ThreadID:           threadID,
		EndpointID:         meta.EndpointID,
		MessageID:          id,
		Role:               "user",
		AuthorUserPublicID: strings.TrimSpace(meta.UserPublicID),
		AuthorUserEmail:    strings.TrimSpace(meta.UserEmail),
		Status:             "complete",
		CreatedAtUnixMs:    now,
		UpdatedAtUnixMs:    now,
		TextContent:        strings.TrimSpace(content),
		MessageJSON:        string(b),
	}, meta.UserPublicID, meta.UserEmail)
	if err != nil {
		return err
	}
	s.broadcastTranscriptMessage(meta.EndpointID, threadID, "", rowID, string(b), now)
	s.broadcastThreadSummary(meta.EndpointID, threadID)
	return nil
}

func (s *Service) ListRunEvents(ctx context.Context, meta *session.Meta, runID string, limit int) (*ListRunEventsResponse, error) {
	return s.ListRunEventsWithQuery(ctx, meta, runID, ListRunEventsQuery{
		Limit: limit,
	})
}

type ListRunEventsQuery struct {
	Cursor   int64
	Limit    int
	Category string
}

func (s *Service) ListRunEventsWithQuery(ctx context.Context, meta *session.Meta, runID string, query ListRunEventsQuery) (*ListRunEventsResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, errors.New("missing run_id")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	recs, nextCursor, hasMore, err := db.ListRunEventsPage(ctx, strings.TrimSpace(meta.EndpointID), runID, threadstore.RunEventsQuery{
		Cursor:   query.Cursor,
		Limit:    query.Limit,
		Category: query.Category,
	})
	if err != nil {
		return nil, err
	}
	out := &ListRunEventsResponse{
		Events:     make([]RunEventView, 0, len(recs)),
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}
	for _, rec := range recs {
		payload := any(nil)
		if raw := strings.TrimSpace(rec.PayloadJSON); raw != "" {
			var obj any
			if err := json.Unmarshal([]byte(raw), &obj); err == nil {
				payload = obj
			}
		}
		out.Events = append(out.Events, RunEventView{
			EventID:    rec.ID,
			RunID:      strings.TrimSpace(rec.RunID),
			ThreadID:   strings.TrimSpace(rec.ThreadID),
			StreamKind: strings.TrimSpace(rec.StreamKind),
			EventType:  strings.TrimSpace(rec.EventType),
			AtUnixMs:   rec.AtUnixMs,
			Payload:    payload,
		})
	}
	return out, nil
}
