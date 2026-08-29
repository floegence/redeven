package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/floegence/floret/v5/identity"
	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
)

const (
	flowerLiveMaxSubscribersPerEndpoint = 256
	flowerLiveBaselinePageLimit         = 200
	flowerLiveSubscriberBatchLimit      = 16
	flowerLiveSubscriberByteLimit       = 1 << 20
	flowerLiveGlobalQueuedByteLimit     = 32 << 20
)

var ErrFlowerLiveTooManySubscribers = errors.New("too many Flower live observers")

type flowerLiveSubscriberCloseReason string

const (
	flowerLiveSubscriberCloseClient           flowerLiveSubscriberCloseReason = "client_closed"
	flowerLiveSubscriberCloseService          flowerLiveSubscriberCloseReason = "service_closed"
	flowerLiveSubscriberCloseOversizedBatch   flowerLiveSubscriberCloseReason = "oversized_batch"
	flowerLiveSubscriberCloseInitQueueLimit   flowerLiveSubscriberCloseReason = "initialization_queue_limit"
	flowerLiveSubscriberCloseBatchQueueLimit  flowerLiveSubscriberCloseReason = "batch_queue_limit"
	flowerLiveSubscriberCloseByteQueueLimit   flowerLiveSubscriberCloseReason = "byte_queue_limit"
	flowerLiveSubscriberCloseGlobalQueueLimit flowerLiveSubscriberCloseReason = "global_queue_limit"
)

type FlowerLiveStreamKind string

const (
	FlowerLiveStreamReady           FlowerLiveStreamKind = "ready"
	FlowerLiveStreamSummaryBatch    FlowerLiveStreamKind = "summary.batch"
	FlowerLiveStreamThreadBatch     FlowerLiveStreamKind = "thread.batch"
	FlowerLiveStreamViewerReadState FlowerLiveStreamKind = "viewer.read_state"
)

type FlowerLiveStreamRequest struct{}

type FlowerLiveStreamEnvelope struct {
	SchemaVersion       int64                      `json:"schema_version"`
	Kind                FlowerLiveStreamKind       `json:"kind"`
	ThreadID            string                     `json:"thread_id,omitempty"`
	Summaries           []ThreadView               `json:"summaries,omitempty"`
	Current             *flruntime.ThreadView      `json:"current,omitempty"`
	Subagents           *[]FlowerSubagentSummary   `json:"subagents,omitempty"`
	ContextUsage        *FlowerContextUsage        `json:"context_usage,omitempty"`
	ContextCompactions  []FlowerContextCompaction  `json:"context_compactions,omitempty"`
	TimelineDecorations []FlowerTimelineDecoration `json:"timeline_decorations,omitempty"`
	ReadStatus          *FlowerThreadReadView      `json:"read_status,omitempty"`
}

type FlowerLiveStreamFrame struct {
	Kind FlowerLiveStreamKind
	Data []byte
}

type flowerLiveEncodedBatch struct {
	kind FlowerLiveStreamKind
	data []byte
}

type flowerLiveSubscriber struct {
	id           uint64
	endpointID   string
	userPublicID string
	queue        chan *flowerLiveEncodedBatch
	queueLimit   int
	queuedBytes  int
	initializing bool
	buffered     []*flowerLiveEncodedBatch
	closed       bool
}

type FlowerLiveStreamSubscription struct {
	service    *Service
	subscriber *flowerLiveSubscriber
	closeOnce  sync.Once
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
		id: s.flowerLiveSubscriberSeq, endpointID: endpointID, userPublicID: userPublicID,
		queue: make(chan *flowerLiveEncodedBatch, flowerLiveSubscriberBatchLimit), queueLimit: flowerLiveSubscriberBatchLimit, initializing: true,
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
	currentBaselines := make([]*flowerLiveEncodedBatch, 0)
	if s.threadRuntime != nil {
		for _, summary := range summaries {
			if !flowerLiveSummaryNeedsCurrentBaseline(summary) {
				continue
			}
			current, viewErr := s.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(summary.ThreadID))
			if viewErr != nil {
				continue
			}
			copy := current
			currentBaselines = append(currentBaselines, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion,
				Kind:          FlowerLiveStreamThreadBatch,
				ThreadID:      summary.ThreadID,
				Current:       &copy,
			}))
		}
	}
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady, Summaries: summaries,
	})
	s.mu.Lock()
	finalizeFlowerLiveSubscriberInitializationLocked(s, subscriber, ready, currentBaselines)
	s.mu.Unlock()
	return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
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
			return nil, errors.New("Flower live baseline cursor did not advance")
		}
		if _, repeated := seenCursors[next]; repeated {
			return nil, errors.New("Flower live baseline cursor repeated")
		}
		seenCursors[next] = struct{}{}
		cursor = next
	}
}

