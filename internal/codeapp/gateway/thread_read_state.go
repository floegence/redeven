package gateway

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codexbridge"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

type flowerThreadUnreadSnapshotView struct {
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	WaitingPromptID     string `json:"waiting_prompt_id,omitempty"`
}

type flowerThreadReadStateView struct {
	LastReadMessageAtUnixMs int64  `json:"last_read_message_at_unix_ms"`
	LastSeenWaitingPromptID string `json:"last_seen_waiting_prompt_id,omitempty"`
}

type flowerThreadReadStatusView struct {
	IsUnread  bool                           `json:"is_unread"`
	Snapshot  flowerThreadUnreadSnapshotView `json:"snapshot"`
	ReadState flowerThreadReadStateView      `json:"read_state"`
}

type aiThreadView struct {
	ai.ThreadView
	ReadStatus flowerThreadReadStatusView `json:"read_status"`
}

type aiListThreadsView struct {
	Threads    []aiThreadView `json:"threads"`
	NextCursor string         `json:"next_cursor,omitempty"`
}

type aiThreadEnvelope struct {
	Thread aiThreadView `json:"thread"`
}

type aiMarkThreadReadRequest struct {
	Snapshot flowerThreadUnreadSnapshotView `json:"snapshot"`
}

type aiMarkThreadReadResponse struct {
	ReadStatus flowerThreadReadStatusView `json:"read_status"`
}

type codexThreadUnreadSnapshotView struct {
	UpdatedAtUnixS    int64  `json:"updated_at_unix_s"`
	ActivitySignature string `json:"activity_signature,omitempty"`
}

type codexThreadReadStateView struct {
	LastReadUpdatedAtUnixS    int64  `json:"last_read_updated_at_unix_s"`
	LastSeenActivitySignature string `json:"last_seen_activity_signature,omitempty"`
}

type codexThreadReadStatusView struct {
	IsUnread  bool                          `json:"is_unread"`
	Snapshot  codexThreadUnreadSnapshotView `json:"snapshot"`
	ReadState codexThreadReadStateView      `json:"read_state"`
}

type codexThreadView struct {
	codexbridge.Thread
	ReadStatus codexThreadReadStatusView `json:"read_status"`
}

type codexThreadDetailView struct {
	Thread            codexThreadView                 `json:"thread"`
	RuntimeConfig     codexbridge.ThreadRuntimeConfig `json:"runtime_config,omitempty"`
	PendingRequests   []codexbridge.PendingRequest    `json:"pending_requests,omitempty"`
	TokenUsage        *codexbridge.ThreadTokenUsage   `json:"token_usage,omitempty"`
	LastAppliedSeq    int64                           `json:"last_applied_seq"`
	ActiveStatus      string                          `json:"active_status,omitempty"`
	ActiveStatusFlags []string                        `json:"active_status_flags,omitempty"`
}

type codexMarkThreadReadRequest struct {
	Snapshot codexThreadUnreadSnapshotView `json:"snapshot"`
}

type codexMarkThreadReadResponse struct {
	ReadStatus codexThreadReadStatusView `json:"read_status"`
}

func (g *Gateway) buildAIListThreadsView(
	ctx context.Context,
	meta *session.Meta,
	out *ai.ListThreadsResponse,
) (*aiListThreadsView, error) {
	if out == nil {
		return &aiListThreadsView{}, nil
	}
	records, err := g.ensureFlowerReadRecords(ctx, meta, out.Threads)
	if err != nil {
		return nil, err
	}
	view := &aiListThreadsView{
		Threads:    make([]aiThreadView, 0, len(out.Threads)),
		NextCursor: strings.TrimSpace(out.NextCursor),
	}
	for _, thread := range out.Threads {
		view.Threads = append(view.Threads, buildAIThreadView(thread, records[strings.TrimSpace(thread.ThreadID)]))
	}
	return view, nil
}

