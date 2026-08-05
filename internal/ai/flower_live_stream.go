package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/session"
)

const (
	flowerLiveMaxSubscribersPerEndpoint = 256
	flowerLiveSubscriberBatchLimit      = 64
	flowerLiveSubscriberByteLimit       = 1 << 20
	flowerLiveGlobalQueuedByteLimit     = 32 << 20
	flowerLiveEncodedRetentionByteLimit = 8 << 20
	flowerLiveBatchByteThreshold        = 32 << 10
	flowerLiveBatchDelay                = 50 * time.Millisecond
)

var ErrFlowerLiveTooManySubscribers = errors.New("too many Flower live observers")

type FlowerLiveStreamKind string

const (
	FlowerLiveStreamReady           FlowerLiveStreamKind = "ready"
	FlowerLiveStreamSummaryBatch    FlowerLiveStreamKind = "summary.batch"
	FlowerLiveStreamThreadBatch     FlowerLiveStreamKind = "thread.batch"
	FlowerLiveStreamViewerReadState FlowerLiveStreamKind = "viewer.read_state"
	FlowerLiveStreamResyncRequired  FlowerLiveStreamKind = "resync_required"
)

type FlowerLiveStreamRequest struct {
	ThreadID          string
	StreamGeneration  int64
	AfterSeq          int64
	SummaryGeneration int64
	SummaryAfterSeq   int64
}

type FlowerLiveStreamEnvelope struct {
	SchemaVersion          int64                 `json:"schema_version"`
	Kind                   FlowerLiveStreamKind  `json:"kind"`
	StreamGeneration       int64                 `json:"stream_generation"`
	ThreadID               string                `json:"thread_id,omitempty"`
	FromSeq                int64                 `json:"from_seq,omitempty"`
	ThroughSeq             int64                 `json:"through_seq,omitempty"`
	RetainedFromSeq        int64                 `json:"retained_from_seq,omitempty"`
	SummaryThroughSeq      int64                 `json:"summary_through_seq,omitempty"`
	SummaryRetainedFromSeq int64                 `json:"summary_retained_from_seq,omitempty"`
	Events                 []FlowerLiveEvent     `json:"events,omitempty"`
	ReadStatus             *FlowerThreadReadView `json:"read_status,omitempty"`
	Reason                 string                `json:"reason,omitempty"`
}

type FlowerLiveStreamFrame struct {
	Kind       FlowerLiveStreamKind
	FromSeq    int64
	ThroughSeq int64
	Data       []byte
}

type flowerLiveEncodedBatch struct {
	kind       FlowerLiveStreamKind
	fromSeq    int64
	throughSeq int64
	reason     string
	data       []byte
}

type flowerLiveSummaryStream struct {
	nextSeq      int64
	batches      []*flowerLiveEncodedBatch
	encodedBytes int
}

func newFlowerLiveSummaryStream() *flowerLiveSummaryStream {
	return &flowerLiveSummaryStream{nextSeq: 1}
}

type flowerLiveSubscriber struct {
	id           uint64
	endpointID   string
	userPublicID string
	threadID     string
	threadKey    string
	queue        chan *flowerLiveEncodedBatch
	queuedBytes  int
	terminal     *flowerLiveEncodedBatch
	closed       bool
}

type FlowerLiveStreamSubscription struct {
	service    *Service
	subscriber *flowerLiveSubscriber
	closeOnce  sync.Once
}

