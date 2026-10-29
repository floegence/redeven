package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

const (
	flowerLiveMaxSubscribersPerEndpoint = 256
	flowerLiveBaselinePageLimit         = 25
	flowerLiveSubscriberBatchLimit      = 16
	flowerLivePendingFrameByteLimit     = 1 << 20
	flowerLiveFragmentByteLimit         = 32 << 10
	flowerLiveFrameByteLimit            = 64 << 10
	flowerLiveEnvelopeByteLimit         = 32 << 20
	flowerLiveGlobalQueuedByteLimit     = 32 << 20
)

var (
	ErrFlowerLiveTooManySubscribers = errors.New("too many Flower live observers")
	ErrFlowerLiveSync               = errors.New("flower live stream synchronization failed")
)

type flowerLiveSubscriberCloseReason string

const (
	flowerLiveSubscriberCloseClient            flowerLiveSubscriberCloseReason = "client_closed"
	flowerLiveSubscriberCloseService           flowerLiveSubscriberCloseReason = "service_closed"
	flowerLiveSubscriberCloseRuntime           flowerLiveSubscriberCloseReason = "runtime_subscription_invalidated"
	flowerLiveSubscriberCloseOversizedEnvelope flowerLiveSubscriberCloseReason = "oversized_envelope"
	flowerLiveSubscriberCloseEncoding          flowerLiveSubscriberCloseReason = "envelope_encoding_failed"
	flowerLiveSubscriberCloseInitQueueLimit    flowerLiveSubscriberCloseReason = "initialization_queue_limit"
	flowerLiveSubscriberCloseBatchQueueLimit   flowerLiveSubscriberCloseReason = "batch_queue_limit"
	flowerLiveSubscriberCloseByteQueueLimit    flowerLiveSubscriberCloseReason = "byte_queue_limit"
	flowerLiveSubscriberCloseGlobalQueueLimit  flowerLiveSubscriberCloseReason = "global_queue_limit"
	flowerLiveSubscriberCloseSummaryRefresh    flowerLiveSubscriberCloseReason = "summary_refresh_failed"
)

type FlowerLiveStreamKind string

const (
	FlowerLiveStreamReady                 FlowerLiveStreamKind = "ready"
	FlowerLiveStreamSummaryBatch          FlowerLiveStreamKind = "summary.batch"
	FlowerLiveStreamThreadBatch           FlowerLiveStreamKind = "thread.batch"
	FlowerLiveStreamViewerReadState       FlowerLiveStreamKind = "viewer.read_state"
	FlowerLiveStreamComputerFrame         FlowerLiveStreamKind = "computer.frame"
	FlowerLiveStreamComputerStatus        FlowerLiveStreamKind = "computer.status"
	FlowerLiveStreamModelDirectoryChanged FlowerLiveStreamKind = "model_directory.changed"
)

// Metadata invalidation carries no provider/account data. Each observer reads
// its own authorized projection over the existing workspace transport.
func (s *Service) publishModelDirectoryChanged() {
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamModelDirectoryChanged})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
}

type FlowerLiveStreamRequest struct{}

type FlowerLiveStreamEnvelope struct {
	HistoryInvalidated  *FlowerHistoryInvalidation `json:"history_invalidated,omitempty"`
	BaselineComplete    *bool                      `json:"baseline_complete,omitempty"`
	ReadingRevision     uint64                     `json:"reading_revision,omitempty"`
	Window              *FlowerHistoryWindow       `json:"window,omitempty"`
	FactsOnly           bool                       `json:"facts_only,omitempty"`
	ObserverID          string                     `json:"observer_id,omitempty"`
	SchemaVersion       int64                      `json:"schema_version"`
	Kind                FlowerLiveStreamKind       `json:"kind"`
	ThreadID            string                     `json:"thread_id,omitempty"`
	Summaries           []ThreadView               `json:"summaries,omitempty"`
	Update              *flruntime.ThreadUpdate    `json:"update,omitempty"`
	SubagentUpdate      *flruntime.ThreadUpdate    `json:"subagent_update,omitempty"`
	updateEvidence      *flruntime.ThreadView
	Current             *flruntime.ThreadView         `json:"current,omitempty"`
	SubagentCurrent     *flruntime.ThreadView         `json:"subagent_current,omitempty"`
	Subagents           *[]FlowerSubagentSummary      `json:"subagents,omitempty"`
	ModelContext        *flruntime.ThreadModelContext `json:"model_context,omitempty"`
	ContextUsage        *FlowerContextUsage           `json:"context_usage,omitempty"`
	ContextCompactions  []FlowerContextCompaction     `json:"context_compactions,omitempty"`
	TimelineDecorations []FlowerTimelineDecoration    `json:"timeline_decorations,omitempty"`
	ReadStatus          *FlowerThreadReadView         `json:"read_status,omitempty"`
	ComputerFrame       *FlowerComputerFrame          `json:"computer_frame,omitempty"`
	ComputerStatus      *FlowerComputerStatus         `json:"computer_status,omitempty"`
}

type FlowerComputerFrame struct {
	AssistanceKind string `json:"assistance_kind,omitempty"`
	ViewerRevision uint64 `json:"viewer_revision"`
	InteractionID  string `json:"interaction_id,omitempty"`
	FrameID        string `json:"frame_id,omitempty"`
	ErrorCode      string `json:"error_code,omitempty"`
	ThreadID       string `json:"thread_id"`
	SessionID      string `json:"session_id"`
	TargetID       string `json:"target_id"`
	ResourceRef    string `json:"resource_ref,omitempty"`
	SHA256         string `json:"sha256,omitempty"`
	MIMEType       string `json:"mime_type"`
	Width          int    `json:"width,omitempty"`
	Height         int    `json:"height,omitempty"`
	Sequence       uint64 `json:"sequence"`
	CapturedAtMS   int64  `json:"captured_at_ms,omitempty"`
}

// FlowerComputerStatus is an ephemeral, target-scoped fact for the current
// workspace. It never becomes thread history or a recovery decision.
type FlowerComputerStatus struct {
	ThreadID      string `json:"thread_id"`
	InteractionID string `json:"interaction_id,omitempty"`
	TargetID      string `json:"target_id"`
	State         string `json:"state"`
	ReasonCode    string `json:"reason_code,omitempty"`
	AtMS          int64  `json:"at_unix_ms"`
}

// PublishFlowerComputerFrame sends only the latest target-scoped frame metadata
// to observers. The frame is ephemeral and never enters the durable timeline.
func (s *Service) PublishFlowerComputerFrame(meta *session.Meta, frame FlowerComputerFrame) error {
	if s == nil || meta == nil {
		return errors.New("invalid computer frame publisher")
	}
	if strings.TrimSpace(frame.ThreadID) == "" {
		return errors.New("computer frame thread is required")
	}
	if frame.InteractionID != "" || frame.FrameID != "" {
		return errors.New("private computer frames require an individual observer")
	}
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerFrame, ThreadID: frame.ThreadID, ComputerFrame: &frame})
	if batch.err != nil {
		return ErrFlowerLiveSync
	}
	if len(batch.data) > 4096 {
		return errors.New("computer frame metadata is too large")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID == meta.EndpointID && subscriber.userPublicID == meta.UserPublicID && !subscriber.closed {
			// Media is lossy: a slow viewer gets only the newest frame and
			// never consumes or disconnects the lifecycle queue.
			replaceFlowerLiveSubscriberMediaLocked(s, subscriber, batch)
		}
	}
	return nil
}

