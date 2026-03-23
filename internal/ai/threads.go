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

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/pathutil"
	"github.com/floegence/redeven-agent/internal/session"
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

func normalizeThreadRunState(status string, runError string) (string, string) {
	s := NormalizeRunState(status)
	runError = strings.TrimSpace(runError)
	switch s {
	case RunStateFailed, RunStateTimedOut:
		return string(s), runError
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateFinalizing, RunStateWaitingUser, RunStateSuccess, RunStateCanceled:
		return string(s), ""
	default:
		return string(RunStateIdle), ""
	}
}

func activeThreadEffectiveRunState(status string, runError string) (string, string) {
	runStatus, _ := normalizeThreadRunState(status, runError)
	if IsActiveRunState(runStatus) {
		return runStatus, ""
	}
	return string(RunStateRunning), ""
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
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
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
	queuedTurnCount, err := db.CountFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	if err != nil {
		return nil, err
	}

	runStatus, runError := normalizeThreadRunState(th.RunStatus, th.RunError)
	if s.HasActiveThreadForEndpoint(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(th.ThreadID)) {
		runStatus, runError = activeThreadEffectiveRunState(th.RunStatus, th.RunError)
	}

	workingDir := strings.TrimSpace(th.WorkingDir)
	if workingDir == "" {
		workingDir = strings.TrimSpace(s.agentHomeDir)
	}

	return &ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               strings.TrimSpace(th.Title),
		ModelID:             strings.TrimSpace(th.ModelID),
		ModelLocked:         th.ModelLocked,
		ExecutionMode:       normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback),
		WorkingDir:          workingDir,
		QueuedTurnCount:     queuedTurnCount,
		RunStatus:           runStatus,
		RunUpdatedAtUnixMs:  th.RunUpdatedAtUnixMs,
		RunError:            runError,
		WaitingPrompt:       s.threadWaitingPrompt(ctx, th, runStatus),
		CreatedAtUnixMs:     th.CreatedAtUnixMs,
		UpdatedAtUnixMs:     th.UpdatedAtUnixMs,
		LastMessageAtUnixMs: th.LastMessageAtUnixMs,
		LastMessagePreview:  strings.TrimSpace(th.LastMessagePreview),
	}, nil
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
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
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
	out := &ListThreadsResponse{Threads: make([]ThreadView, 0, len(list)), NextCursor: strings.TrimSpace(next)}
	for _, t := range list {
		runStatus, runError := normalizeThreadRunState(t.RunStatus, t.RunError)
		if _, ok := activeThreads[strings.TrimSpace(t.ThreadID)]; ok {
			runStatus, runError = activeThreadEffectiveRunState(t.RunStatus, t.RunError)
		}
		workingDir := strings.TrimSpace(t.WorkingDir)
		if workingDir == "" {
			workingDir = strings.TrimSpace(s.agentHomeDir)
		}
		out.Threads = append(out.Threads, ThreadView{
			ThreadID:            strings.TrimSpace(t.ThreadID),
			Title:               strings.TrimSpace(t.Title),
			ModelID:             strings.TrimSpace(t.ModelID),
			ModelLocked:         t.ModelLocked,
			ExecutionMode:       normalizeRunMode(strings.TrimSpace(t.ExecutionMode), modeFallback),
			WorkingDir:          workingDir,
			QueuedTurnCount:     queuedTurnCounts[strings.TrimSpace(t.ThreadID)],
			RunStatus:           runStatus,
			RunUpdatedAtUnixMs:  t.RunUpdatedAtUnixMs,
			RunError:            runError,
			WaitingPrompt:       s.threadWaitingPrompt(ctx, &t, runStatus),
			CreatedAtUnixMs:     t.CreatedAtUnixMs,
			UpdatedAtUnixMs:     t.UpdatedAtUnixMs,
			LastMessageAtUnixMs: t.LastMessageAtUnixMs,
			LastMessagePreview:  strings.TrimSpace(t.LastMessagePreview),
		})
	}
	return out, nil
}