func (s *Service) SubscribeFlowerLiveStream(_ context.Context, meta *session.Meta, request FlowerLiveStreamRequest) (*FlowerLiveStreamSubscription, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(request.ThreadID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	if endpointID == "" || userPublicID == "" || threadID == "" || request.AfterSeq < 0 || request.StreamGeneration < 0 ||
		request.SummaryAfterSeq < 0 || request.SummaryGeneration < 0 {
		return nil, errors.New("invalid Flower live stream request")
	}
	threadKey := runThreadKey(endpointID, threadID)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.flowerLiveSubscribersByEndpoint == nil {
		s.flowerLiveSubscribersByEndpoint = make(map[string]int)
	}
	if s.flowerLiveSubscribersByEndpoint[endpointID] >= flowerLiveMaxSubscribersPerEndpoint {
		return nil, ErrFlowerLiveTooManySubscribers
	}
	if s.flowerLiveByThread == nil {
		s.flowerLiveByThread = make(map[string]*flowerLiveThreadStream)
	}
	if s.flowerLiveSubscribers == nil {
		s.flowerLiveSubscribers = make(map[uint64]*flowerLiveSubscriber)
	}
	if s.flowerLiveSummaryByEndpoint == nil {
		s.flowerLiveSummaryByEndpoint = make(map[string]*flowerLiveSummaryStream)
	}
	summary := s.flowerLiveSummaryByEndpoint[endpointID]
	if summary == nil {
		summary = newFlowerLiveSummaryStream()
		s.flowerLiveSummaryByEndpoint[endpointID] = summary
	}
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil {
		stream = newFlowerLiveThreadStream()
		s.flowerLiveByThread[threadKey] = stream
	}
	if stream.Subscribers == nil {
		stream.Subscribers = make(map[uint64]*flowerLiveSubscriber)
	}
	s.flowerLiveSubscriberSeq++
	subscriber := &flowerLiveSubscriber{
		id: s.flowerLiveSubscriberSeq, endpointID: endpointID, userPublicID: userPublicID, threadID: threadID, threadKey: threadKey,
		queue: make(chan *flowerLiveEncodedBatch, flowerLiveSubscriberBatchLimit),
	}
	stream.Subscribers[subscriber.id] = subscriber
	s.flowerLiveSubscribers[subscriber.id] = subscriber
	s.flowerLiveSubscribersByEndpoint[endpointID]++
	s.flowerLiveMetrics.subscriberOpened()

	generation := s.flowerLiveStreamGenerationValue()
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady,
		StreamGeneration: generation, ThreadID: threadID,
		ThroughSeq: stream.NextSeq - 1, RetainedFromSeq: flowerLiveStreamRetainedFromSeq(stream),
		SummaryThroughSeq: summary.nextSeq - 1, SummaryRetainedFromSeq: flowerLiveSummaryRetainedFromSeq(summary),
	})
	enqueueFlowerLiveSubscriberLocked(s, subscriber, ready)
	if request.StreamGeneration > 0 && request.StreamGeneration != generation {
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "generation_changed"))
		return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
	}
	if request.SummaryGeneration > 0 && request.SummaryGeneration != generation {
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "summary_generation_changed"))
		return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
	}
	summaryRetainedFrom := flowerLiveSummaryRetainedFromSeq(summary)
	if request.SummaryAfterSeq > 0 && summaryRetainedFrom > 0 && request.SummaryAfterSeq < summaryRetainedFrom {
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "summary_retention_gap"))
		return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
	}
	for _, batch := range summary.batches {
		if batch.throughSeq <= request.SummaryAfterSeq {
			continue
		}
		if !enqueueFlowerLiveSubscriberLocked(s, subscriber, batch) {
			closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "observer_queue_overflow"))
			return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
		}
	}
	retainedFrom := flowerLiveStreamRetainedFromSeq(stream)
	if request.AfterSeq > 0 && retainedFrom > 0 && request.AfterSeq < retainedFrom {
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "retention_gap"))
		return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
	}
	for _, batch := range stream.EncodedBatches {
		if batch.throughSeq <= request.AfterSeq {
			continue
		}
		if !enqueueFlowerLiveSubscriberLocked(s, subscriber, batch) {
			closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(generation, threadID, "observer_queue_overflow"))
			break
		}
	}
	return &FlowerLiveStreamSubscription{service: s, subscriber: subscriber}, nil
}