func (s *Service) publishFlowerComputerStatus(endpointID string, requested FlowerComputerStatus) {
	if s == nil || s.threadRuntime == nil || strings.TrimSpace(endpointID) == "" || strings.TrimSpace(requested.ThreadID) == "" || strings.TrimSpace(requested.TargetID) == "" {
		return
	}
	current, err := s.threadRuntime.View(context.Background(), identity.ThreadID(strings.TrimSpace(requested.ThreadID)))
	if err != nil {
		return
	}
	for _, status := range s.flowerComputerStatusesForCurrent(context.Background(), current, strings.TrimSpace(requested.TargetID)) {
		s.broadcastFlowerComputerStatus(endpointID, status)
	}
}

func (s *Service) broadcastFlowerComputerStatus(endpointID string, status FlowerComputerStatus) {
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerStatus, ThreadID: status.ThreadID, ComputerStatus: &status})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID == endpointID && !subscriber.closed {
			enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
		}
	}
}

func (s *Service) flowerComputerStatusesForCurrent(ctx context.Context, current flruntime.ThreadView, onlyTarget string) []FlowerComputerStatus {
	if s == nil || current.ThreadID == "" || s.targetResolver == nil {
		return nil
	}
	var statuses []FlowerComputerStatus
	for _, interaction := range current.Interactions {
		if interaction.Resolved || interaction.Kind != flruntime.ThreadInteractionInput {
			continue
		}
		call, computer, err := computerControlCall(current, interaction)
		if err != nil || !computer || onlyTarget != "" && call.TargetID != onlyTarget {
			continue
		}
		target, resolveErr := s.targetResolver.ResolveTarget(ctx, call.TargetID)
		status := FlowerComputerStatus{ThreadID: current.ThreadID.String(), InteractionID: interaction.ID, TargetID: call.TargetID, AtMS: time.Now().UnixMilli()}
		if resolveErr != nil {
			status.State, status.ReasonCode = "unavailable", "target_closed"
		} else if !target.Ready {
			status.State, status.ReasonCode = "unavailable", computerStatusReason(target.State)
		} else {
			status.State = "available"
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func computerStatusReason(state string) string {
	switch strings.TrimSpace(state) {
	case "connection_required":
		return "connection_required"
	case "target_closed", "stopped":
		return "target_closed"
	case "source_fault":
		return "source_fault"
	default:
		return "target_unavailable"
	}
}

type FlowerLiveStreamFrame struct {
	Kind FlowerLiveStreamKind
	Data []byte
}

// Large public envelopes use bounded fragments; small batches carry direct JSON.
// Fragmentation happens after the public projection has removed private fields.
type FlowerLiveStreamFragment struct {
	EnvelopeID    string `json:"envelope_id"`
	FragmentIndex int    `json:"fragment_index"`
	FragmentCount int    `json:"fragment_count"`
	TotalBytes    int    `json:"total_bytes"`
	DataBase64    string `json:"data_base64"`
}

type flowerLiveEncodedBatch struct {
	readingRevision     uint64
	kind                FlowerLiveStreamKind
	data                []byte
	id                  string
	err                 error
	route               flowerLiveRoute
	mailbox             string
	baseVersion         uint64
	version             uint64
	current             bool
	refresh             bool
	append              *flowerLiveAppend
	encodingDiagnostics *flowerLiveEncodingDiagnostics
}

type flowerLiveEncodingDiagnostics struct {
	threadID        string
	current         *flowerLiveCurrentEncodingDiagnostics
	subagentCurrent *flowerLiveCurrentEncodingDiagnostics
}

type flowerLiveCurrentEncodingDiagnostics struct {
	threadID    string
	turnID      string
	runID       string
	viewVersion uint64
}

type flowerLiveSubscriber struct {
	namespacePublicID  string
	history            flowerHistoryInterest
	subagentHistory    flowerHistoryInterest
	observerID         string
	observerContext    context.Context
	observerCancel     context.CancelFunc
	observerStop       func() bool
	baselineThreadIDs  []string
	baselineArrayBytes int
	viewerMu           sync.Mutex
	viewerRevision     uint64
	viewerRequest      ComputerViewerRequest
	viewerCancel       context.CancelFunc
	viewerStop         func()
	id                 uint64
	endpointID         string
	userPublicID       string
	queue              []*flowerLiveEncodedBatch
	media              chan *flowerLiveEncodedBatch
	queuedBytes        int
	mediaBytes         int
	initializing       bool
	baselineReading    bool
	initial            []*flowerLiveEncodedBatch
	covered            map[flowerLiveRoute]uint64
	pressureLoggedAt   time.Time
	active             *flowerLiveEncodedBatch
	activeIndex        int
	activeAccounted    bool
	wake               chan struct{}
	closeErr           error
	closed             bool
}

// Only immutable public bytes and bounded routing metadata survive encoding.
// Runtime/private view graphs never belong to a subscriber queue.
type flowerLiveRoute struct {
	threadID string
	wireID   string
	subagent bool
}

type flowerLiveAppend struct {
	turnID         identity.TurnID
	runID          identity.RunID
	itemID         string
	offset         int
	text           string
	body           *flruntime.ThreadItemBody
	facts          json.RawMessage
	factsKey       [32]byte
	outputTokens   int64
	lastProgressAt time.Time
}

func (batch *flowerLiveEncodedBatch) bytes() int {
	if batch == nil {
		return 0
	}
	size := len(batch.data) + len(batch.route.threadID) + len(batch.route.wireID) + len(batch.mailbox)
	if batch.route.threadID != "" || batch.mailbox != "" {
		size += 256
	}
	if a := batch.append; a != nil {
		size += 256 + len(a.text) + len(a.facts) + len(a.itemID) + len(a.turnID) + len(a.runID)
	}
	return size
}

func (route flowerLiveRoute) bytes() int { return 128 + len(route.threadID) + len(route.wireID) }

type FlowerLiveStreamSubscription struct {
	service    *Service
	subscriber *flowerLiveSubscriber
	closeOnce  sync.Once
	nextMu     sync.Mutex
}

func (s *Service) SubscribeFlowerLiveStream(ctx context.Context, meta *session.Meta, _ FlowerLiveStreamRequest) (*FlowerLiveStreamSubscription, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	if endpointID == "" || userPublicID == "" {
		return nil, errors.New("invalid Flower live stream request")
	}

	s.mu.Lock()
	if s.flowerRuntimeUpdatesUnavailable {
		s.mu.Unlock()
		return nil, ErrFlowerLiveSync
	}
	if s.flowerLiveSubscribersByEndpoint == nil {
		s.flowerLiveSubscribersByEndpoint = make(map[string]int)
	}
	if s.flowerLiveSubscribersByEndpoint[endpointID] >= flowerLiveMaxSubscribersPerEndpoint {
		s.mu.Unlock()
		return nil, ErrFlowerLiveTooManySubscribers
	}
	if s.flowerLiveSubscribers == nil {
		s.flowerLiveSubscribers = make(map[uint64]*flowerLiveSubscriber)
	}
	s.flowerLiveSubscriberSeq++
	observerContext, observerCancel := context.WithCancel(ctxOrBackground(ctx))
	subscriber := &flowerLiveSubscriber{
		observerID: rand.Text(), observerContext: observerContext, observerCancel: observerCancel,
		id: s.flowerLiveSubscriberSeq, endpointID: endpointID, userPublicID: userPublicID, namespacePublicID: meta.NamespacePublicID,
		media: make(chan *flowerLiveEncodedBatch, 1), wake: make(chan struct{}, 1),
		initializing: true,
	}
	// Cancellation owns subscription lifetime even while the transport is not
	// awaiting Next (for example while a disconnected client is writing).
	subscriber.observerStop = context.AfterFunc(observerContext, func() { closeFlowerLiveSubscription(s, subscriber) })
	s.flowerLiveSubscribers[subscriber.id] = subscriber
	s.flowerLiveSubscribersByEndpoint[endpointID]++
	s.flowerLiveMetrics.subscriberOpened()
	s.mu.Unlock()

	subscription := &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}
	if s.threadsDB != nil {
		ids, err := s.threadsDB.ListRootThreadIDs(observerContext, endpointID, flowerLiveEnvelopeByteLimit)
		if err != nil {
			closeFlowerLiveSubscription(s, subscriber)
			return nil, err
		}
		s.mu.Lock()
		arrayBytes := cap(ids) * 16
		cost := arrayBytes
		for _, id := range ids {
			cost += len(id)
		}
		if subscriber.closed || subscriber.queuedBytes+cost > flowerLiveEnvelopeByteLimit || s.flowerLiveQueuedBytes+cost > flowerLiveGlobalQueuedByteLimit {
			closeFlowerLiveSubscriberLocked(s, subscriber, flowerLiveSubscriberCloseGlobalQueueLimit)
			s.mu.Unlock()
			return nil, ErrFlowerLiveSync
		}
		subscriber.queuedBytes += cost
		s.flowerLiveQueuedBytes += cost
		subscriber.baselineThreadIDs = ids
		subscriber.baselineArrayBytes = arrayBytes
		s.mu.Unlock()
	}
	// The observer is usable before sidebar summaries are read. Keep the frozen
	// inventory and ordered baseline pages, but never put historical work on
	// the transport handshake critical path.
	s.mu.Lock()
	complete := len(subscriber.baselineThreadIDs) == 0
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady, ObserverID: subscriber.observerID, BaselineComplete: &complete})
	if !retainFlowerLiveBatchLocked(s, subscriber, ready) {
		s.mu.Unlock()
		return nil, ErrFlowerLiveSync
	}
	subscriber.initial = append(subscriber.initial, ready)
	if complete {
		finalizeFlowerLiveSubscriberInitializationLocked(s, subscriber)
	}
	s.mu.Unlock()
	return subscription, nil
}

