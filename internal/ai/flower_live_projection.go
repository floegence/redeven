package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/session"
)

const flowerLiveUpdateBufferLimit = 500

type flowerLiveThreadBuffer struct {
	NextSeq int64
	Updates []FlowerThreadLiveUpdate
}

type activeRunMessageSnapshot struct {
	MessageJSON json.RawMessage
}

func (s *Service) GetFlowerThreadLiveSnapshot(ctx context.Context, meta *session.Meta, threadID string) (*FlowerThreadLiveSnapshot, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	thread, err := s.GetThread(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	if thread == nil {
		return nil, sql.ErrNoRows
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	msgs, _, _, err := db.ListMessages(ctx, endpointID, threadID, 200, 0)
	if err != nil {
		return nil, err
	}
	messages := make([]json.RawMessage, 0, len(msgs))
	for _, msg := range msgs {
		safe, err := SanitizeActivityTimelineMessageJSON(msg.MessageJSON)
		if err != nil {
			return nil, err
		}
		if len(safe) == 0 {
			continue
		}
		messages = append(messages, safe)
	}

	activeRun := s.activeFlowerRunSnapshot(meta, *thread)
	cursor := s.flowerLiveCursor(endpointID, threadID)
	if activeRun != nil && activeRun.LastEventSeq > cursor {
		cursor = activeRun.LastEventSeq
	}

	return &FlowerThreadLiveSnapshot{
		SchemaVersion: FlowerLiveSchemaVersion,
		Thread:        *thread,
		Messages:      messages,
		ActiveRun:     activeRun,
		EventCursor:   cursor,
		GeneratedAtMs: time.Now().UnixMilli(),
	}, nil
}

func (s *Service) ListFlowerThreadLiveUpdates(ctx context.Context, meta *session.Meta, threadID string, afterSeq int64, limit int) (*FlowerThreadLiveUpdatesResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	if afterSeq < 0 {
		afterSeq = 0
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	buf := s.flowerLiveByThread[threadKey]
	if buf == nil {
		s.mu.Unlock()
		if afterSeq > 0 {
			update := FlowerThreadLiveUpdate{
				SchemaVersion: FlowerLiveSchemaVersion,
				Seq:           afterSeq + 1,
				EndpointID:    endpointID,
				ThreadID:      threadID,
				Kind:          FlowerLiveResyncRequired,
				AtUnixMs:      time.Now().UnixMilli(),
				ResyncReason:  "cursor_expired",
			}
			return &FlowerThreadLiveUpdatesResponse{Updates: []FlowerThreadLiveUpdate{update}, NextCursor: update.Seq}, nil
		}
		return &FlowerThreadLiveUpdatesResponse{Updates: []FlowerThreadLiveUpdate{}, NextCursor: 0}, nil
	}
	nextSeq := buf.NextSeq
	firstSeq := int64(0)
	if len(buf.Updates) > 0 {
		firstSeq = buf.Updates[0].Seq
	}
	if afterSeq > 0 && firstSeq > 0 && afterSeq < firstSeq {
		update := FlowerThreadLiveUpdate{
			SchemaVersion: FlowerLiveSchemaVersion,
			Seq:           nextSeq,
			EndpointID:    endpointID,
			ThreadID:      threadID,
			Kind:          FlowerLiveResyncRequired,
			AtUnixMs:      time.Now().UnixMilli(),
			ResyncReason:  "cursor_expired",
		}
		s.mu.Unlock()
		return &FlowerThreadLiveUpdatesResponse{Updates: []FlowerThreadLiveUpdate{update}, NextCursor: nextSeq}, nil
	}
	updates := make([]FlowerThreadLiveUpdate, 0, limit)
	for _, update := range buf.Updates {
		if update.Seq <= afterSeq {
			continue
		}
		updates = append(updates, update)
		if len(updates) >= limit {
			break
		}
	}
	hasMore := false
	if len(updates) > 0 {
		lastSeq := updates[len(updates)-1].Seq
		for _, update := range buf.Updates {
			if update.Seq > lastSeq {
				hasMore = true
				break
			}
		}
	}
	cursor := afterSeq
	if len(updates) > 0 {
		cursor = updates[len(updates)-1].Seq
	} else if nextSeq > 0 {
		cursor = nextSeq - 1
	}
	s.mu.Unlock()

	return &FlowerThreadLiveUpdatesResponse{Updates: updates, NextCursor: cursor, HasMore: hasMore}, nil
}

func (s *Service) SubmitFlowerApproval(meta *session.Meta, req SubmitFlowerApprovalRequest) (*SubmitFlowerApprovalResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	runID := strings.TrimSpace(req.RunID)
	toolID := strings.TrimSpace(req.ToolID)
	actionID := strings.TrimSpace(req.ActionID)
	threadID := strings.TrimSpace(req.ThreadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || runID == "" || toolID == "" || actionID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	s.mu.Unlock()
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID || strings.TrimSpace(r.threadID) != threadID || r.isDetached() {
		return nil, errors.New("run not found")
	}
	if req.ExpectedSeq > 0 && cursor > 0 && req.ExpectedSeq < cursor {
		return nil, ErrRunChanged
	}
	if strings.TrimSpace(r.userPublicID) != strings.TrimSpace(meta.UserPublicID) {
		return nil, errors.New("run not found")
	}

	approval, ok := r.snapshotToolApproval(toolID)
	if !ok {
		return nil, errors.New("approval no longer pending")
	}
	if approval.ActionID != actionID {
		return nil, errors.New("approval action mismatch")
	}
	if req.Revision > 0 && approval.Revision > 0 && req.Revision != approval.Revision {
		return nil, ErrRunChanged
	}
	if !approval.CanApprove {
		return nil, errors.New(firstNonEmptyString(approval.ReadOnlyReason, "approval is not available"))
	}
	if err := r.approveTool(toolID, req.Approved); err != nil {
		return nil, err
	}
	return &SubmitFlowerApprovalResponse{OK: true}, nil
}

func (s *Service) activeFlowerRunSnapshot(meta *session.Meta, thread ThreadView) *FlowerLiveActiveRun {
	if s == nil || meta == nil {
		return nil
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(thread.ThreadID)
	if endpointID == "" || threadID == "" {
		return nil
	}
	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	s.mu.Unlock()
	if runID == "" || r == nil || r.assistantAlreadyPersisted() {
		return nil
	}
	msg := r.publicActiveRunMessageSnapshot()
	if len(msg.MessageJSON) == 0 {
		return nil
	}
	status := strings.TrimSpace(thread.RunStatus)
	if status == "" || !IsActiveRunState(status) {
		status = string(RunStateRunning)
	}
	waitingPrompt := thread.WaitingPrompt
	if waitingPrompt == nil {
		waitingPrompt = r.snapshotWaitingPrompt()
	}
	approvals := r.snapshotToolApprovals(cursor)
	status = flowerLiveRunStatus(status, len(approvals))
	return &FlowerLiveActiveRun{
		RunID:           runID,
		Status:          status,
		Message:         msg.MessageJSON,
		WaitingPrompt:   waitingPrompt,
		ApprovalActions: approvals,
		LastEventSeq:    cursor,
	}
}

func (r *run) activeRunMessageSnapshot() activeRunMessageSnapshot {
	if r == nil || r.assistantAlreadyPersisted() {
		return activeRunMessageSnapshot{}
	}
	msgJSON, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err != nil || strings.TrimSpace(msgJSON) == "" {
		return activeRunMessageSnapshot{}
	}
	return activeRunMessageSnapshot{
		MessageJSON: json.RawMessage(msgJSON),
	}
}

func (r *run) publicActiveRunMessageSnapshot() activeRunMessageSnapshot {
	msg := r.activeRunMessageSnapshot()
	if len(msg.MessageJSON) == 0 {
		return activeRunMessageSnapshot{}
	}
	safe, err := SanitizeActivityTimelineMessageJSON(string(msg.MessageJSON))
	if err != nil || len(safe) == 0 {
		return activeRunMessageSnapshot{}
	}
	return activeRunMessageSnapshot{MessageJSON: safe}
}

func (s *Service) flowerLiveCursor(endpointID string, threadID string) int64 {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flowerLiveCursorLocked(endpointID, threadID)
}

func (s *Service) flowerLiveCursorLocked(endpointID string, threadID string) int64 {
	if s == nil {
		return 0
	}
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return 0
	}
	buf := s.flowerLiveByThread[threadKey]
	if buf == nil || buf.NextSeq <= 0 {
		return 0
	}
	return buf.NextSeq - 1
}

func (s *Service) appendFlowerLiveUpdate(update FlowerThreadLiveUpdate) FlowerThreadLiveUpdate {
	if s == nil {
		return update
	}
	update.EndpointID = strings.TrimSpace(update.EndpointID)
	update.ThreadID = strings.TrimSpace(update.ThreadID)
	if update.EndpointID == "" || update.ThreadID == "" || update.Kind == "" {
		return update
	}
	if update.AtUnixMs <= 0 {
		update.AtUnixMs = time.Now().UnixMilli()
	}
	update.SchemaVersion = FlowerLiveSchemaVersion
	threadKey := runThreadKey(update.EndpointID, update.ThreadID)
	if threadKey == "" {
		return update
	}

	s.mu.Lock()
	buf := s.flowerLiveByThread[threadKey]
	if buf == nil {
		buf = &flowerLiveThreadBuffer{NextSeq: 1, Updates: make([]FlowerThreadLiveUpdate, 0, 64)}
		s.flowerLiveByThread[threadKey] = buf
	}
	update.Seq = buf.NextSeq
	buf.NextSeq++
	buf.Updates = append(buf.Updates, update)
	if len(buf.Updates) > flowerLiveUpdateBufferLimit {
		copy(buf.Updates, buf.Updates[len(buf.Updates)-flowerLiveUpdateBufferLimit:])
		buf.Updates = buf.Updates[:flowerLiveUpdateBufferLimit]
	}
	s.mu.Unlock()
	return update
}

func (s *Service) replaceLatestFlowerLiveUpdate(update FlowerThreadLiveUpdate) {
	if s == nil || update.Seq <= 0 {
		return
	}
	threadKey := runThreadKey(update.EndpointID, update.ThreadID)
	if threadKey == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := s.flowerLiveByThread[threadKey]
	if buf == nil || len(buf.Updates) == 0 {
		return
	}
	index := len(buf.Updates) - 1
	if buf.Updates[index].Seq == update.Seq {
		buf.Updates[index] = update
	}
}

func approvalActionsWithExpectedSeq(actions []FlowerApprovalAction, expectedSeq int64) []FlowerApprovalAction {
	if len(actions) == 0 || expectedSeq <= 0 {
		return actions
	}
	out := make([]FlowerApprovalAction, len(actions))
	copy(out, actions)
	for i := range out {
		out[i].ExpectedSeq = expectedSeq
	}
	return out
}

func (s *Service) publishFlowerLiveUpdateFromRealtime(ev RealtimeEvent) {
	if s == nil {
		return
	}
	update := FlowerThreadLiveUpdate{
		EndpointID: strings.TrimSpace(ev.EndpointID),
		ThreadID:   strings.TrimSpace(ev.ThreadID),
		AtUnixMs:   ev.AtUnixMs,
	}
	switch ev.EventType {
	case RealtimeEventTypeTranscript:
		update.Kind = FlowerLiveMessageAppended
		update.Message = ev.MessageJSON
		update.ClearActiveRun = strings.TrimSpace(ev.RunID) != ""
	case RealtimeEventTypeTranscriptReset:
		update.Kind = FlowerLiveResyncRequired
		update.ResyncReason = "transcript_reset"
	case RealtimeEventTypeThreadState, RealtimeEventTypeThreadSummary:
		update.Kind = FlowerLiveThreadPatched
	default:
		update.Kind = FlowerLiveActiveRunPatched
	}
	if update.Kind == FlowerLiveActiveRunPatched || ev.EventType == RealtimeEventTypeThreadState {
		if active := s.activeRunFromRealtime(ev); active != nil {
			update.ActiveRun = active
		}
	}
	if update.Kind == FlowerLiveThreadPatched {
		if thread := s.threadViewFromRealtime(ev); thread != nil {
			update.Thread = thread
		}
	}
	update = s.appendFlowerLiveUpdate(update)
	if update.ActiveRun != nil {
		update.ActiveRun.LastEventSeq = update.Seq
		update.ActiveRun.ApprovalActions = approvalActionsWithExpectedSeq(update.ActiveRun.ApprovalActions, update.Seq)
		s.replaceLatestFlowerLiveUpdate(update)
	}
}

func (s *Service) activeRunFromRealtime(ev RealtimeEvent) *FlowerLiveActiveRun {
	if s == nil {
		return nil
	}
	endpointID := strings.TrimSpace(ev.EndpointID)
	threadID := strings.TrimSpace(ev.ThreadID)
	runID := strings.TrimSpace(ev.RunID)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	s.mu.Lock()
	r := s.runs[runID]
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	s.mu.Unlock()
	if r == nil || r.assistantAlreadyPersisted() {
		return nil
	}
	msg := r.publicActiveRunMessageSnapshot()
	if len(msg.MessageJSON) == 0 {
		return nil
	}
	status := strings.TrimSpace(ev.RunStatus)
	if status == "" {
		status = string(RunStateRunning)
	}
	approvals := r.snapshotToolApprovals(cursor)
	return &FlowerLiveActiveRun{
		RunID:           runID,
		Status:          flowerLiveRunStatus(status, len(approvals)),
		Message:         msg.MessageJSON,
		WaitingPrompt:   firstNonNilWaitingPrompt(ev.WaitingPrompt, r.snapshotWaitingPrompt()),
		ApprovalActions: approvals,
		LastEventSeq:    cursor,
	}
}

func firstNonNilWaitingPrompt(values ...*RequestUserInputPrompt) *RequestUserInputPrompt {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func (s *Service) threadViewFromRealtime(ev RealtimeEvent) *ThreadView {
	if s == nil || strings.TrimSpace(ev.EndpointID) == "" || strings.TrimSpace(ev.ThreadID) == "" {
		return nil
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return nil
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	meta := &session.Meta{EndpointID: strings.TrimSpace(ev.EndpointID), CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := s.GetThread(ctx, meta, strings.TrimSpace(ev.ThreadID))
	if err != nil || thread == nil {
		return nil
	}
	return thread
}

func flowerLiveRunStatus(status string, approvalCount int) string {
	status = strings.TrimSpace(status)
	if approvalCount > 0 {
		return string(RunStateWaitingApproval)
	}
	if status == "" || !IsActiveRunState(status) {
		return string(RunStateRunning)
	}
	return status
}

func (r *run) snapshotToolApprovals(expectedSeq int64) []FlowerApprovalAction {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	out := make([]FlowerApprovalAction, 0, len(r.toolApprovals))
	for toolID, approval := range r.toolApprovals {
		toolID = strings.TrimSpace(toolID)
		if toolID == "" || approval == nil || approval.resolved {
			continue
		}
		action := r.toolApprovalActionLocked(toolID, approval)
		if expectedSeq > 0 {
			action.ExpectedSeq = expectedSeq
		}
		out = append(out, action)
	}
	r.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		return out[i].ToolID < out[j].ToolID
	})
	return out
}

func (r *run) snapshotToolApproval(toolID string) (FlowerApprovalAction, bool) {
	if r == nil {
		return FlowerApprovalAction{}, false
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return FlowerApprovalAction{}, false
	}
	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil || approval.resolved {
		r.mu.Unlock()
		return FlowerApprovalAction{}, false
	}
	action := r.toolApprovalActionLocked(toolID, approval)
	r.mu.Unlock()
	return action, true
}

func (r *run) toolApprovalActionLocked(toolID string, approval *toolApprovalRequest) FlowerApprovalAction {
	toolName := strings.TrimSpace(approval.toolName)
	if toolName == "" {
		toolName = "tool"
	}
	return FlowerApprovalAction{
		ActionID:      flowerApprovalActionID(r.id, toolID),
		RunID:         strings.TrimSpace(r.id),
		TurnID:        strings.TrimSpace(r.messageID),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         FlowerApprovalStateRequested,
		Status:        FlowerApprovalStatusPending,
		Revision:      1,
		RequestedAtMs: approval.requestedAtMs,
		ExpiresAtMs:   approval.expiresAtMs,
		CanApprove:    true,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalLabel(toolName),
			Description: "Review this tool before it runs.",
			Effects:     toolApprovalEffects(toolName),
		},
	}
}

func flowerApprovalActionID(runID string, toolID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(toolID)))
	return "appr_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func toolApprovalLabel(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return "Tool approval"
	}
	return toolName
}

func toolApprovalEffects(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []string{"shell"}
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}
	case "web.search":
		return []string{"network"}
	default:
		return []string{"tool"}
	}
}

func liveMessageValuesFromSnapshot(snapshot *FlowerThreadLiveSnapshot) []any {
	if snapshot == nil {
		return nil
	}
	values := make([]any, 0, len(snapshot.Messages)+1)
	for _, msg := range snapshot.Messages {
		if len(msg) > 0 {
			values = append(values, msg)
		}
	}
	if snapshot.ActiveRun != nil && len(snapshot.ActiveRun.Message) > 0 {
		values = append(values, snapshot.ActiveRun.Message)
	}
	return values
}