func (s *Service) publishFlowerLiveEventLocked(stream *flowerLiveThreadStream, event FlowerLiveEvent) {
	if s == nil || stream == nil {
		return
	}
	stream.PendingEvents = append(stream.PendingEvents, cloneFlowerLiveEvent(event))
	stream.PendingBytes += len(event.Payload) + 128
	if flowerLiveEventFlushesImmediately(event.Kind) || stream.PendingBytes >= flowerLiveBatchByteThreshold {
		s.flushFlowerLiveThreadLocked(stream)
		return
	}
	if stream.FlushTimer != nil {
		return
	}
	threadKey := runThreadKey(event.EndpointID, event.ThreadID)
	stream.FlushTimer = time.AfterFunc(flowerLiveBatchDelay, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		current := s.flowerLiveByThread[threadKey]
		if current != stream {
			return
		}
		stream.FlushTimer = nil
		s.flushFlowerLiveThreadLocked(stream)
	})
}

func flowerLiveEventFlushesImmediately(kind FlowerLiveKind) bool {
	switch kind {
	case FlowerLiveRunStarted, FlowerLiveRunStatusChanged, FlowerLiveThreadPatched,
		FlowerLiveMessageBlockSet, FlowerLiveMessageFailed,
		FlowerLiveApprovalRequested, FlowerLiveApprovalResolved, FlowerLiveApprovalQueueReplaced,
		FlowerLiveInputRequested, FlowerLiveInputResolved, FlowerLiveTimelineReplaced,
		FlowerLiveResyncRequired:
		return true
	default:
		return false
	}
}

func (s *Service) flushFlowerLiveThreadLocked(stream *flowerLiveThreadStream) {
	if s == nil || stream == nil || len(stream.PendingEvents) == 0 {
		return
	}
	if stream.FlushTimer != nil {
		stream.FlushTimer.Stop()
		stream.FlushTimer = nil
	}
	sanitizeStartedAt := time.Now()
	events := make([]FlowerLiveEvent, len(stream.PendingEvents))
	for index, event := range stream.PendingEvents {
		events[index] = flowerLiveEventWithoutReadStatus(event)
	}
	s.flowerLiveMetrics.sanitizeNanoseconds.Add(uint64(time.Since(sanitizeStartedAt)))
	stream.PendingEvents = nil
	stream.PendingBytes = 0
	first := events[0]
	last := events[len(events)-1]
	retainedFrom := flowerLiveStreamRetainedFromSeq(stream)
	if retainedFrom == 0 {
		retainedFrom = first.Seq
	}
	encodeStartedAt := time.Now()
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch,
		StreamGeneration: s.flowerLiveStreamGenerationValue(), ThreadID: first.ThreadID,
		FromSeq: first.Seq, ThroughSeq: last.Seq,
		RetainedFromSeq: retainedFrom,
		Events:          events,
	})
	s.flowerLiveMetrics.encodeNanoseconds.Add(uint64(time.Since(encodeStartedAt)))
	s.flowerLiveMetrics.batchEncoded(len(events), len(batch.data))
	stream.EncodedBatches = append(stream.EncodedBatches, batch)
	stream.EncodedBytes += len(batch.data)
	stream.EncodedEventCount += len(events)
	for stream.EncodedEventCount > flowerLiveEventBufferLimit || stream.EncodedBytes > flowerLiveEncodedRetentionByteLimit {
		oldest := stream.EncodedBatches[0]
		stream.EncodedBytes -= len(stream.EncodedBatches[0].data)
		stream.EncodedEventCount -= int(oldest.throughSeq - oldest.fromSeq + 1)
		stream.EncodedBatches[0] = nil
		stream.EncodedBatches = stream.EncodedBatches[1:]
	}
	fanoutStartedAt := time.Now()
	for _, subscriber := range stream.Subscribers {
		if enqueueFlowerLiveSubscriberLocked(s, subscriber, batch) {
			continue
		}
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(s.flowerLiveStreamGenerationValue(), first.ThreadID, "observer_queue_overflow"))
	}
	s.flowerLiveMetrics.fanoutNanoseconds.Add(uint64(time.Since(fanoutStartedAt)))
	for _, event := range events {
		if event.Kind == FlowerLiveThreadPatched {
			s.publishFlowerLiveSummaryLocked(event)
		}
	}
}