func finalizeFlowerLiveSubscriberInitializationLocked(service *Service, subscriber *flowerLiveSubscriber, ready *flowerLiveEncodedBatch, baselines []*flowerLiveEncodedBatch) {
	if service == nil || subscriber == nil || subscriber.closed || ready == nil {
		return
	}
	initialQueueCapacity := 1 + len(baselines) + len(subscriber.buffered)
	if initialQueueCapacity > cap(subscriber.queue) {
		subscriber.queue = make(chan *flowerLiveEncodedBatch, initialQueueCapacity)
	}
	subscriber.queueLimit = initialQueueCapacity
	if !enqueueFlowerLiveSubscriberDirectLocked(service, subscriber, ready) {
		return
	}
	for _, baseline := range baselines {
		if !enqueueFlowerLiveSubscriberDirectLocked(service, subscriber, baseline) {
			return
		}
	}
	subscriber.initializing = false
	for _, batch := range subscriber.buffered {
		enqueueFlowerLiveSubscriberLocked(service, subscriber, batch)
	}
	subscriber.buffered = nil
	subscriber.queueLimit = flowerLiveSubscriberBatchLimit
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
	if current.Activity != flruntime.ThreadActivityActive {
		ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
		contextProjection, err := s.readCanonicalThreadContextProjection(ctx, current)
		cancel()
		if err != nil {
			if s.log != nil {
				s.log.Warn("ai: project canonical Flower thread context", "thread_id", current.ThreadID.String(), "error", err)
			}
		} else {
			envelope.ContextUsage = contextProjection.Usage
			envelope.ContextCompactions = contextProjection.Compactions
			envelope.TimelineDecorations = contextProjection.Decorations
		}
	}
	batch := newFlowerLiveEncodedBatch(envelope)
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

func (s *Service) publishFlowerRuntimeContextUsage(endpointID string, threadID string, usage FlowerContextUsage) {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if s == nil || endpointID == "" || threadID == "" {
		return
	}
	copy := usage
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion,
		Kind:          FlowerLiveStreamThreadBatch,
		ThreadID:      threadID,
		ContextUsage:  &copy,
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
		data = []byte(`{"schema_version":1,"kind":"ready"}`)
	}
	return &flowerLiveEncodedBatch{kind: envelope.Kind, data: data}
}

func enqueueFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if subscriber == nil || batch == nil || subscriber.closed || service == nil {
		return false
	}
	if len(batch.data) > flowerLiveSubscriberByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseOversizedBatch)
		return false
	}
	if subscriber.initializing {
		subscriber.buffered = append(subscriber.buffered, batch)
		if len(subscriber.buffered) > flowerLiveSubscriberBatchLimit {
			closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseInitQueueLimit)
			return false
		}
		return true
	}
	return enqueueFlowerLiveSubscriberDirectLocked(service, subscriber, batch)
}

func enqueueFlowerLiveSubscriberDirectLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	queueLimit := subscriber.queueLimit
	if queueLimit <= 0 {
		queueLimit = flowerLiveSubscriberBatchLimit
	}
	if len(batch.data) > flowerLiveSubscriberByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseOversizedBatch)
		return false
	}
	if len(subscriber.queue) >= queueLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseBatchQueueLimit)
		return false
	}
	if subscriber.queuedBytes+len(batch.data) > flowerLiveSubscriberByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseByteQueueLimit)
		return false
	}
	if service.flowerLiveQueuedBytes+len(batch.data) > flowerLiveGlobalQueuedByteLimit {
		closeFlowerLiveSubscriberLocked(service, subscriber, flowerLiveSubscriberCloseGlobalQueueLimit)
		return false
	}
	subscriber.queue <- batch
	subscriber.queuedBytes += len(batch.data)
	service.flowerLiveQueuedBytes += len(batch.data)
	return true
}

func closeFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, reason flowerLiveSubscriberCloseReason) {
	if subscriber == nil || subscriber.closed {
		return
	}
	queuedBatches := len(subscriber.queue) + len(subscriber.buffered)
	queuedBytes := subscriber.queuedBytes
	subscriber.closed = true
	subscriber.buffered = nil
	for len(subscriber.queue) > 0 {
		batch := <-subscriber.queue
		subscriber.queuedBytes -= len(batch.data)
		service.flowerLiveQueuedBytes -= len(batch.data)
	}
	if subscriber.queuedBytes < 0 {
		subscriber.queuedBytes = 0
	}
	if service.flowerLiveQueuedBytes < 0 {
		service.flowerLiveQueuedBytes = 0
	}
	delete(service.flowerLiveSubscribers, subscriber.id)
	if service.flowerLiveSubscribersByEndpoint[subscriber.endpointID] > 0 {
		service.flowerLiveSubscribersByEndpoint[subscriber.endpointID]--
	}
	service.flowerLiveMetrics.subscriberClosed()
	service.flowerLiveMetrics.subscriberDropped(reason)
	if service.log != nil && reason != flowerLiveSubscriberCloseClient && reason != flowerLiveSubscriberCloseService {
		service.log.Warn(
			"ai: Flower live subscriber closed by stream limit",
			"endpoint_id", logsafe.Text(subscriber.endpointID, 256),
			"subscriber_id", subscriber.id,
			"reason", reason,
			"queued_batches", queuedBatches,
			"queued_bytes", queuedBytes,
		)
	}
	close(subscriber.queue)
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
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case batch, ok := <-s.subscriber.queue:
		if ok {
			s.service.mu.Lock()
			s.subscriber.queuedBytes -= len(batch.data)
			s.service.flowerLiveQueuedBytes -= len(batch.data)
			s.service.mu.Unlock()
			return &FlowerLiveStreamFrame{Kind: batch.kind, Data: batch.data}, nil
		}
		return nil, io.EOF
	}
}

func (s *FlowerLiveStreamSubscription) Close() {
	if s == nil || s.subscriber == nil || s.service == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.service.mu.Lock()
		if !s.subscriber.closed {
			closeFlowerLiveSubscriberLocked(s.service, s.subscriber, flowerLiveSubscriberCloseClient)
		}
		for batch := range s.subscriber.queue {
			s.subscriber.queuedBytes -= len(batch.data)
			s.service.flowerLiveQueuedBytes -= len(batch.data)
		}
		s.service.mu.Unlock()
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
