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
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

const (
	flowerLiveMaxSubscribersPerEndpoint = 256
	flowerLiveBaselinePageLimit         = 200
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
	ObserverID          string                        `json:"observer_id,omitempty"`
	SchemaVersion       int64                         `json:"schema_version"`
	Kind                FlowerLiveStreamKind          `json:"kind"`
	ThreadID            string                        `json:"thread_id,omitempty"`
	Summaries           []ThreadView                  `json:"summaries,omitempty"`
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
		batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerStatus, ThreadID: status.ThreadID, ComputerStatus: &status})
		s.mu.Lock()
		for _, subscriber := range s.flowerLiveSubscribers {
			if subscriber.endpointID == endpointID && !subscriber.closed {
				enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
			}
		}
		s.mu.Unlock()
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

// Every public envelope takes this wire path, including one-fragment envelopes.
// Fragmentation happens after the public projection has removed private fields.
type FlowerLiveStreamFragment struct {
	EnvelopeID    string `json:"envelope_id"`
	FragmentIndex int    `json:"fragment_index"`
	FragmentCount int    `json:"fragment_count"`
	TotalBytes    int    `json:"total_bytes"`
	DataBase64    string `json:"data_base64"`
}

type flowerLiveEncodedBatch struct {
	kind                FlowerLiveStreamKind
	data                []byte
	id                  string
	err                 error
	encodingDiagnostics *flowerLiveEncodingDiagnostics
	current             *flowerLiveCurrentComparison
}

// Comparison data is frozen once, outside subscriber fanout and its lock. The
// fingerprint excludes version, sample time, growing text and replaceable progress numbers.
type flowerLiveCurrentComparison struct {
	threadID    string
	routeID     string
	subagent    bool
	version     uint64
	fingerprint [sha256.Size]byte
	texts       []string
	metrics     []int64
	independent bool
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
	observerID      string
	observerContext context.Context
	viewerMu        sync.Mutex
	viewerRevision  uint64
	viewerRequest   ComputerViewerRequest
	viewerCancel    context.CancelFunc
	viewerStop      func()
	id              uint64
	endpointID      string
	userPublicID    string
	queue           []*flowerLiveEncodedBatch
	media           chan *flowerLiveEncodedBatch
	queuedBytes     int
	mediaBytes      int
	initializing    bool
	initial         []*flowerLiveEncodedBatch
	active          *flowerLiveEncodedBatch
	activeIndex     int
	activeAccounted bool
	wake            chan struct{}
	closeErr        error
	closed          bool
}

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
	subscriber := &flowerLiveSubscriber{
		observerID: rand.Text(), observerContext: ctx,
		id: s.flowerLiveSubscriberSeq, endpointID: endpointID, userPublicID: userPublicID,
		media: make(chan *flowerLiveEncodedBatch, 1), wake: make(chan struct{}, 1),
		initializing: true,
	}
	s.flowerLiveSubscribers[subscriber.id] = subscriber
	s.flowerLiveSubscribersByEndpoint[endpointID]++
	s.flowerLiveMetrics.subscriberOpened()
	s.mu.Unlock()

	var summaries []ThreadView
	if s.threadsDB != nil {
		var err error
		summaries, err = s.listFlowerLiveBaseline(ctxOrBackground(ctx), meta)
		if err != nil {
			closeFlowerLiveSubscription(s, subscriber)
			return nil, err
		}
	}
	retainInitial := func(batch *flowerLiveEncodedBatch) bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		if !retainFlowerLiveBatchLocked(s, subscriber, batch) {
			return false
		}
		subscriber.initial = append(subscriber.initial, batch)
		return true
	}
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady, Summaries: summaries, ObserverID: subscriber.observerID,
	})
	retained := retainInitial(ready)
	if retained && s.ThreadReadState() != nil {
		snapshots := make(map[string]threadreadstate.FlowerSnapshot, len(summaries))
		for _, summary := range summaries {
			snapshots[summary.ThreadID] = threadreadstate.FlowerSnapshot{ActivityRevision: summary.FlowerActivity.ActivityRevision}
		}
		records, err := s.ThreadReadState().EnsureFlower(ctxOrBackground(ctx), endpointID, userPublicID, snapshots)
		if err != nil {
			closeFlowerLiveSubscription(s, subscriber)
			return nil, err
		}
		for _, summary := range summaries {
			seen := records[summary.ThreadID].LastSeenActivityRevision
			status := FlowerThreadReadView{
				IsUnread:  summary.FlowerActivity.ActivityRevision > seen,
				Snapshot:  summary.FlowerActivity,
				ReadState: FlowerThreadReadRecord{LastSeenActivityRevision: seen},
			}
			retained = retainInitial(newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamViewerReadState,
				ThreadID: summary.ThreadID, ReadStatus: &status,
			}))
			if !retained {
				break
			}
		}
	}
	if retained && s.threadRuntime != nil {
		for _, summary := range summaries {
			if !flowerLiveSummaryNeedsCurrentBaseline(summary) {
				continue
			}
			current, viewErr := s.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(summary.ThreadID))
			if viewErr != nil {
				continue
			}
			copy := current
			copy.Items, viewErr = s.hydrateActivityTargets(ctx, meta, summary.ThreadID, copy.Items)
			if viewErr != nil {
				closeFlowerLiveSubscription(s, subscriber)
				return nil, viewErr
			}
			if !retainInitial(newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion,
				Kind:          FlowerLiveStreamThreadBatch,
				ThreadID:      summary.ThreadID,
				Current:       &copy,
			})) {
				break
			}
			for _, status := range s.flowerComputerStatusesForCurrent(ctxOrBackground(ctx), current, "") {
				statusCopy := status
				if !retainInitial(newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
					SchemaVersion:  FlowerLiveSchemaVersion,
					Kind:           FlowerLiveStreamComputerStatus,
					ThreadID:       status.ThreadID,
					ComputerStatus: &statusCopy,
				})) {
					break
				}
			}
		}
	}
	s.mu.Lock()
	finalizeFlowerLiveSubscriberInitializationLocked(s, subscriber)
	s.mu.Unlock()
	return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
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
	// The complete, byte-budgeted baseline remains a prefix. Concurrent live
	// work uses the same bounded FIFO during and after initialization.
	subscriber.initializing = false
	wakeFlowerLiveSubscriberLocked(subscriber)
}

