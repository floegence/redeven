package appserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

type flowerThreadUnreadSnapshotView struct {
	ActivityRevision int64 `json:"activity_revision"`
}

type flowerThreadReadStateView struct {
	LastSeenActivityRevision int64 `json:"last_seen_activity_revision"`
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

func (e aiFlowerThreadDetailEnvelope) MarshalJSON() ([]byte, error) {
	type wire aiFlowerThreadDetailEnvelope
	encoded, err := json.Marshal(wire(e))
	if err != nil {
		return nil, err
	}
	current, err := ai.MarshalFlowerCurrentView(e.Current)
	if err != nil {
		return nil, err
	}
	var currentValue any
	if err := json.Unmarshal(current, &currentValue); err != nil {
		return nil, err
	}
	var root map[string]any
	if err := json.Unmarshal(encoded, &root); err != nil {
		return nil, err
	}
	root["current"] = currentValue
	return json.Marshal(root)
}

type aiMarkThreadReadRequest struct {
	Snapshot *flowerThreadReadRequestSnapshot `json:"snapshot"`
}

type flowerThreadReadRequestSnapshot struct {
	ActivityRevision *int64 `json:"activity_revision"`
}

type aiMarkThreadReadResponse struct {
	ReadStatus flowerThreadReadStatusView `json:"read_status"`
}

var (
	errFlowerReadSnapshotAhead   = errors.New("read snapshot exceeds current thread state")
	errFlowerThreadNotFound      = errors.New("thread not found")
	errInvalidFlowerReadSnapshot = errors.New("invalid read snapshot")
)

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
			ActivityRevision: view.Snapshot.ActivityRevision,
		},
		ReadState: ai.FlowerThreadReadRecord{
			LastSeenActivityRevision: view.ReadState.LastSeenActivityRevision,
		},
	}
}

func (g *Server) markAIThreadRead(
	ctx context.Context,
	meta *session.Meta,
	threadID string,
	req aiMarkThreadReadRequest,
) (aiMarkThreadReadResponse, error) {
	if req.Snapshot == nil || req.Snapshot.ActivityRevision == nil || *req.Snapshot.ActivityRevision < 0 {
		return aiMarkThreadReadResponse{}, errInvalidFlowerReadSnapshot
	}
	snapshot, current, err := g.validateFlowerReadSnapshot(ctx, meta, threadID, threadreadstate.FlowerSnapshot{
		ActivityRevision: *req.Snapshot.ActivityRevision,
	})
	if err != nil {
		return aiMarkThreadReadResponse{}, err
	}
	record, err := g.advanceFlowerReadRecord(ctx, meta, threadID, snapshot)
	if err != nil {
		return aiMarkThreadReadResponse{}, err
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
) (threadreadstate.FlowerSnapshot, threadreadstate.FlowerSnapshot, error) {
	snapshot = normalizeFlowerSnapshot(snapshot)
	aiSvc := aiServiceFromContext(ctx)
	if g == nil || aiSvc == nil || meta == nil {
		return snapshot, snapshot, nil
	}
	thread, err := aiSvc.GetThread(ctx, meta, threadID)
	if err != nil {
		return threadreadstate.FlowerSnapshot{}, threadreadstate.FlowerSnapshot{}, err
	}
	if thread == nil {
		return threadreadstate.FlowerSnapshot{}, threadreadstate.FlowerSnapshot{}, errFlowerThreadNotFound
	}
	current := normalizeFlowerSnapshot(flowerSnapshotFromThread(*thread))
	if snapshot.ActivityRevision > current.ActivityRevision {
		return threadreadstate.FlowerSnapshot{}, threadreadstate.FlowerSnapshot{}, errFlowerReadSnapshotAhead
	}
	return snapshot, current, nil
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
				Surface:                  threadreadstate.SurfaceFlower,
				ScopeID:                  scopeID,
				ThreadID:                 strings.TrimSpace(threadID),
				LastSeenActivityRevision: snapshot.ActivityRevision,
			}, nil
		}
		return threadreadstate.Record{
			EndpointID:               endpointID,
			ScopeID:                  scopeID,
			Surface:                  threadreadstate.SurfaceFlower,
			ThreadID:                 strings.TrimSpace(threadID),
			LastSeenActivityRevision: snapshot.ActivityRevision,
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
		ActivityRevision: thread.FlowerActivity.ActivityRevision,
	}
}

func flowerReadStatusView(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) flowerThreadReadStatusView {
	snapshot = normalizeFlowerSnapshot(snapshot)
	record = normalizeFlowerRecord(record)
	return flowerThreadReadStatusView{
		IsUnread: flowerIsUnread(snapshot, record),
		Snapshot: flowerThreadUnreadSnapshotView{
			ActivityRevision: snapshot.ActivityRevision,
		},
		ReadState: flowerThreadReadStateView{
			LastSeenActivityRevision: record.LastSeenActivityRevision,
		},
	}
}

func seedFlowerRecords(userPublicID string, snapshots map[string]threadreadstate.FlowerSnapshot) map[string]threadreadstate.Record {
	out := make(map[string]threadreadstate.Record, len(snapshots))
	scopeID := strings.TrimSpace(userPublicID)
	for threadID, snapshot := range snapshots {
		snapshot = normalizeFlowerSnapshot(snapshot)
		out[threadID] = threadreadstate.Record{
			ThreadID:                 strings.TrimSpace(threadID),
			Surface:                  threadreadstate.SurfaceFlower,
			ScopeID:                  scopeID,
			LastSeenActivityRevision: snapshot.ActivityRevision,
		}
	}
	return out
}

func normalizeFlowerSnapshot(snapshot threadreadstate.FlowerSnapshot) threadreadstate.FlowerSnapshot {
	if snapshot.ActivityRevision < 0 {
		snapshot.ActivityRevision = 0
	}
	return snapshot
}

func normalizeFlowerRecord(record threadreadstate.Record) threadreadstate.Record {
	if record.LastSeenActivityRevision < 0 {
		record.LastSeenActivityRevision = 0
	}
	return record
}

func flowerIsUnread(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) bool {
	return snapshot.ActivityRevision > record.LastSeenActivityRevision
}