// Each page is read only after the previous page drains. Concurrent events stay
// behind the baseline, preserving the subscription-before-snapshot boundary
// without retaining or waiting for every historical summary before ready.
func (subscription *FlowerLiveStreamSubscription) loadBaselinePage(ctx context.Context) error {
	s, subscriber := subscription.service, subscription.subscriber
	var summaries []ThreadView
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(subscriber.observerContext, cancel)
	defer func() { stop(); cancel() }()
	s.mu.Lock()
	if subscriber.closed {
		s.mu.Unlock()
		return ErrFlowerLiveSync
	}
	count := min(len(subscriber.baselineThreadIDs), flowerLiveBaselinePageLimit)
	ids := append([]string(nil), subscriber.baselineThreadIDs[:count]...)
	complete := count == len(subscriber.baselineThreadIDs)
	s.mu.Unlock()
	if s.threadsDB != nil {
		settings := make([]threadstore.ThreadSettings, 0, count)
		for _, id := range ids {
			item, err := s.threadsDB.GetThreadSettings(ctx, subscriber.endpointID, id)
			if err != nil {
				return err
			}
			if item != nil && item.ParentThreadID == "" {
				settings = append(settings, *item)
			}
		}
		page, err := s.threadListFromSettings(ctx, settings, "")
		if err != nil {
			return err
		}
		summaries = page.Threads
	}
	batches := []*flowerLiveEncodedBatch{newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamSummaryBatch, Summaries: summaries, ObserverID: subscriber.observerID, BaselineComplete: &complete,
	})}
	if s.ThreadReadState() != nil {
		snapshots := make(map[string]threadreadstate.FlowerSnapshot, len(summaries))
		for _, summary := range summaries {
			snapshots[summary.ThreadID] = threadreadstate.FlowerSnapshot{ActivityRevision: summary.FlowerActivity.ActivityRevision}
		}
		records, err := s.ThreadReadState().EnsureFlower(ctx, subscriber.endpointID, subscriber.userPublicID, snapshots)
		if err != nil {
			return err
		}
		for _, summary := range summaries {
			seen := records[summary.ThreadID].LastSeenActivityRevision
			status := FlowerThreadReadView{IsUnread: summary.FlowerActivity.ActivityRevision > seen, Snapshot: summary.FlowerActivity, ReadState: FlowerThreadReadRecord{LastSeenActivityRevision: seen}}
			batches = append(batches, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamViewerReadState, ThreadID: summary.ThreadID, ReadStatus: &status}))
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if subscriber.closed {
		return ErrFlowerLiveSync
	}
	for _, batch := range batches {
		if !retainFlowerLiveBatchLocked(s, subscriber, batch) {
			return ErrFlowerLiveSync
		}
		subscriber.initial = append(subscriber.initial, batch)
	}
	for index, id := range subscriber.baselineThreadIDs[:count] {
		cost := len(id)
		subscriber.queuedBytes -= cost
		s.flowerLiveQueuedBytes -= cost
		subscriber.baselineThreadIDs[index] = ""
	}
	subscriber.baselineThreadIDs = subscriber.baselineThreadIDs[count:]
	if complete {
		subscriber.queuedBytes -= subscriber.baselineArrayBytes
		s.flowerLiveQueuedBytes -= subscriber.baselineArrayBytes
		subscriber.baselineArrayBytes = 0
		subscriber.baselineThreadIDs = nil
		finalizeFlowerLiveSubscriberInitializationLocked(s, subscriber)
	}
	return nil
}

func (s *Service) refreshPendingComputerStatus(ctx context.Context, meta *session.Meta, targetID string) {
	if s == nil || meta == nil || s.threadRuntime == nil {
		return
	}
	summaries, err := s.listFlowerLiveBaseline(ctxOrBackground(ctx), meta)
	if err != nil {
		return
	}
	for _, summary := range summaries {
		current, err := s.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(summary.ThreadID))
		if err != nil {
			continue
		}
		for _, status := range s.flowerComputerStatusesForCurrent(ctxOrBackground(ctx), current, targetID) {
			s.publishFlowerComputerStatus(meta.EndpointID, status)
		}
	}
}