func flowerLiveSummaryNeedsCurrentBaseline(summary ThreadView) bool {
	switch NormalizeRunState(summary.RunStatus) {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateWaitingUser, RunStateRecovering, RunStateFinalizing:
		return true
	default:
		return false
	}
}

func (s *Service) broadcastFlowerRuntimeCurrent(endpointID string, current flruntime.ThreadView) {
	if s == nil || strings.TrimSpace(endpointID) == "" || current.ThreadID == "" {
		return
	}
	copy := current
	envelope := FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion,
		Kind:          FlowerLiveStreamThreadBatch,
		ThreadID:      current.ThreadID.String(),
		Current:       &copy,
	}
	batch := newFlowerLiveEncodedBatch(envelope)
	s.mu.Lock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
	s.mu.Unlock()
	for _, status := range s.flowerComputerStatusesForCurrent(context.Background(), current, "") {
		s.publishFlowerComputerStatus(endpointID, status)
	}
}

func (s *Service) broadcastFlowerSubagentRuntimeCurrent(endpointID, parentThreadID string, current flruntime.ThreadView) {
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if s == nil || endpointID == "" || parentThreadID == "" || current.ThreadID == "" {
		return
	}
	copy := current
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion:   FlowerLiveSchemaVersion,
		Kind:            FlowerLiveStreamThreadBatch,
		ThreadID:        parentThreadID,
		SubagentCurrent: &copy,
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
	data, err := json.Marshal(envelope)
	if err != nil {
		return &flowerLiveEncodedBatch{
			kind: envelope.Kind,
			err:  errors.Join(ErrFlowerLiveSync, err),
			encodingDiagnostics: &flowerLiveEncodingDiagnostics{
				threadID:        flowerLiveDiagnosticIdentity(identity.ThreadID(envelope.ThreadID)),
				current:         flowerLiveCurrentEncodingContext(envelope.Current),
				subagentCurrent: flowerLiveCurrentEncodingContext(envelope.SubagentCurrent),
			},
		}
	}
	return &flowerLiveEncodedBatch{kind: envelope.Kind, data: data, id: rand.Text(), current: compareFlowerLiveEncodedCurrent(envelope, data)}
}