func (g *Gateway) buildAIThreadEnvelope(
	ctx context.Context,
	meta *session.Meta,
	thread *ai.ThreadView,
) (*aiThreadEnvelope, error) {
	if thread == nil {
		return nil, nil
	}
	records, err := g.ensureFlowerReadRecords(ctx, meta, []ai.ThreadView{*thread})
	if err != nil {
		return nil, err
	}
	view := buildAIThreadView(*thread, records[strings.TrimSpace(thread.ThreadID)])
	return &aiThreadEnvelope{Thread: view}, nil
}

func (g *Gateway) buildCodexThreadListView(
	ctx context.Context,
	meta *session.Meta,
	threads []codexbridge.Thread,
) ([]codexThreadView, error) {
	records, err := g.ensureCodexReadRecords(ctx, meta, threads)
	if err != nil {
		return nil, err
	}
	out := make([]codexThreadView, 0, len(threads))
	for _, thread := range threads {
		out = append(out, buildCodexThreadView(thread, nil, records[strings.TrimSpace(thread.ID)]))
	}
	return out, nil
}

func (g *Gateway) buildCodexThreadDetailView(
	ctx context.Context,
	meta *session.Meta,
	detail *codexbridge.ThreadDetail,
) (*codexThreadDetailView, error) {
	if detail == nil {
		return nil, nil
	}
	records, err := g.ensureCodexReadRecordsForSnapshots(ctx, meta, map[string]threadreadstate.CodexSnapshot{
		strings.TrimSpace(detail.Thread.ID): codexSnapshotFromThread(detail.Thread, detail.PendingRequests),
	})
	if err != nil {
		return nil, err
	}
	view := &codexThreadDetailView{
		Thread:            buildCodexThreadView(detail.Thread, detail.PendingRequests, records[strings.TrimSpace(detail.Thread.ID)]),
		RuntimeConfig:     detail.RuntimeConfig,
		PendingRequests:   append([]codexbridge.PendingRequest(nil), detail.PendingRequests...),
		TokenUsage:        detail.TokenUsage,
		LastAppliedSeq:    detail.LastAppliedSeq,
		ActiveStatus:      strings.TrimSpace(detail.ActiveStatus),
		ActiveStatusFlags: append([]string(nil), detail.ActiveStatusFlags...),
	}
	return view, nil
}

func (g *Gateway) markAIThreadRead(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	req aiMarkThreadReadRequest,
) (aiMarkThreadReadResponse, error) {
	snapshot, err := g.validateFlowerReadSnapshot(ctx, meta, threadID, threadreadstate.FlowerSnapshot{
		LastMessageAtUnixMs: req.Snapshot.LastMessageAtUnixMs,
		WaitingPromptID:     strings.TrimSpace(req.Snapshot.WaitingPromptID),
	})
	if err != nil {
		return aiMarkThreadReadResponse{}, err
	}
	record, err := g.advanceFlowerReadRecord(ctx, meta, threadID, snapshot)
	if err != nil {
		return aiMarkThreadReadResponse{}, err
	}
	return aiMarkThreadReadResponse{
		ReadStatus: flowerReadStatusView(snapshot, record),
	}, nil
}

func (g *Gateway) markCodexThreadRead(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	req codexMarkThreadReadRequest,
) (codexMarkThreadReadResponse, error) {
	snapshot, err := g.validateCodexReadSnapshot(ctx, threadID, threadreadstate.CodexSnapshot{
		UpdatedAtUnixS:    req.Snapshot.UpdatedAtUnixS,
		ActivitySignature: strings.TrimSpace(req.Snapshot.ActivitySignature),
	})
	if err != nil {
		return codexMarkThreadReadResponse{}, err
	}
	record, err := g.advanceCodexReadRecord(ctx, meta, threadID, snapshot)
	if err != nil {
		return codexMarkThreadReadResponse{}, err
	}
	return codexMarkThreadReadResponse{
		ReadStatus: codexReadStatusView(snapshot, record),
	}, nil
}