func (s *Service) listFlowerLiveBaseline(ctx context.Context, meta *session.Meta) ([]ThreadView, error) {
	var summaries []ThreadView
	cursor := ""
	seenCursors := make(map[string]struct{})
	for {
		page, err := s.ListThreads(ctx, meta, flowerLiveBaselinePageLimit, cursor)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, page.Threads...)
		next := strings.TrimSpace(page.NextCursor)
		if next == "" {
			return summaries, nil
		}
		if next == cursor {
			return nil, errors.New("flower live baseline cursor did not advance")
		}
		if _, repeated := seenCursors[next]; repeated {
			return nil, errors.New("flower live baseline cursor repeated")
		}
		seenCursors[next] = struct{}{}
		cursor = next
	}
}

func finalizeFlowerLiveSubscriberInitializationLocked(service *Service, subscriber *flowerLiveSubscriber) {
	if service == nil || subscriber == nil || subscriber.closed {
		return
	}
	// The paged, byte-budgeted baseline remains a prefix. Concurrent live
	// work uses the same bounded FIFO during and after initialization.
	subscriber.initializing = false
	wakeFlowerLiveSubscriberLocked(subscriber)
}

func (s *Service) broadcastFlowerSubagentsPatch(endpointID, parentThreadID string, subagents []FlowerSubagentSummary) {
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if s == nil || endpointID == "" || parentThreadID == "" {
		return
	}
	itemsCopy := make([]FlowerSubagentSummary, len(subagents))
	copy(itemsCopy, subagents)
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion,
		Kind:          FlowerLiveStreamThreadBatch,
		ThreadID:      parentThreadID,
		Subagents:     &itemsCopy,
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
}

func (s *Service) publishFlowerLiveSummary(endpointID string, summary ThreadView) {
	endpointID = strings.TrimSpace(endpointID)
	if s == nil || endpointID == "" || strings.TrimSpace(summary.ThreadID) == "" {
		return
	}
	encodeStartedAt := time.Now()
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion,
		Kind:          FlowerLiveStreamSummaryBatch,
		Summaries:     []ThreadView{summary},
	})
	s.flowerLiveMetrics.encodeNanoseconds.Add(uint64(time.Since(encodeStartedAt)))
	s.flowerLiveMetrics.batchEncoded(1, len(batch.data))
	fanoutStartedAt := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
	s.flowerLiveMetrics.fanoutNanoseconds.Add(uint64(time.Since(fanoutStartedAt)))
}

// PublishFlowerViewerReadState broadcasts a validated product-owned read state
// only to live views owned by the same endpoint user. Canonical shared batches
// never contain this viewer-private state.
func (s *Service) PublishFlowerViewerReadState(meta *session.Meta, threadID string, readStatus FlowerThreadReadView) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || userPublicID == "" || threadID == "" {
		return errors.New("invalid Flower viewer read state identity")
	}
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamViewerReadState,
		ThreadID: threadID, ReadStatus: &readStatus,
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.closed || subscriber.endpointID != endpointID || subscriber.userPublicID != userPublicID {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
	return nil
}

func newFlowerLiveEncodedBatch(envelope FlowerLiveStreamEnvelope) *flowerLiveEncodedBatch {
	sampledAt := time.Now()
	data, err := marshalFlowerLiveEnvelopeAt(envelope, sampledAt)
	batch := &flowerLiveEncodedBatch{kind: envelope.Kind, data: data, id: rand.Text(), readingRevision: envelope.ReadingRevision}
	if err != nil {
		batch.err = errors.Join(ErrFlowerLiveSync, err)
		batch.encodingDiagnostics = &flowerLiveEncodingDiagnostics{
			threadID: flowerLiveDiagnosticIdentity(identity.ThreadID(envelope.ThreadID)),
			current:  flowerLiveCurrentEncodingContext(envelope.Current), subagentCurrent: flowerLiveCurrentEncodingContext(envelope.SubagentCurrent),
		}
		return batch
	}
	if envelope.FactsOnly {
		batch.mailbox = "facts:" + envelope.ThreadID
		return batch
	}
	switch envelope.Kind {
	case FlowerLiveStreamSummaryBatch:
		if len(envelope.Summaries) == 1 {
			batch.mailbox = "summary:" + envelope.Summaries[0].ThreadID
		}
	case FlowerLiveStreamViewerReadState:
		batch.mailbox = "read:" + envelope.ThreadID
	case FlowerLiveStreamModelDirectoryChanged:
		batch.mailbox = "models"
	case FlowerLiveStreamComputerStatus:
		if status := envelope.ComputerStatus; status != nil {
			batch.mailbox = "computer:" + status.ThreadID + ":" + status.InteractionID + ":" + status.TargetID
		}
	case FlowerLiveStreamThreadBatch:
		if envelope.Subagents != nil {
			batch.mailbox = "subagents:" + envelope.ThreadID
		}
		update, current := envelope.Update, envelope.Current
		subagent := envelope.SubagentUpdate != nil || envelope.SubagentCurrent != nil
		if subagent {
			update, current = envelope.SubagentUpdate, envelope.SubagentCurrent
		}
		if update != nil {
			batch.route = flowerLiveRoute{update.ThreadID.String(), envelope.ThreadID, subagent}
			batch.baseVersion, batch.version = update.BaseVersion, update.ViewVersion
			if flowerLiveGrowthOnlyUpdate(update) {
				change := update.Items[0]
				facts, _ := json.Marshal(projectFlowerFacts(update.Facts, update.ThreadID.String(), update.TurnID.String(), update.RunID.String(), sampledAt))
				append := &flowerLiveAppend{turnID: update.TurnID, runID: update.RunID, itemID: change.ItemID, body: change.Body, facts: facts}
				if change.Append != nil {
					append.offset, append.text = change.Append.OffsetBytes, change.Append.Text
				}
				stableFacts := update.Facts
				if progress := update.Facts.RunProgress; progress != nil && progress.Request != nil {
					progressCopy, requestCopy := *progress, *progress.Request
					append.outputTokens = requestCopy.EstimatedOutputTokens
					if requestCopy.LastProgressAt != nil {
						append.lastProgressAt = *requestCopy.LastProgressAt
					}
					requestCopy.EstimatedOutputTokens, requestCopy.LastProgressAt = 0, nil
					progressCopy.Request, stableFacts.RunProgress = &requestCopy, &progressCopy
				}
				nativeFacts, _ := json.Marshal(stableFacts)
				append.factsKey = sha256.Sum256(nativeFacts)
				batch.append = append
			}
		} else if current != nil {
			batch.route = flowerLiveRoute{current.ThreadID.String(), envelope.ThreadID, subagent}
			batch.version, batch.current = current.ViewVersion, true
		}
	}
	return batch
}

func flowerLiveCurrentEncodingContext(current *flruntime.ThreadView) *flowerLiveCurrentEncodingDiagnostics {
	if current == nil {
		return nil
	}
	return &flowerLiveCurrentEncodingDiagnostics{
		threadID: flowerLiveDiagnosticIdentity(current.ThreadID), turnID: flowerLiveDiagnosticIdentity(current.TurnID),
		runID: flowerLiveDiagnosticIdentity(current.RunID), viewVersion: current.ViewVersion,
	}
}

// Malformed identities may contain private data; diagnostics retain only valid
// identifiers rather than echoing arbitrary runtime values into logs.
func flowerLiveDiagnosticIdentity(value interface {
	String() string
	MarshalText() ([]byte, error)
}) string {
	if value.String() == "" {
		return ""
	}
	if _, err := value.MarshalText(); err != nil {
		return "[invalid]"
	}
	return logsafe.Text(value.String(), 256)
}

