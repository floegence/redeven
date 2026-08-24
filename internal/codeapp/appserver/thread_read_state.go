package appserver

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

type flowerThreadUnreadSnapshotView struct {
	ActivityRevision    int64  `json:"activity_revision"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	ActivitySignature   string `json:"activity_signature"`
	WaitingPromptID     string `json:"waiting_prompt_id,omitempty"`
}

type flowerThreadReadStateView struct {
	LastSeenActivityRevision  int64  `json:"last_seen_activity_revision"`
	LastReadMessageAtUnixMs   int64  `json:"last_read_message_at_unix_ms"`
	LastSeenActivitySignature string `json:"last_seen_activity_signature"`
	LastSeenWaitingPromptID   string `json:"last_seen_waiting_prompt_id,omitempty"`
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
	ClientRequestID string       `json:"client_request_id,omitempty"`
	Thread          aiThreadView `json:"thread"`
}

type aiFlowerThreadDetailEnvelope struct {
	ClientRequestID string               `json:"client_request_id,omitempty"`
	Thread          aiThreadView         `json:"thread"`
	Current         flruntime.ThreadView `json:"current"`
}

type aiMarkThreadReadRequest struct {
	Snapshot flowerThreadUnreadSnapshotView `json:"snapshot"`
}

type aiMarkThreadReadResponse struct {
	ReadStatus flowerThreadReadStatusView `json:"read_status"`
}

func (g *Server) buildAIListThreadsView(
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

func (g *Server) buildAIThreadEnvelope(
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

func (g *Server) buildAIFlowerThreadDetailEnvelope(
	ctx context.Context,
	meta *session.Meta,
	detail *ai.FlowerThreadDetail,
) (*aiFlowerThreadDetailEnvelope, error) {
	if detail == nil {
		return nil, nil
	}
	records, err := g.ensureFlowerReadRecords(ctx, meta, []ai.ThreadView{detail.Thread})
	if err != nil {
		return nil, err
	}
	return &aiFlowerThreadDetailEnvelope{
		Thread:  buildAIThreadView(detail.Thread, records[strings.TrimSpace(detail.Thread.ThreadID)]),
		Current: detail.Current,
	}, nil
}

func flowerAIReadStatusView(view flowerThreadReadStatusView) ai.FlowerThreadReadView {
	return ai.FlowerThreadReadView{
		IsUnread: view.IsUnread,
		Snapshot: ai.FlowerThreadReadSnapshot{
			ActivityRevision:    view.Snapshot.ActivityRevision,
			LastMessageAtUnixMs: view.Snapshot.LastMessageAtUnixMs,
			ActivitySignature:   view.Snapshot.ActivitySignature,
			WaitingPromptID:     view.Snapshot.WaitingPromptID,
		},
		ReadState: ai.FlowerThreadReadRecord{
			LastSeenActivityRevision:  view.ReadState.LastSeenActivityRevision,
			LastReadMessageAtUnixMs:   view.ReadState.LastReadMessageAtUnixMs,
			LastSeenActivitySignature: view.ReadState.LastSeenActivitySignature,
			LastSeenWaitingPromptID:   view.ReadState.LastSeenWaitingPromptID,
		},
	}
}

func (g *Server) markAIThreadRead(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	req aiMarkThreadReadRequest,
) (aiMarkThreadReadResponse, error) {
	snapshot, err := g.validateFlowerReadSnapshot(ctx, meta, threadID, threadreadstate.FlowerSnapshot{
		ActivityRevision:    req.Snapshot.ActivityRevision,
		LastMessageAtUnixMs: req.Snapshot.LastMessageAtUnixMs,
		ActivitySignature:   strings.TrimSpace(req.Snapshot.ActivitySignature),
		WaitingPromptID:     strings.TrimSpace(req.Snapshot.WaitingPromptID),
	})
	if err != nil {
		return aiMarkThreadReadResponse{}, err
	}
	record, err := g.advanceFlowerReadRecord(ctx, meta, threadID, snapshot)
	if err != nil {
		return aiMarkThreadReadResponse{}, err
	}
	current := snapshot
	aiSvc := aiServiceFromContext(ctx)
	if g != nil && aiSvc != nil && meta != nil {
		thread, err := aiSvc.GetThread(ctx, meta, threadID)
		if err != nil {
			return aiMarkThreadReadResponse{}, err
		}
		if thread == nil {
			return aiMarkThreadReadResponse{}, errors.New("thread not found")
		}
		current = flowerSnapshotFromThread(*thread)
	}
	return aiMarkThreadReadResponse{
		ReadStatus: flowerReadStatusView(current, record),
	}, nil
}

func (g *Server) ensureFlowerReadRecords(
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
		userPublicID := ""
		if meta != nil {
			userPublicID = meta.UserPublicID
		}
		return seedFlowerRecords(userPublicID, snapshots), nil
	}
	return g.threadReadState.EnsureFlower(ctx, meta.EndpointID, meta.UserPublicID, snapshots)
}

func (g *Server) validateFlowerReadSnapshot(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	snapshot threadreadstate.FlowerSnapshot,
) (threadreadstate.FlowerSnapshot, error) {
	snapshot = normalizeFlowerSnapshot(snapshot)
	if snapshot.ActivitySignature == "" {
		return threadreadstate.FlowerSnapshot{}, errors.New("missing read snapshot activity signature")
	}
	aiSvc := aiServiceFromContext(ctx)
	if g == nil || aiSvc == nil || meta == nil {
		return snapshot, nil
	}
	thread, err := aiSvc.GetThread(ctx, meta, threadID)
	if err != nil {
		return threadreadstate.FlowerSnapshot{}, err
	}
	if thread == nil {
		return threadreadstate.FlowerSnapshot{}, errors.New("thread not found")
	}
	current := normalizeFlowerSnapshot(flowerSnapshotFromThread(*thread))
	if snapshot.ActivityRevision > current.ActivityRevision || snapshot.LastMessageAtUnixMs > current.LastMessageAtUnixMs {
		return threadreadstate.FlowerSnapshot{}, errors.New("read snapshot exceeds current thread state")
	}
	if snapshot.ActivityRevision == current.ActivityRevision && snapshot.ActivitySignature != current.ActivitySignature {
		return threadreadstate.FlowerSnapshot{}, errors.New("read snapshot does not match current thread activity")
	}
	if snapshot.ActivityRevision == current.ActivityRevision && snapshot.WaitingPromptID != current.WaitingPromptID {
		return threadreadstate.FlowerSnapshot{}, errors.New("read snapshot does not match current thread activity")
	}
	if snapshot.ActivityRevision < current.ActivityRevision {
		return snapshot, nil
	}
	if snapshot.LastMessageAtUnixMs != current.LastMessageAtUnixMs {
		return threadreadstate.FlowerSnapshot{}, errors.New("read snapshot does not match current thread activity")
	}
	return snapshot, nil
}

func (g *Server) advanceFlowerReadRecord(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	snapshot threadreadstate.FlowerSnapshot,
) (threadreadstate.Record, error) {
	if g == nil || g.threadReadState == nil || meta == nil {
		scopeID, endpointID := "", ""
		if meta != nil {
			scopeID = strings.TrimSpace(meta.UserPublicID)
			endpointID = strings.TrimSpace(meta.EndpointID)
		}
		if meta == nil {
			return threadreadstate.Record{
				Surface:                   threadreadstate.SurfaceFlower,
				ScopeID:                   scopeID,
				ThreadID:                  strings.TrimSpace(threadID),
				LastSeenActivityRevision:  snapshot.ActivityRevision,
				LastReadMessageAtUnixMs:   snapshot.LastMessageAtUnixMs,
				LastSeenActivitySignature: strings.TrimSpace(snapshot.ActivitySignature),
				LastSeenWaitingPromptID:   strings.TrimSpace(snapshot.WaitingPromptID),
			}, nil
		}
		return threadreadstate.Record{
			EndpointID:                endpointID,
			ScopeID:                   scopeID,
			Surface:                   threadreadstate.SurfaceFlower,
			ThreadID:                  strings.TrimSpace(threadID),
			LastSeenActivityRevision:  snapshot.ActivityRevision,
			LastReadMessageAtUnixMs:   snapshot.LastMessageAtUnixMs,
			LastSeenActivitySignature: strings.TrimSpace(snapshot.ActivitySignature),
			LastSeenWaitingPromptID:   strings.TrimSpace(snapshot.WaitingPromptID),
		}, nil
	}
	return g.threadReadState.AdvanceFlower(ctx, meta.EndpointID, meta.UserPublicID, threadID, snapshot)
}

func buildAIThreadView(thread ai.ThreadView, record threadreadstate.Record) aiThreadView {
	snapshot := flowerSnapshotFromThread(thread)
	return aiThreadView{
		ThreadView: thread,
		ReadStatus: flowerReadStatusView(snapshot, record),
	}
}

func flowerSnapshotFromThread(thread ai.ThreadView) threadreadstate.FlowerSnapshot {
	return threadreadstate.FlowerSnapshot{
		ActivityRevision:    thread.FlowerActivity.ActivityRevision,
		LastMessageAtUnixMs: thread.FlowerActivity.LastMessageAtUnixMs,
		ActivitySignature:   strings.TrimSpace(thread.FlowerActivity.ActivitySignature),
		WaitingPromptID:     strings.TrimSpace(thread.FlowerActivity.WaitingPromptID),
	}
}

func flowerReadStatusView(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) flowerThreadReadStatusView {
	snapshot = normalizeFlowerSnapshot(snapshot)
	record = normalizeFlowerRecord(record)
	return flowerThreadReadStatusView{
		IsUnread: flowerIsUnread(snapshot, record),
		Snapshot: flowerThreadUnreadSnapshotView{
			ActivityRevision:    snapshot.ActivityRevision,
			LastMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
			ActivitySignature:   snapshot.ActivitySignature,
			WaitingPromptID:     snapshot.WaitingPromptID,
		},
		ReadState: flowerThreadReadStateView{
			LastSeenActivityRevision:  record.LastSeenActivityRevision,
			LastReadMessageAtUnixMs:   record.LastReadMessageAtUnixMs,
			LastSeenActivitySignature: record.LastSeenActivitySignature,
			LastSeenWaitingPromptID:   record.LastSeenWaitingPromptID,
		},
	}
}

func seedFlowerRecords(userPublicID string, snapshots map[string]threadreadstate.FlowerSnapshot) map[string]threadreadstate.Record {
	out := make(map[string]threadreadstate.Record, len(snapshots))
	scopeID := strings.TrimSpace(userPublicID)
	for threadID, snapshot := range snapshots {
		snapshot = normalizeFlowerSnapshot(snapshot)
		out[threadID] = threadreadstate.Record{
			ThreadID:                  strings.TrimSpace(threadID),
			Surface:                   threadreadstate.SurfaceFlower,
			ScopeID:                   scopeID,
			LastSeenActivityRevision:  snapshot.ActivityRevision,
			LastReadMessageAtUnixMs:   snapshot.LastMessageAtUnixMs,
			LastSeenActivitySignature: snapshot.ActivitySignature,
			LastSeenWaitingPromptID:   snapshot.WaitingPromptID,
		}
	}
	return out
}

func normalizeFlowerSnapshot(snapshot threadreadstate.FlowerSnapshot) threadreadstate.FlowerSnapshot {
	if snapshot.LastMessageAtUnixMs < 0 {
		snapshot.LastMessageAtUnixMs = 0
	}
	if snapshot.ActivityRevision < 0 {
		snapshot.ActivityRevision = 0
	}
	snapshot.ActivitySignature = strings.TrimSpace(snapshot.ActivitySignature)
	snapshot.WaitingPromptID = strings.TrimSpace(snapshot.WaitingPromptID)
	return snapshot
}

func normalizeFlowerRecord(record threadreadstate.Record) threadreadstate.Record {
	if record.LastReadMessageAtUnixMs < 0 {
		record.LastReadMessageAtUnixMs = 0
	}
	if record.LastSeenActivityRevision < 0 {
		record.LastSeenActivityRevision = 0
	}
	record.LastSeenActivitySignature = strings.TrimSpace(record.LastSeenActivitySignature)
	record.LastSeenWaitingPromptID = strings.TrimSpace(record.LastSeenWaitingPromptID)
	return record
}

func flowerIsUnread(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) bool {
	return snapshot.ActivityRevision > record.LastSeenActivityRevision
}