func (g *Gateway) ensureFlowerReadRecords(
	ctx context.Context,
	meta *session.Meta,
	threads []ai.ThreadView,
) (map[string]threadreadstate.Record, error) {
	snapshots := make(map[string]threadreadstate.FlowerSnapshot, len(threads))
	for _, thread := range threads {
		threadID := strings.TrimSpace(thread.ThreadID)
		if threadID == "" {
			continue
		}
		snapshots[threadID] = flowerSnapshotFromThread(thread)
	}
	if len(snapshots) == 0 {
		return map[string]threadreadstate.Record{}, nil
	}
	if g == nil || g.threadReadState == nil || meta == nil {
		return seedFlowerRecords(snapshots), nil
	}
	return g.threadReadState.EnsureFlower(ctx, meta.EndpointID, meta.UserPublicID, snapshots)
}

func (g *Gateway) ensureCodexReadRecords(
	ctx context.Context,
	meta *session.Meta,
	threads []codexbridge.Thread,
) (map[string]threadreadstate.Record, error) {
	snapshots := make(map[string]threadreadstate.CodexSnapshot, len(threads))
	for _, thread := range threads {
		threadID := strings.TrimSpace(thread.ID)
		if threadID == "" {
			continue
		}
		snapshots[threadID] = codexSnapshotFromThread(thread, nil)
	}
	return g.ensureCodexReadRecordsForSnapshots(ctx, meta, snapshots)
}

func (g *Gateway) ensureCodexReadRecordsForSnapshots(
	ctx context.Context,
	meta *session.Meta,
	snapshots map[string]threadreadstate.CodexSnapshot,
) (map[string]threadreadstate.Record, error) {
	if len(snapshots) == 0 {
		return map[string]threadreadstate.Record{}, nil
	}
	if g == nil || g.threadReadState == nil || meta == nil {
		return seedCodexRecords(snapshots), nil
	}
	return g.threadReadState.EnsureCodex(ctx, meta.EndpointID, meta.UserPublicID, snapshots)
}

func (g *Gateway) validateFlowerReadSnapshot(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	snapshot threadreadstate.FlowerSnapshot,
) (threadreadstate.FlowerSnapshot, error) {
	snapshot = normalizeFlowerSnapshot(snapshot)
	if g == nil || g.ai == nil || meta == nil {
		return snapshot, nil
	}
	thread, err := g.ai.GetThread(ctx, meta, threadID)
	if err != nil {
		return threadreadstate.FlowerSnapshot{}, err
	}
	if thread == nil {
		return threadreadstate.FlowerSnapshot{}, errors.New("thread not found")
	}
	current := normalizeFlowerSnapshot(flowerSnapshotFromThread(*thread))
	if snapshot.LastMessageAtUnixMs > current.LastMessageAtUnixMs {
		return threadreadstate.FlowerSnapshot{}, errors.New("read snapshot exceeds current thread state")
	}
	return snapshot, nil
}

func (g *Gateway) validateCodexReadSnapshot(
	ctx context.Context,
	threadID string,
	snapshot threadreadstate.CodexSnapshot,
) (threadreadstate.CodexSnapshot, error) {
	snapshot = normalizeCodexSnapshot(snapshot)
	if g == nil || g.codex == nil {
		return snapshot, nil
	}
	detail, err := g.codex.ReadThread(ctx, threadID)
	if err != nil {
		return threadreadstate.CodexSnapshot{}, err
	}
	if detail == nil {
		return threadreadstate.CodexSnapshot{}, errors.New("thread not found")
	}
	current := normalizeCodexSnapshot(codexSnapshotFromThread(detail.Thread, detail.PendingRequests))
	if snapshot.UpdatedAtUnixS > current.UpdatedAtUnixS {
		return threadreadstate.CodexSnapshot{}, errors.New("read snapshot exceeds current thread state")
	}
	return snapshot, nil
}