func wakeFlowerLiveSubscriberLocked(subscriber *flowerLiveSubscriber) {
	if subscriber.wake == nil {
		subscriber.wake = make(chan struct{}, 1)
	}
	select {
	case subscriber.wake <- struct{}{}:
	default:
	}
}

func validateFlowerLiveBatchLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if service == nil || subscriber == nil || subscriber.closed || batch == nil {
		return false
	}
	if batch.err != nil || len(batch.data) == 0 && !batch.refresh {
		subscriber.closeErr = ErrFlowerLiveSync
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseEncoding, batch)
		return false
	}
	if len(batch.data) > flowerLiveEnvelopeByteLimit {
		subscriber.closeErr = ErrFlowerLiveSync
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseOversizedEnvelope)
		return false
	}
	return true
}

func retainFlowerLiveBatchLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if !validateFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	if subscriber.queuedBytes+subscriber.mediaBytes+batch.bytes() > flowerLiveEnvelopeByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseByteQueueLimit, batch)
		return false
	}
	if service.flowerLiveQueuedBytes+batch.bytes() > flowerLiveGlobalQueuedByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseGlobalQueueLimit, batch)
		return false
	}
	subscriber.queuedBytes += batch.bytes()
	service.flowerLiveQueuedBytes += batch.bytes()
	return true
}

// Media stays lossy and separate from the lifecycle queue, but its retained
// bytes still count against the connection and global memory limits.
func replaceFlowerLiveSubscriberMediaLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if service == nil || subscriber == nil || subscriber.closed || batch == nil {
		return false
	}
	select {
	case previous := <-subscriber.media:
		subscriber.mediaBytes -= previous.bytes()
		service.flowerLiveQueuedBytes -= previous.bytes()
	default:
	}
	if batch.err != nil || len(batch.data) == 0 || len(batch.data) > flowerLiveEnvelopeByteLimit ||
		subscriber.queuedBytes+subscriber.mediaBytes+batch.bytes() > flowerLiveEnvelopeByteLimit ||
		service.flowerLiveQueuedBytes+batch.bytes() > flowerLiveGlobalQueuedByteLimit {
		return false
	}
	subscriber.mediaBytes += batch.bytes()
	service.flowerLiveQueuedBytes += batch.bytes()
	subscriber.media <- batch
	wakeFlowerLiveSubscriberLocked(subscriber)
	return true
}

func releaseFlowerLiveBatchLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) {
	subscriber.queuedBytes -= batch.bytes()
	service.flowerLiveQueuedBytes -= batch.bytes()
}

func enqueueFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if !validateFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	if route := batch.route; route.threadID != "" {
		if version := subscriber.covered[route]; version != 0 && batch.readingRevision == 0 {
			if batch.version >= version {
				delete(subscriber.covered, route)
				subscriber.queuedBytes -= route.bytes()
				service.flowerLiveQueuedBytes -= route.bytes()
			}
			if batch.version <= version {
				return true
			}
			// A delta spanning a frozen snapshot cannot be applied partially.
			if !batch.current && batch.baseVersion < version {
				batch = flowerLiveRefreshBatch(batch)
			}
		}
		if subscriber.initializing && batch.readingRevision == 0 {
			batch = flowerLiveRefreshBatch(batch)
		}
		for index := len(subscriber.queue) - 1; index >= 0; index-- {
			previous := subscriber.queue[index]
			// A new reading selection can have the same canonical version. Its
			// baseline is an independent ordering boundary, not duplicate output.
			if previous.route != route || previous.readingRevision != batch.readingRevision {
				continue
			}
			if batch.version <= previous.version {
				return true
			}
			if batch.current {
				return convergeFlowerLiveRouteLocked(service, subscriber, batch)
			}
			if previous.refresh || batch.refresh {
				return convergeFlowerLiveRouteLocked(service, subscriber, flowerLiveRefreshBatch(batch))
			}
			if index == len(subscriber.queue)-1 {
				if merged := mergeFlowerLiveGrowthBatches(previous, batch); merged != nil {
					return replaceFlowerLiveQueuedBatchLocked(service, subscriber, index, merged)
				}
			}
			// A semantic boundary or a full append fragment is not backpressure.
			// Keep ordered deltas while the existing queue has capacity; turning
			// every item switch into a historical view amplifies a small backlog.
			continuous := previous.version == batch.baseVersion
			if a, b := previous.append, batch.append; a != nil && b != nil &&
				a.body == nil && b.body == nil && a.turnID == b.turnID && a.runID == b.runID && a.itemID == b.itemID {
				continuous = continuous && a.offset+len(a.text) == b.offset
			}
			if continuous && len(subscriber.queue) < flowerLiveSubscriberBatchLimit &&
				subscriber.queuedBytes+subscriber.mediaBytes+batch.bytes() <= flowerLiveEnvelopeByteLimit &&
				service.flowerLiveQueuedBytes+batch.bytes() <= flowerLiveGlobalQueuedByteLimit {
				return appendFlowerLiveQueuedBatchLocked(service, subscriber, batch)
			}
			// A real capacity boundary or sequence gap converges from authority.
			// Retire all queued deltas covered by the replacement, not just the last.
			return convergeFlowerLiveRouteLocked(service, subscriber, flowerLiveRefreshBatch(batch))
		}
	}
	if batch.mailbox != "" {
		for index, previous := range subscriber.queue {
			if previous.mailbox == batch.mailbox {
				return replaceFlowerLiveQueuedBatchLocked(service, subscriber, index, batch)
			}
		}
	}
	return appendFlowerLiveQueuedBatchLocked(service, subscriber, batch)
}

func flowerLiveRefreshBatch(batch *flowerLiveEncodedBatch) *flowerLiveEncodedBatch {
	return &flowerLiveEncodedBatch{kind: FlowerLiveStreamThreadBatch, route: batch.route, version: batch.version, refresh: true, readingRevision: batch.readingRevision}
}

// One canonical replacement covers every queued delta for this exact route.
// Other threads, viewer metadata, and an already-started envelope keep their order.
func convergeFlowerLiveRouteLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	first, kept := -1, 0
	for _, queued := range subscriber.queue {
		if queued.route == batch.route && queued.readingRevision == batch.readingRevision {
			if first >= 0 {
				releaseFlowerLiveBatchLocked(service, subscriber, queued)
				continue
			}
			first = kept
		}
		subscriber.queue[kept] = queued
		kept++
	}
	clear(subscriber.queue[kept:])
	subscriber.queue = subscriber.queue[:kept]
	if first < 0 {
		return appendFlowerLiveQueuedBatchLocked(service, subscriber, batch)
	}
	return replaceFlowerLiveQueuedBatchLocked(service, subscriber, first, batch)
}

func appendFlowerLiveQueuedBatchLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if !validateFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	if len(subscriber.queue) >= flowerLiveSubscriberBatchLimit {
		reason := flowerLiveSubscriberCloseBatchQueueLimit
		if subscriber.initializing {
			reason = flowerLiveSubscriberCloseInitQueueLimit
		}
		closeFlowerLiveSubscriberLocked(service, subscriber, reason, batch)
		return false
	}
	if !retainFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	subscriber.queue = append(subscriber.queue, batch)
	wakeFlowerLiveSubscriberLocked(subscriber)
	return true
}