func (s *Service) CreateThread(ctx context.Context, meta *session.Meta, title string, modelID string, executionMode string, workingDir string) (*ThreadView, error) {
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

	modelID = strings.TrimSpace(modelID)
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	executionMode = normalizeRunMode(strings.TrimSpace(executionMode), modeFallback)
	if modelID != "" {
		if _, _, ok := strings.Cut(modelID, "/"); !ok {
			return nil, errors.New("invalid model")
		}
		if cfg != nil && !cfg.IsAllowedModelID(modelID) {
			return nil, fmt.Errorf("model not allowed: %s", modelID)
		}
	}
	if modelID == "" && cfg != nil {
		if id, ok := cfg.ResolvedCurrentModelID(); ok {
			modelID = id
		}
	}

	fallbackWorkingDir := strings.TrimSpace(s.agentHomeDir)
	workingDir = strings.TrimSpace(workingDir)
	if workingDir == "" {
		workingDir = fallbackWorkingDir
	}
	workingDirClean, err := validateThreadWorkingDir(workingDir, strings.TrimSpace(s.agentHomeDir))
	if err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()
	t := threadstore.Thread{
		ThreadID:              id,
		EndpointID:            strings.TrimSpace(meta.EndpointID),
		NamespacePublicID:     strings.TrimSpace(meta.NamespacePublicID),
		ModelID:               modelID,
		ExecutionMode:         executionMode,
		WorkingDir:            workingDirClean,
		Title:                 strings.TrimSpace(title),
		RunStatus:             "idle",
		RunUpdatedAtUnixMs:    0,
		RunError:              "",
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		UpdatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       now,
		UpdatedAtUnixMs:       now,
		LastMessageAtUnixMs:   0,
		LastMessagePreview:    "",
	}
	if err := db.CreateThread(ctx, t); err != nil {
		return nil, err
	}

	return &ThreadView{
		ThreadID:            id,
		Title:               strings.TrimSpace(t.Title),
		ModelID:             modelID,
		ModelLocked:         false,
		ExecutionMode:       executionMode,
		WorkingDir:          workingDirClean,
		QueuedTurnCount:     0,
		RunStatus:           "idle",
		RunUpdatedAtUnixMs:  0,
		RunError:            "",
		WaitingPrompt:       nil,
		CreatedAtUnixMs:     t.CreatedAtUnixMs,
		UpdatedAtUnixMs:     t.UpdatedAtUnixMs,
		LastMessageAtUnixMs: 0,
		LastMessagePreview:  "",
	}, nil
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
	return validateThreadWorkingDir(workingDir, fallbackWorkingDir)
}

func validateThreadWorkingDir(workingDir string, agentHomeDir string) (string, error) {
	if strings.TrimSpace(workingDir) == "" {
		return "", errors.New("missing working_dir")
	}
	resolved, err := pathutil.ResolveExistingScopedDir(workingDir, agentHomeDir)
	if err != nil {
		msg := strings.TrimSpace(err.Error())
		switch {
		case msg == "path must be absolute":
			return "", errors.New("working_dir must be absolute")
		case msg == "path escapes agent home":
			return "", errors.New("working_dir must stay within agent home")
		case errors.Is(err, os.ErrNotExist):
			return "", errors.New("working_dir does not exist")
		case msg == "path must be a directory":
			return "", errors.New("working_dir must be a directory")
		default:
			return "", errors.New("working_dir is not accessible")
		}
	}
	return resolved, nil
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
	if strings.TrimSpace(threadID) == "" {
		return errors.New("missing thread_id")
	}
	if err := db.RenameThread(ctx, meta.EndpointID, threadID, title, meta.UserPublicID, meta.UserEmail); err != nil {
		return err
	}
	s.broadcastThreadSummary(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(threadID))
	return nil
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
	if _, _, ok := strings.Cut(modelID, "/"); !ok {
		return errors.New("invalid model")
	}

	s.mu.Lock()
	db := s.threadsDB
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if cfg == nil {
		return ErrNotConfigured
	}
	if !cfg.IsAllowedModelID(modelID) {
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
	if th.ModelLocked {
		return ErrModelSwitchRequiresExplicitRestart
	}
	if s.HasActiveThreadForEndpoint(endpointID, threadID) {
		return ErrModelSwitchRequiresExplicitRestart
	}

	if err := db.UpdateThreadModelID(ctx, endpointID, threadID, modelID); err != nil {
		return err
	}
	s.broadcastThreadSummary(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))
	return nil
}

func (s *Service) SetThreadExecutionMode(ctx context.Context, meta *session.Meta, threadID string, executionMode string) error {
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

	fallbackMode := "act"
	if cfg != nil {
		fallbackMode = cfg.EffectiveMode()
	}
	executionMode = normalizeRunMode(strings.TrimSpace(executionMode), fallbackMode)

	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return sql.ErrNoRows
	}
	currentMode := normalizeRunMode(strings.TrimSpace(th.ExecutionMode), fallbackMode)
	if currentMode == executionMode {
		return nil
	}
	if err := db.UpdateThreadExecutionMode(ctx, endpointID, threadID, executionMode); err != nil {
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
	if runID != "" {
		return s.CancelRun(meta, runID)
	}

	// Best-effort: if the thread was stuck in a running state without an active in-memory run,
	// allow the user to unblock the UI by marking it canceled.
	if db != nil {
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, "canceled", "", "", meta.UserPublicID, meta.UserEmail)
		cancel()
		s.broadcastThreadSummary(endpointID, threadID)
	}
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

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
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
		if strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)]) == runID {
			delete(s.activeRunByTh, runThreadKey(endpointID, threadID))
		}
		s.mu.Unlock()
	}

	return db.DeleteThread(ctx, endpointID, threadID)
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

	msgs, nextBeforeID, hasMore, err := db.ListMessages(ctx, meta.EndpointID, threadID, limit, beforeID)
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
		raw := strings.TrimSpace(m.MessageJSON)
		if raw == "" {
			continue
		}
		out.Messages = append(out.Messages, json.RawMessage(raw))
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