func (g *Gateway) advanceFlowerReadRecord(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	snapshot threadreadstate.FlowerSnapshot,
) (threadreadstate.Record, error) {
	if g == nil || g.threadReadState == nil || meta == nil {
		if meta == nil {
			return threadreadstate.Record{
				Surface:                 threadreadstate.SurfaceFlower,
				ThreadID:                strings.TrimSpace(threadID),
				LastReadMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
				LastSeenWaitingPromptID: strings.TrimSpace(snapshot.WaitingPromptID),
			}, nil
		}
		return threadreadstate.Record{
			EndpointID:              strings.TrimSpace(meta.EndpointID),
			UserPublicID:            strings.TrimSpace(meta.UserPublicID),
			Surface:                 threadreadstate.SurfaceFlower,
			ThreadID:                strings.TrimSpace(threadID),
			LastReadMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
			LastSeenWaitingPromptID: strings.TrimSpace(snapshot.WaitingPromptID),
		}, nil
	}
	return g.threadReadState.AdvanceFlower(ctx, meta.EndpointID, meta.UserPublicID, threadID, snapshot)
}

func (g *Gateway) advanceCodexReadRecord(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	snapshot threadreadstate.CodexSnapshot,
) (threadreadstate.Record, error) {
	if g == nil || g.threadReadState == nil || meta == nil {
		if meta == nil {
			return threadreadstate.Record{
				Surface:                   threadreadstate.SurfaceCodex,
				ThreadID:                  strings.TrimSpace(threadID),
				LastReadUpdatedAtUnixS:    snapshot.UpdatedAtUnixS,
				LastSeenActivitySignature: strings.TrimSpace(snapshot.ActivitySignature),
			}, nil
		}
		return threadreadstate.Record{
			EndpointID:                strings.TrimSpace(meta.EndpointID),
			UserPublicID:              strings.TrimSpace(meta.UserPublicID),
			Surface:                   threadreadstate.SurfaceCodex,
			ThreadID:                  strings.TrimSpace(threadID),
			LastReadUpdatedAtUnixS:    snapshot.UpdatedAtUnixS,
			LastSeenActivitySignature: strings.TrimSpace(snapshot.ActivitySignature),
		}, nil
	}
	return g.threadReadState.AdvanceCodex(ctx, meta.EndpointID, meta.UserPublicID, threadID, snapshot)
}

func (g *Gateway) deleteFlowerThreadReadState(
	ctx context.Context,
	endpointID string,
	threadID string,
) ([]threadreadstate.Record, error) {
	if g == nil || g.threadReadState == nil {
		return nil, nil
	}
	return g.threadReadState.DeleteThread(ctx, endpointID, threadreadstate.SurfaceFlower, threadID)
}

func (g *Gateway) restoreFlowerThreadReadState(ctx context.Context, records []threadreadstate.Record) error {
	if g == nil || g.threadReadState == nil || len(records) == 0 {
		return nil
	}
	return g.threadReadState.RestoreRecords(ctx, records)
}

type flowerThreadDeleteCleanupError struct {
	err error
}

func (e flowerThreadDeleteCleanupError) Error() string {
	if e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e flowerThreadDeleteCleanupError) Unwrap() error {
	return e.err
}

func (g *Gateway) deleteFlowerThreadWithReadStateCleanup(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	primaryDelete func() error,
) error {
	if meta == nil {
		return flowerThreadDeleteCleanupError{err: errors.New("missing session metadata")}
	}
	deletedReadState, err := g.deleteFlowerThreadReadState(ctx, meta.EndpointID, threadID)
	if err != nil {
		return flowerThreadDeleteCleanupError{err: err}
	}
	if err := primaryDelete(); err != nil {
		if restoreErr := g.restoreFlowerThreadReadState(ctx, deletedReadState); restoreErr != nil && g.log != nil {
			g.log.Warn(
				"gateway: failed to restore deleted Flower thread read state after thread delete failure",
				"endpoint_id", strings.TrimSpace(meta.EndpointID),
				"thread_id", strings.TrimSpace(threadID),
				"error", restoreErr,
			)
		}
		return err
	}
	return nil
}