// Re-encoding is bounded to one fragment, independent of total streamed text.
// Larger growth remains in separate ordered chunks while queue capacity allows.
func mergeFlowerLiveGrowthBatches(before, after *flowerLiveEncodedBatch) *flowerLiveEncodedBatch {
	if before.readingRevision != after.readingRevision {
		return nil
	}
	a, b := before.append, after.append
	if a == nil || b == nil || before.route != after.route || a.turnID != b.turnID || a.runID != b.runID || a.itemID != b.itemID ||
		before.version != after.baseVersion || a.factsKey != b.factsKey ||
		b.outputTokens < a.outputTokens || b.lastProgressAt.Before(a.lastProgressAt) ||
		len(before.data)+len(after.data) > flowerLiveFragmentByteLimit {
		return nil
	}
	merged := *b
	var change flruntime.ThreadItemChange
	if a.body != nil || b.body != nil {
		if a.body == nil || b.body == nil || a.body.RunID != b.body.RunID || a.body.SourceID != b.body.SourceID || a.body.EntryID != b.body.EntryID || a.body.Field != b.body.Field || a.body.PreviewBytes != b.body.PreviewBytes || b.body.Bytes < a.body.Bytes {
			return nil
		}
		change = flruntime.ThreadItemChange{Kind: flruntime.ThreadItemBodyUpdated, ItemID: b.itemID, Body: b.body}
	} else {
		if a.offset+len(a.text) != b.offset {
			return nil
		}
		merged.offset, merged.text = a.offset, a.text+b.text
		change = flruntime.ThreadItemChange{Kind: flruntime.ThreadItemAppended, ItemID: b.itemID, Append: &flruntime.ThreadTextAppend{OffsetBytes: merged.offset, Text: merged.text}}
	}
	update := struct {
		ThreadID    string                       `json:"thread_id"`
		TurnID      identity.TurnID              `json:"turn_id,omitempty"`
		RunID       identity.RunID               `json:"run_id,omitempty"`
		BaseVersion uint64                       `json:"base_version"`
		ViewVersion uint64                       `json:"view_version"`
		Facts       json.RawMessage              `json:"facts"`
		Items       []flruntime.ThreadItemChange `json:"items"`
	}{after.route.threadID, b.turnID, b.runID, before.baseVersion, after.version, b.facts,
		[]flruntime.ThreadItemChange{change}}
	raw, err := json.Marshal(update)
	envelope := struct {
		ReadingRevision uint64               `json:"reading_revision,omitempty"`
		SchemaVersion   int64                `json:"schema_version"`
		Kind            FlowerLiveStreamKind `json:"kind"`
		ThreadID        string               `json:"thread_id,omitempty"`
		Update          json.RawMessage      `json:"update,omitempty"`
		SubagentUpdate  json.RawMessage      `json:"subagent_update,omitempty"`
	}{SchemaVersion: FlowerLiveSchemaVersion, Kind: after.kind, ThreadID: after.route.wireID, ReadingRevision: after.readingRevision}
	if after.route.subagent {
		envelope.SubagentUpdate = raw
	} else {
		envelope.Update = raw
	}
	data, encodeErr := json.Marshal(envelope)
	return &flowerLiveEncodedBatch{kind: after.kind, route: after.route, baseVersion: before.baseVersion, version: after.version, readingRevision: after.readingRevision,
		data: data, id: rand.Text(), append: &merged, err: errors.Join(err, encodeErr)}
}

func flowerLiveGrowthOnlyUpdate(update *flruntime.ThreadUpdate) bool {
	return update != nil && len(update.Items) == 1 && update.Items[0].Item == nil &&
		(update.Items[0].Kind == flruntime.ThreadItemAppended && update.Items[0].Append != nil && update.Items[0].Body == nil ||
			update.Items[0].Kind == flruntime.ThreadItemBodyUpdated && update.Items[0].Body != nil && update.Items[0].Append == nil) &&
		update.Facts.Activity == flruntime.ThreadActivityActive && update.Facts.Failure == nil && update.Facts.Cancellation == nil && update.Facts.LastOutcome == nil &&
		update.Facts.Attention.ApprovalCount == 0 && update.Facts.Attention.InputCount == 0 &&
		update.ItemOrder == nil && update.Context == nil && update.Goal == nil && update.ParentEvents == nil && update.Turns == nil &&
		update.Queue == nil && update.Interactions == nil && update.ToolCallPreviews == nil && update.RestoredInputs == nil && update.Window == nil
}

func replaceFlowerLiveQueuedBatchLocked(service *Service, subscriber *flowerLiveSubscriber, index int, batch *flowerLiveEncodedBatch) bool {
	if !validateFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	old := subscriber.queue[index]
	if batch.refresh && service.log != nil && time.Since(subscriber.pressureLoggedAt) >= 5*time.Second {
		subscriber.pressureLoggedAt = time.Now()
		service.log.Info("ai: Flower live subscriber converging", "subscriber_id", subscriber.id,
			"initializing", subscriber.initializing, "queued_batches", len(subscriber.queue),
			"queued_bytes", subscriber.queuedBytes, "global_queued_bytes", service.flowerLiveQueuedBytes,
			"batch_kind", old.kind, "batch_bytes", old.bytes(),
			"thread_id", flowerLiveDiagnosticIdentity(identity.ThreadID(batch.route.threadID)),
			"wire_thread_id", flowerLiveDiagnosticIdentity(identity.ThreadID(batch.route.wireID)),
			"subagent", batch.route.subagent, "base_version", old.baseVersion, "view_version", batch.version)
	}
	// Release before retention so the replacement never needs two queue budgets.
	releaseFlowerLiveBatchLocked(service, subscriber, old)
	subscriber.queue[index] = nil
	if !retainFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	subscriber.queue[index] = batch
	wakeFlowerLiveSubscriberLocked(subscriber)
	return true
}