func compareFlowerLiveEncodedCurrent(envelope FlowerLiveStreamEnvelope, encoded []byte) *flowerLiveCurrentComparison {
	if envelope.Kind != FlowerLiveStreamThreadBatch || (envelope.Current == nil) == (envelope.SubagentCurrent == nil) {
		return nil
	}
	current := envelope.Current
	if current == nil {
		current = envelope.SubagentCurrent
	}
	comparison := &flowerLiveCurrentComparison{
		threadID: current.ThreadID.String(), routeID: envelope.ThreadID, subagent: envelope.SubagentCurrent != nil,
		version: current.ViewVersion,
		independent: envelope.ObserverID == "" && envelope.Summaries == nil && envelope.Subagents == nil &&
			envelope.ReadStatus == nil && envelope.ComputerFrame == nil && envelope.ComputerStatus == nil,
	}
	if current.ThreadID == "" || current.Activity != flruntime.ThreadActivityActive || current.TurnID == "" || current.RunID == "" ||
		current.ViewVersion == 0 || current.ViewVersion > 1<<53-1 {
		return comparison
	}
	normalized := *current
	normalized.ViewVersion = 0
	if current.RunProgress != nil && current.RunProgress.Request != nil {
		progress := *current.RunProgress
		request := *progress.Request
		comparison.metrics = append(comparison.metrics, request.EstimatedOutputTokens)
		request.EstimatedOutputTokens = 0
		// Advancing provider activity is replaceable progress within the same
		// attempt. Preserve timestamp presence and first-output boundaries.
		if request.LastProgressAt != nil {
			comparison.metrics = append(comparison.metrics, request.LastProgressAt.UnixNano())
			request.LastProgressAt = new(time.Time)
		}
		progress.Request = &request
		normalized.RunProgress = &progress
	}
	normalized.ToolCallPreviews = append([]flruntime.ThreadToolCallPreview(nil), current.ToolCallPreviews...)
	for index, call := range current.ToolCallPreviews {
		if call.Preview == nil {
			continue
		}
		preview := *call.Preview
		if preview.Additions != nil {
			comparison.metrics = append(comparison.metrics, int64(*preview.Additions))
			preview.Additions = new(int)
		}
		if preview.Deletions != nil {
			comparison.metrics = append(comparison.metrics, int64(*preview.Deletions))
			preview.Deletions = new(int)
		}
		normalized.ToolCallPreviews[index].Preview = &preview
	}
	normalized.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	for index, item := range current.Items {
		if !item.Live || item.TurnID != current.TurnID || item.RunID != current.RunID ||
			(item.Kind != flruntime.ThreadItemAssistant && item.Kind != flruntime.ThreadItemThinking) || item.Text == "" {
			continue
		}
		comparison.texts = append(comparison.texts, item.Text)
		// Keep the eligible positions distinct from absent/empty text fields.
		normalized.Items[index].Text = "\x00"
	}
	// Reuse the exact public envelope. Historical items remain opaque JSON;
	// comparing an unsent snapshot must not repeat per-item redaction or decode
	// every historical tool payload into a second object graph.
	data, err := flowerLiveComparisonJSON(encoded, current, normalized, comparison.subagent)
	if err != nil {
		comparison.texts = nil
		return comparison
	}
	comparison.fingerprint = sha256.Sum256(data)
	return comparison
}

func flowerLiveComparisonJSON(encoded []byte, current *flruntime.ThreadView, normalized flruntime.ThreadView, subagent bool) ([]byte, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		return nil, err
	}
	key := "current"
	if subagent {
		key = "subagent_current"
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(envelope[key], &fields); err != nil {
		return nil, err
	}
	fields["view_version"] = json.RawMessage("0")
	delete(fields, "sampled_at_ms")
	if current.RunProgress != nil && current.RunProgress.Request != nil {
		data, err := json.Marshal(normalized.RunProgress)
		if err != nil {
			return nil, err
		}
		fields["run_progress"] = data
	}
	if len(current.ToolCallPreviews) > 0 {
		data, err := json.Marshal(normalized.ToolCallPreviews)
		if err != nil {
			return nil, err
		}
		fields["tool_call_previews"] = data
	}
	if len(current.Items) > 0 {
		var items []json.RawMessage
		if err := json.Unmarshal(fields["items"], &items); err != nil {
			return nil, err
		}
		for index, item := range current.Items {
			if item.Text == normalized.Items[index].Text {
				continue
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(items[index], &fields); err != nil {
				return nil, err
			}
			fields["text"] = json.RawMessage("\"\\u0000\"")
			data, err := json.Marshal(fields)
			if err != nil {
				return nil, err
			}
			items[index] = data
		}
		data, err := json.Marshal(items)
		if err != nil {
			return nil, err
		}
		fields["items"] = data
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	envelope[key] = data
	return json.Marshal(envelope)
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
	return value.String()
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
	if batch.err != nil || len(batch.data) == 0 {
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
	if subscriber.queuedBytes+subscriber.mediaBytes+len(batch.data) > flowerLiveEnvelopeByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseByteQueueLimit)
		return false
	}
	if service.flowerLiveQueuedBytes+len(batch.data) > flowerLiveGlobalQueuedByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseGlobalQueueLimit)
		return false
	}
	subscriber.queuedBytes += len(batch.data)
	service.flowerLiveQueuedBytes += len(batch.data)
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
		subscriber.mediaBytes -= len(previous.data)
		service.flowerLiveQueuedBytes -= len(previous.data)
	default:
	}
	if batch.err != nil || len(batch.data) == 0 || len(batch.data) > flowerLiveEnvelopeByteLimit ||
		subscriber.queuedBytes+subscriber.mediaBytes+len(batch.data) > flowerLiveEnvelopeByteLimit ||
		service.flowerLiveQueuedBytes+len(batch.data) > flowerLiveGlobalQueuedByteLimit {
		return false
	}
	subscriber.mediaBytes += len(batch.data)
	service.flowerLiveQueuedBytes += len(batch.data)
	subscriber.media <- batch
	wakeFlowerLiveSubscriberLocked(subscriber)
	return true
}

func releaseFlowerLiveBatchLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) {
	subscriber.queuedBytes -= len(batch.data)
	service.flowerLiveQueuedBytes -= len(batch.data)
}

func enqueueFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if !validateFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	// Remove an unsent predecessor only across independent thread currents.
	// Same-thread semantic changes and auxiliary messages are ordering barriers.
	for index := len(subscriber.queue) - 1; index >= 0; index-- {
		previous := subscriber.queue[index]
		if flowerLiveTextAppend(previous, batch) {
			releaseFlowerLiveBatchLocked(service, subscriber, previous)
			copy(subscriber.queue[index:], subscriber.queue[index+1:])
			last := len(subscriber.queue) - 1
			subscriber.queue[last] = nil
			subscriber.queue = subscriber.queue[:last]
			break
		}
		if previous.current == nil || batch.current == nil || !previous.current.independent || !batch.current.independent ||
			previous.current.threadID == batch.current.threadID {
			break
		}
	}
	if len(subscriber.queue) >= flowerLiveSubscriberBatchLimit {
		reason := flowerLiveSubscriberCloseBatchQueueLimit
		if subscriber.initializing {
			reason = flowerLiveSubscriberCloseInitQueueLimit
		}
		closeFlowerLiveSubscriberLocked(service, subscriber, reason)
		return false
	}
	if !retainFlowerLiveBatchLocked(service, subscriber, batch) {
		return false
	}
	subscriber.queue = append(subscriber.queue, batch)
	wakeFlowerLiveSubscriberLocked(subscriber)
	return true
}

// Text growth and progress numbers may replace unsent snapshots only when all
// structural fields match. Tool, interaction and lifecycle boundaries stay ordered.
func flowerLiveTextAppend(previous, next *flowerLiveEncodedBatch) bool {
	before, after := previous.current, next.current
	if before == nil || after == nil || (len(before.texts) == 0 && len(before.metrics) == 0) || len(before.texts) != len(after.texts) || len(before.metrics) != len(after.metrics) ||
		before.threadID != after.threadID || before.routeID != after.routeID || before.subagent != after.subagent ||
		after.version <= before.version || before.fingerprint != after.fingerprint {
		return false
	}
	changed := false
	for index, text := range after.texts {
		if !strings.HasPrefix(text, before.texts[index]) {
			return false
		}
		changed = changed || text != before.texts[index]
	}
	for index, value := range after.metrics {
		changed = changed || value != before.metrics[index]
	}
	return changed
}

func closeFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, reason flowerLiveSubscriberCloseReason, failedBatch ...*flowerLiveEncodedBatch) {
	if subscriber == nil || subscriber.closed {
		return
	}
	queuedBatches := len(subscriber.queue) + len(subscriber.initial)
	queuedBytes := subscriber.queuedBytes + subscriber.mediaBytes
	subscriber.closed = true
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
			} else if len(subscriber.queue) > 0 {
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
					subscriber.mediaBytes -= len(batch.data)
					s.service.flowerLiveQueuedBytes -= len(batch.data)
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