func buildAIThreadView(thread ai.ThreadView, record threadreadstate.Record) aiThreadView {
	snapshot := flowerSnapshotFromThread(thread)
	return aiThreadView{
		ThreadView: thread,
		ReadStatus: flowerReadStatusView(snapshot, record),
	}
}

func buildCodexThreadView(thread codexbridge.Thread, pending []codexbridge.PendingRequest, record threadreadstate.Record) codexThreadView {
	snapshot := codexSnapshotFromThread(thread, pending)
	return codexThreadView{
		Thread:     thread,
		ReadStatus: codexReadStatusView(snapshot, record),
	}
}

func flowerSnapshotFromThread(thread ai.ThreadView) threadreadstate.FlowerSnapshot {
	waitingPromptID := ""
	if thread.WaitingPrompt != nil {
		waitingPromptID = strings.TrimSpace(thread.WaitingPrompt.PromptID)
	}
	return threadreadstate.FlowerSnapshot{
		LastMessageAtUnixMs: thread.LastMessageAtUnixMs,
		WaitingPromptID:     waitingPromptID,
	}
}

func flowerReadStatusView(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) flowerThreadReadStatusView {
	snapshot = normalizeFlowerSnapshot(snapshot)
	record = normalizeFlowerRecord(record)
	return flowerThreadReadStatusView{
		IsUnread: flowerHasUnread(snapshot, record),
		Snapshot: flowerThreadUnreadSnapshotView{
			LastMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
			WaitingPromptID:     snapshot.WaitingPromptID,
		},
		ReadState: flowerThreadReadStateView{
			LastReadMessageAtUnixMs: record.LastReadMessageAtUnixMs,
			LastSeenWaitingPromptID: record.LastSeenWaitingPromptID,
		},
	}
}

func seedFlowerRecords(snapshots map[string]threadreadstate.FlowerSnapshot) map[string]threadreadstate.Record {
	out := make(map[string]threadreadstate.Record, len(snapshots))
	for threadID, snapshot := range snapshots {
		snapshot = normalizeFlowerSnapshot(snapshot)
		out[threadID] = threadreadstate.Record{
			ThreadID:                strings.TrimSpace(threadID),
			Surface:                 threadreadstate.SurfaceFlower,
			LastReadMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
			LastSeenWaitingPromptID: snapshot.WaitingPromptID,
		}
	}
	return out
}

func normalizeFlowerSnapshot(snapshot threadreadstate.FlowerSnapshot) threadreadstate.FlowerSnapshot {
	if snapshot.LastMessageAtUnixMs < 0 {
		snapshot.LastMessageAtUnixMs = 0
	}
	snapshot.WaitingPromptID = strings.TrimSpace(snapshot.WaitingPromptID)
	return snapshot
}

func normalizeFlowerRecord(record threadreadstate.Record) threadreadstate.Record {
	if record.LastReadMessageAtUnixMs < 0 {
		record.LastReadMessageAtUnixMs = 0
	}
	record.LastSeenWaitingPromptID = strings.TrimSpace(record.LastSeenWaitingPromptID)
	return record
}

func flowerHasUnread(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) bool {
	if snapshot.LastMessageAtUnixMs > record.LastReadMessageAtUnixMs {
		return true
	}
	return snapshot.WaitingPromptID != "" && snapshot.WaitingPromptID != record.LastSeenWaitingPromptID
}

func codexSnapshotFromThread(
	thread codexbridge.Thread,
	pending []codexbridge.PendingRequest,
) threadreadstate.CodexSnapshot {
	return threadreadstate.CodexSnapshot{
		UpdatedAtUnixS:    thread.UpdatedAtUnixS,
		ActivitySignature: codexActivitySignature(thread.Status, pending),
	}
}