// resolveFlowerLiveRefresh keeps the marker in the queue while reading. New
// publications update that same slot. The snapshot covers old deltas; any newer
// publication leaves one marker behind, without waiting for a quiet producer.
func (s *FlowerLiveStreamSubscription) resolveFlowerLiveRefresh(ctx context.Context, marker *flowerLiveEncodedBatch) error {
	if marker.readingRevision != 0 {
		s.service.mu.Lock()
		defer s.service.mu.Unlock()
		subscriber := s.subscriber
		interest := &subscriber.history
		parentID := ""
		if marker.route.subagent {
			interest, parentID = &subscriber.subagentHistory, marker.route.wireID
		}
		if !subscriber.closed && interest.revision == marker.readingRevision {
			invalidateFlowerHistoryInterestLocked(s.service, subscriber, interest, marker.route.threadID, parentID)
		} else {
			// A newer baseline supersedes this refresh. Retire only the obsolete
			// marker so Next cannot spin on it or invalidate the current interest.
			for index, queued := range subscriber.queue {
				if queued != marker {
					continue
				}
				releaseFlowerLiveBatchLocked(s.service, subscriber, queued)
				copy(subscriber.queue[index:], subscriber.queue[index+1:])
				subscriber.queue[len(subscriber.queue)-1] = nil
				subscriber.queue = subscriber.queue[:len(subscriber.queue)-1]
				break
			}
		}
		return nil
	}
	if s.service.threadRuntime == nil {
		return ErrFlowerLiveSync
	}
	current, err := s.service.threadRuntime.View(ctx, identity.ThreadID(marker.route.threadID))
	if err != nil {
		return errors.Join(ErrFlowerLiveSync, err)
	}
	envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: marker.route.wireID}
	if marker.route.subagent {
		envelope.SubagentCurrent = &current
	} else {
		envelope.Current = &current
	}
	envelope.updateEvidence = &current
	batch := newFlowerLiveEncodedBatch(envelope)
	s.service.mu.Lock()
	defer s.service.mu.Unlock()
	subscriber := s.subscriber
	if subscriber.closed {
		return ErrFlowerLiveSync
	}
	if current.ThreadID.String() != marker.route.threadID || current.ViewVersion < marker.version || !validateFlowerLiveBatchLocked(s.service, subscriber, batch) {
		return ErrFlowerLiveSync
	}
	// A page switch can retire this marker while its canonical read runs.
	if len(subscriber.queue) == 0 || subscriber.queue[0].route != marker.route || subscriber.queue[0].readingRevision != marker.readingRevision || (marker.readingRevision != 0 && subscriber.history.revision != marker.readingRevision) {
		return nil
	}
	latest := subscriber.queue[0]
	if latest.version <= current.ViewVersion {
		releaseFlowerLiveBatchLocked(s.service, subscriber, latest)
		subscriber.queue[0] = nil
		subscriber.queue = subscriber.queue[1:]
	} // Otherwise leave the updated marker for the next read after this snapshot.
	// Only a view ahead of the ordered publication pump needs a watermark.
	// If the marker already reached this version, all covered deltas arrived.
	if current.ViewVersion > latest.version && subscriber.covered[marker.route] == 0 {
		cost := marker.route.bytes()
		if subscriber.queuedBytes+subscriber.mediaBytes+cost > flowerLiveEnvelopeByteLimit ||
			s.service.flowerLiveQueuedBytes+cost > flowerLiveGlobalQueuedByteLimit {
			closeFlowerLiveSubscriberLocked(s.service, subscriber, flowerLiveSubscriberCloseGlobalQueueLimit, marker)
			return ErrFlowerLiveSync
		}
		subscriber.queuedBytes += cost
		s.service.flowerLiveQueuedBytes += cost
	}
	if current.ViewVersion > latest.version {
		if subscriber.covered == nil {
			subscriber.covered = make(map[flowerLiveRoute]uint64)
		}
		subscriber.covered[marker.route] = current.ViewVersion
	}
	if !retainFlowerLiveBatchLocked(s.service, subscriber, batch) {
		return ErrFlowerLiveSync
	}
	subscriber.active, subscriber.activeIndex, subscriber.activeAccounted = batch, 0, true
	return nil
}

func closeFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, reason flowerLiveSubscriberCloseReason, failedBatch ...*flowerLiveEncodedBatch) {
	if subscriber == nil || subscriber.closed {
		return
	}
	queuedBatches := len(subscriber.queue) + len(subscriber.initial)
	queuedBytes := subscriber.queuedBytes + subscriber.mediaBytes
	globalBytes := service.flowerLiveQueuedBytes
	subscriber.closed = true
	if subscriber.observerStop != nil {
		subscriber.observerStop()
		subscriber.observerStop = nil
	}
	if subscriber.observerCancel != nil {
		subscriber.observerCancel()
	}
	subscriber.baselineThreadIDs = nil
	subscriber.baselineArrayBytes = 0
	if subscriber.history.cancel != nil {
		subscriber.history.cancel()
	}
	if subscriber.subagentHistory.cancel != nil {
		subscriber.subagentHistory.cancel()
	}
	if subscriber.viewerCancel != nil {
		subscriber.viewerCancel()
	}
	if subscriber.viewerStop != nil {
		go subscriber.viewerStop()
		subscriber.viewerStop = nil
		subscriber.viewerCancel = nil
	}
	service.flowerLiveQueuedBytes -= subscriber.queuedBytes + subscriber.mediaBytes
	subscriber.queuedBytes = 0
	subscriber.mediaBytes = 0
	subscriber.initial = nil
	subscriber.active = nil
	subscriber.queue = nil
	subscriber.covered = nil
	delete(service.flowerLiveSubscribers, subscriber.id)
	if service.flowerLiveSubscribersByEndpoint[subscriber.endpointID] > 0 {
		service.flowerLiveSubscribersByEndpoint[subscriber.endpointID]--
	}
	service.flowerLiveMetrics.subscriberClosed()
	service.flowerLiveMetrics.subscriberDropped(reason)
	if service.log != nil && reason != flowerLiveSubscriberCloseClient && reason != flowerLiveSubscriberCloseService {
		attrs := []any{
			"endpoint_id", logsafe.Text(subscriber.endpointID, 256),
			"subscriber_id", subscriber.id,
			"reason", reason,
			"queued_batches", queuedBatches,
			"queued_bytes", queuedBytes,
			"initializing", subscriber.initializing,
			"queue_limit", flowerLiveSubscriberBatchLimit,
			"global_queued_bytes", globalBytes,
		}
		if len(failedBatch) > 0 && failedBatch[0] != nil {
			batch := failedBatch[0]
			attrs = append(attrs, "batch_kind", batch.kind, "batch_bytes", batch.bytes(),
				"thread_id", flowerLiveDiagnosticIdentity(identity.ThreadID(batch.route.threadID)),
				"wire_thread_id", flowerLiveDiagnosticIdentity(identity.ThreadID(batch.route.wireID)),
				"subagent", batch.route.subagent, "refresh", batch.refresh, "base_version", batch.baseVersion, "view_version", batch.version)
		}
		if reason == flowerLiveSubscriberCloseEncoding && len(failedBatch) > 0 && failedBatch[0] != nil {
			batch := failedBatch[0]
			attrs = append(attrs, "kind", batch.kind, "error", logsafe.Error(batch.err))
			if diagnostics := batch.encodingDiagnostics; diagnostics != nil {
				attrs = append(attrs, "thread_id", diagnostics.threadID)
				if current := diagnostics.current; current != nil {
					attrs = append(attrs, "current_thread_id", current.threadID, "turn_id", current.turnID, "run_id", current.runID, "view_version", current.viewVersion)
				}
				if current := diagnostics.subagentCurrent; current != nil {
					attrs = append(attrs, "subagent_thread_id", current.threadID, "subagent_turn_id", current.turnID, "subagent_run_id", current.runID, "subagent_view_version", current.viewVersion)
				}
			}
		}
		service.log.Warn("ai: Flower live subscriber closed", attrs...)
	}
	select {
	case <-subscriber.media:
	default:
	}
	wakeFlowerLiveSubscriberLocked(subscriber)
}

func (service *Service) fenceFlowerLiveEndpoint(endpointID string) {
	if service == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	for _, subscriber := range service.flowerLiveSubscribers {
		if subscriber.endpointID == endpointID {
			closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseSummaryRefresh)
		}
	}
}