func (s *Service) publishFlowerLiveSummaryLocked(event FlowerLiveEvent) {
	endpointID := strings.TrimSpace(event.EndpointID)
	if s == nil || endpointID == "" {
		return
	}
	if s.flowerLiveSummaryByEndpoint == nil {
		s.flowerLiveSummaryByEndpoint = make(map[string]*flowerLiveSummaryStream)
	}
	summary := s.flowerLiveSummaryByEndpoint[endpointID]
	if summary == nil {
		summary = newFlowerLiveSummaryStream()
		s.flowerLiveSummaryByEndpoint[endpointID] = summary
	}
	seq := summary.nextSeq
	summary.nextSeq++
	retainedFrom := flowerLiveSummaryRetainedFromSeq(summary)
	if retainedFrom == 0 {
		retainedFrom = seq
	}
	sanitizeStartedAt := time.Now()
	sanitizedEvent := flowerLiveEventWithoutReadStatus(event)
	s.flowerLiveMetrics.sanitizeNanoseconds.Add(uint64(time.Since(sanitizeStartedAt)))
	encodeStartedAt := time.Now()
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamSummaryBatch,
		StreamGeneration: s.flowerLiveStreamGenerationValue(),
		FromSeq:          seq, ThroughSeq: seq, RetainedFromSeq: retainedFrom,
		Events: []FlowerLiveEvent{sanitizedEvent},
	})
	s.flowerLiveMetrics.encodeNanoseconds.Add(uint64(time.Since(encodeStartedAt)))
	s.flowerLiveMetrics.batchEncoded(1, len(batch.data))
	summary.batches = append(summary.batches, batch)
	summary.encodedBytes += len(batch.data)
	for len(summary.batches) > flowerLiveEventBufferLimit || summary.encodedBytes > flowerLiveEncodedRetentionByteLimit {
		summary.encodedBytes -= len(summary.batches[0].data)
		summary.batches[0] = nil
		summary.batches = summary.batches[1:]
	}
	fanoutStartedAt := time.Now()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		if enqueueFlowerLiveSubscriberLocked(s, subscriber, batch) {
			continue
		}
		stream := s.flowerLiveByThread[subscriber.threadKey]
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(s.flowerLiveStreamGenerationValue(), event.ThreadID, "observer_queue_overflow"))
	}
	s.flowerLiveMetrics.fanoutNanoseconds.Add(uint64(time.Since(fanoutStartedAt)))
}

func flowerLiveEventWithoutReadStatus(event FlowerLiveEvent) FlowerLiveEvent {
	out := cloneFlowerLiveEvent(event)
	if out.Kind != FlowerLiveThreadPatched {
		return out
	}
	var payload FlowerLiveThreadPatchedPayload
	if !decodeFlowerPayload(out.Payload, &payload) {
		return out
	}
	payload.Patch.ReadStatus = nil
	out.Payload = mustFlowerPayload(payload)
	return out
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
		SchemaVersion:    FlowerLiveSchemaVersion,
		Kind:             FlowerLiveStreamViewerReadState,
		StreamGeneration: s.flowerLiveStreamGenerationValue(),
		ThreadID:         threadID,
		ReadStatus:       &readStatus,
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.closed || subscriber.endpointID != endpointID || subscriber.userPublicID != userPublicID {
			continue
		}
		if enqueueFlowerLiveSubscriberLocked(s, subscriber, batch) {
			continue
		}
		stream := s.flowerLiveByThread[subscriber.threadKey]
		closeFlowerLiveSubscriberLocked(s, stream, subscriber, newFlowerLiveResyncBatch(s.flowerLiveStreamGenerationValue(), subscriber.threadID, "observer_queue_overflow"))
	}
	return nil
}

func newFlowerLiveEncodedBatch(envelope FlowerLiveStreamEnvelope) *flowerLiveEncodedBatch {
	data, err := json.Marshal(envelope)
	if err != nil {
		data = []byte(`{"schema_version":1,"kind":"resync_required","reason":"encode_failed"}`)
	}
	return &flowerLiveEncodedBatch{kind: envelope.Kind, fromSeq: envelope.FromSeq, throughSeq: envelope.ThroughSeq, reason: envelope.Reason, data: data}
}