func codexReadStatusView(snapshot threadreadstate.CodexSnapshot, record threadreadstate.Record) codexThreadReadStatusView {
	snapshot = normalizeCodexSnapshot(snapshot)
	record = normalizeCodexRecord(record)
	return codexThreadReadStatusView{
		IsUnread: codexHasUnread(snapshot, record),
		Snapshot: codexThreadUnreadSnapshotView{
			UpdatedAtUnixS:    snapshot.UpdatedAtUnixS,
			ActivitySignature: snapshot.ActivitySignature,
		},
		ReadState: codexThreadReadStateView{
			LastReadUpdatedAtUnixS:    record.LastReadUpdatedAtUnixS,
			LastSeenActivitySignature: record.LastSeenActivitySignature,
		},
	}
}

func seedCodexRecords(snapshots map[string]threadreadstate.CodexSnapshot) map[string]threadreadstate.Record {
	out := make(map[string]threadreadstate.Record, len(snapshots))
	for threadID, snapshot := range snapshots {
		snapshot = normalizeCodexSnapshot(snapshot)
		out[threadID] = threadreadstate.Record{
			ThreadID:                  strings.TrimSpace(threadID),
			Surface:                   threadreadstate.SurfaceCodex,
			LastReadUpdatedAtUnixS:    snapshot.UpdatedAtUnixS,
			LastSeenActivitySignature: snapshot.ActivitySignature,
		}
	}
	return out
}

func normalizeCodexSnapshot(snapshot threadreadstate.CodexSnapshot) threadreadstate.CodexSnapshot {
	if snapshot.UpdatedAtUnixS < 0 {
		snapshot.UpdatedAtUnixS = 0
	}
	snapshot.ActivitySignature = strings.TrimSpace(snapshot.ActivitySignature)
	return snapshot
}

func normalizeCodexRecord(record threadreadstate.Record) threadreadstate.Record {
	if record.LastReadUpdatedAtUnixS < 0 {
		record.LastReadUpdatedAtUnixS = 0
	}
	record.LastSeenActivitySignature = strings.TrimSpace(record.LastSeenActivitySignature)
	return record
}

func codexHasUnread(snapshot threadreadstate.CodexSnapshot, record threadreadstate.Record) bool {
	if snapshot.UpdatedAtUnixS > record.LastReadUpdatedAtUnixS {
		return true
	}
	if snapshot.ActivitySignature == "" || snapshot.ActivitySignature == record.LastSeenActivitySignature {
		return false
	}
	readSignature := strings.TrimSpace(record.LastSeenActivitySignature)
	if readSignature != "" && strings.HasPrefix(readSignature, snapshot.ActivitySignature+"\u001f") {
		return false
	}
	return true
}

func codexActivitySignature(status string, pending []codexbridge.PendingRequest) string {
	tokens := make([]string, 0, 1+len(pending))
	if normalizedStatus := normalizeStatusToken(status); normalizedStatus != "" {
		tokens = append(tokens, "status:"+normalizedStatus)
	}
	seen := make(map[string]struct{}, len(pending))
	requestIDs := make([]string, 0, len(pending))
	for _, request := range pending {
		requestID := strings.TrimSpace(request.ID)
		if requestID == "" {
			continue
		}
		if _, ok := seen[requestID]; ok {
			continue
		}
		seen[requestID] = struct{}{}
		requestIDs = append(requestIDs, requestID)
	}
	sort.Strings(requestIDs)
	for _, requestID := range requestIDs {
		tokens = append(tokens, "request:"+requestID)
	}
	return strings.Join(tokens, "\u001f")
}

func normalizeStatusToken(value string) string {
	value = strings.TrimSpace(value)
	value = camelSplitASCII(value)
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return strings.ToLower(value)
}

func camelSplitASCII(value string) string {
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for index, r := range value {
		if index > 0 && isLowerAlphaNumeric(rune(value[index-1])) && isUpperAlpha(r) {
			builder.WriteByte('_')
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func isLowerAlphaNumeric(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isUpperAlpha(r rune) bool {
	return r >= 'A' && r <= 'Z'
}