func closeFlowerLiveSubscribersLocked(service *Service) {
	if service == nil {
		return
	}
	for _, subscriber := range service.flowerLiveSubscribers {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseService)
	}
	service.flowerLiveSubscribers = make(map[uint64]*flowerLiveSubscriber)
	service.flowerLiveSubscribersByEndpoint = make(map[string]int)
}

func closeFlowerLiveSubscription(service *Service, subscriber *flowerLiveSubscriber) {
	if service == nil || subscriber == nil {
		return
	}
	service.mu.Lock()
	closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseClient)
	service.mu.Unlock()
}

func (s *FlowerLiveStreamSubscription) Next(ctx context.Context) (*FlowerLiveStreamFrame, error) {
	if s == nil || s.subscriber == nil || s.service == nil {
		return nil, io.EOF
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.nextMu.Lock()
	defer s.nextMu.Unlock()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		s.service.mu.Lock()
		subscriber := s.subscriber
		if subscriber.closed {
			err := subscriber.closeErr
			s.service.mu.Unlock()
			if err != nil {
				return nil, err
			}
			return nil, io.EOF
		}
		if subscriber.active == nil {
			// Lifecycle work always wins over optional lossy media.
			if len(subscriber.initial) > 0 {
				subscriber.active = subscriber.initial[0]
				subscriber.initial[0] = nil
				subscriber.initial = subscriber.initial[1:]
				subscriber.activeAccounted = true
			} else if subscriber.initializing && len(subscriber.baselineThreadIDs) > 0 {
				// Detail baselines are delivered over their request. Their matching live
				// updates must not wait for unrelated sidebar histories to finish.
				for index, candidate := range subscriber.queue {
					if candidate.readingRevision == 0 {
						continue
					}
					if candidate.refresh {
						s.service.mu.Unlock()
						if err := s.resolveFlowerLiveRefresh(ctx, candidate); err != nil {
							return nil, err
						}
						s.service.mu.Lock()
						break
					}
					subscriber.active = candidate
					copy(subscriber.queue[index:], subscriber.queue[index+1:])
					subscriber.queue[len(subscriber.queue)-1] = nil
					subscriber.queue = subscriber.queue[:len(subscriber.queue)-1]
					subscriber.activeAccounted = true
					break
				}
				if !subscriber.baselineReading {
					subscriber.baselineReading = true
					s.service.serviceWorkers.Add(1)
					go s.readBaselinePage()
				}
			} else if len(subscriber.queue) > 0 {
				if marker := subscriber.queue[0]; marker.refresh {
					s.service.mu.Unlock()
					if err := s.resolveFlowerLiveRefresh(ctx, marker); err != nil {
						if ctx.Err() != nil {
							return nil, ctx.Err()
						}
						s.service.mu.Lock()
						subscriber.closeErr = ErrFlowerLiveSync
						closeFlowerLiveSubscriberLocked(s.service, subscriber, flowerLiveSubscriberCloseSummaryRefresh, marker)
						s.service.mu.Unlock()
						return nil, err
					}
					continue
				}
				subscriber.active = subscriber.queue[0]
				subscriber.queue[0] = nil
				subscriber.queue = subscriber.queue[1:]
				subscriber.activeAccounted = true
			} else {
				select {
				case subscriber.active = <-subscriber.media:
					subscriber.activeAccounted = false
				default:
				}
			}
			subscriber.activeIndex = 0
		}
		if batch := subscriber.active; batch != nil {
			if batch.err != nil || len(batch.data) == 0 || len(batch.data) > flowerLiveEnvelopeByteLimit {
				subscriber.closeErr = ErrFlowerLiveSync
				closeFlowerLiveSubscriberLocked(s.service, subscriber, flowerLiveSubscriberCloseEncoding, batch)
				s.service.mu.Unlock()
				return nil, ErrFlowerLiveSync
			}
			if batch.id == "" {
				batch.id = rand.Text()
			}
			if len(batch.data) <= flowerLiveFragmentByteLimit {
				if subscriber.activeAccounted {
					releaseFlowerLiveBatchLocked(s.service, subscriber, batch)
				} else {
					subscriber.mediaBytes -= batch.bytes()
					s.service.flowerLiveQueuedBytes -= batch.bytes()
				}
				subscriber.active = nil
				s.service.mu.Unlock()
				return &FlowerLiveStreamFrame{Kind: batch.kind, Data: batch.data}, nil
			}
			count := (len(batch.data) + flowerLiveFragmentByteLimit - 1) / flowerLiveFragmentByteLimit
			offset := subscriber.activeIndex * flowerLiveFragmentByteLimit
			end := min(offset+flowerLiveFragmentByteLimit, len(batch.data))
			fragment := FlowerLiveStreamFragment{
				EnvelopeID: batch.id, FragmentIndex: subscriber.activeIndex, FragmentCount: count,
				TotalBytes: len(batch.data), DataBase64: base64.StdEncoding.EncodeToString(batch.data[offset:end]),
			}
			data, err := json.Marshal(fragment)
			// Next retains at most one encoded wire frame. No list of fragments
			// is ever queued, so the pending-frame budget stays independent of
			// the complete envelope's retained-byte budget.
			if err != nil || len(data) > flowerLiveFrameByteLimit || len(data) > flowerLivePendingFrameByteLimit {
				subscriber.closeErr = ErrFlowerLiveSync
				closeFlowerLiveSubscriberLocked(s.service, subscriber, flowerLiveSubscriberCloseEncoding)
				s.service.mu.Unlock()
				return nil, ErrFlowerLiveSync
			}
			subscriber.activeIndex++
			if subscriber.activeIndex == count {
				if subscriber.activeAccounted {
					releaseFlowerLiveBatchLocked(s.service, subscriber, batch)
				} else {
					subscriber.mediaBytes -= batch.bytes()
					s.service.flowerLiveQueuedBytes -= batch.bytes()
				}
				subscriber.active = nil
			}
			s.service.mu.Unlock()
			return &FlowerLiveStreamFrame{Kind: batch.kind, Data: data}, nil
		}
		wake := subscriber.wake
		s.service.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-wake:
		}
	}
}

func (s *FlowerLiveStreamSubscription) Close() {
	if s == nil || s.subscriber == nil || s.service == nil {
		return
	}
	s.closeOnce.Do(func() {
		closeFlowerLiveSubscription(s.service, s.subscriber)
	})
}

func (s *Service) flowerLiveSubscriberCount(endpointID string) int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flowerLiveSubscribersByEndpoint[strings.TrimSpace(endpointID)]
}

// At most one page reader per workspace; the next page starts only after the
// prior page drains. Closing the observer cancels storage and releases its slot.
func (s *FlowerLiveStreamSubscription) readBaselinePage() {
	defer s.service.serviceWorkers.Done()
	err := s.loadBaselinePage(s.subscriber.observerContext)
	s.service.mu.Lock()
	defer s.service.mu.Unlock()
	subscriber := s.subscriber
	subscriber.baselineReading = false
	if err != nil && !subscriber.closed {
		subscriber.closeErr = ErrFlowerLiveSync
		closeFlowerLiveSubscriberLocked(s.service, subscriber, flowerLiveSubscriberCloseSummaryRefresh)
	}
	wakeFlowerLiveSubscriberLocked(subscriber)
}