func newFlowerLiveResyncBatch(generation int64, threadID string, reason string) *flowerLiveEncodedBatch {
	return newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamResyncRequired,
		StreamGeneration: generation, ThreadID: threadID, Reason: reason,
	})
}

func flowerLiveStreamRetainedFromSeq(stream *flowerLiveThreadStream) int64 {
	if stream == nil || len(stream.EncodedBatches) == 0 {
		return 0
	}
	return stream.EncodedBatches[0].fromSeq
}

func flowerLiveSummaryRetainedFromSeq(stream *flowerLiveSummaryStream) int64 {
	if stream == nil || len(stream.batches) == 0 {
		return 0
	}
	return stream.batches[0].fromSeq
}

func enqueueFlowerLiveSubscriberLocked(service *Service, subscriber *flowerLiveSubscriber, batch *flowerLiveEncodedBatch) bool {
	if subscriber == nil || batch == nil || subscriber.closed || len(batch.data) > flowerLiveSubscriberByteLimit ||
		subscriber.queuedBytes+len(batch.data) > flowerLiveSubscriberByteLimit || len(subscriber.queue) >= flowerLiveSubscriberBatchLimit ||
		service == nil || service.flowerLiveQueuedBytes+len(batch.data) > flowerLiveGlobalQueuedByteLimit {
		return false
	}
	subscriber.queue <- batch
	subscriber.queuedBytes += len(batch.data)
	service.flowerLiveQueuedBytes += len(batch.data)
	return true
}

func closeFlowerLiveSubscriberLocked(service *Service, stream *flowerLiveThreadStream, subscriber *flowerLiveSubscriber, terminal *flowerLiveEncodedBatch) {
	if subscriber == nil || subscriber.closed {
		return
	}
	subscriber.closed = true
	subscriber.terminal = terminal
	if terminal != nil && terminal.kind == FlowerLiveStreamResyncRequired {
		service.flowerLiveMetrics.resyncs.Add(1)
		if terminal.reason == "observer_queue_overflow" {
			service.flowerLiveMetrics.queueOverflows.Add(1)
		}
	}
	if stream != nil {
		delete(stream.Subscribers, subscriber.id)
	}
	delete(service.flowerLiveSubscribers, subscriber.id)
	if service.flowerLiveSubscribersByEndpoint[subscriber.endpointID] > 0 {
		service.flowerLiveSubscribersByEndpoint[subscriber.endpointID]--
	}
	service.flowerLiveMetrics.subscriberClosed()
	close(subscriber.queue)
}

func closeFlowerLiveThreadSubscribersLocked(service *Service, stream *flowerLiveThreadStream, reason string) {
	if service == nil || stream == nil {
		return
	}
	for _, subscriber := range stream.Subscribers {
		closeFlowerLiveSubscriberLocked(service, stream, subscriber, newFlowerLiveResyncBatch(
			service.flowerLiveStreamGenerationValue(), subscriber.threadID, reason,
		))
	}
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
			return &FlowerLiveStreamFrame{Kind: batch.kind, FromSeq: batch.fromSeq, ThroughSeq: batch.throughSeq, Data: batch.data}, nil
		}
		s.service.mu.Lock()
		terminal := s.subscriber.terminal
		s.subscriber.terminal = nil
		s.service.mu.Unlock()
		if terminal != nil {
			return &FlowerLiveStreamFrame{Kind: terminal.kind, FromSeq: terminal.fromSeq, ThroughSeq: terminal.throughSeq, Data: terminal.data}, nil
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
			stream := s.service.flowerLiveByThread[s.subscriber.threadKey]
			closeFlowerLiveSubscriberLocked(s.service, stream, s.subscriber, nil)
		}
		for batch := range s.subscriber.queue {
			s.subscriber.queuedBytes -= len(batch.data)
			s.service.flowerLiveQueuedBytes -= len(batch.data)
		}
		s.subscriber.terminal = nil
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
