package ai

import (
	"sync/atomic"
	"time"
)

type FlowerLiveMetricsSnapshot struct {
	Batches                              uint64 `json:"batches"`
	LogicalEvents                        uint64 `json:"logical_events"`
	EncodedBytes                         uint64 `json:"encoded_bytes"`
	CurrentSubscribers                   int64  `json:"current_subscribers"`
	PeakSubscribers                      int64  `json:"peak_subscribers"`
	EncodeNanoseconds                    uint64 `json:"encode_nanoseconds"`
	FanoutNanoseconds                    uint64 `json:"fanout_nanoseconds"`
	RuntimeCurrentsReceived              uint64 `json:"runtime_currents_received"`
	RuntimeCurrentsPublished             uint64 `json:"runtime_currents_published"`
	RuntimeCurrentsCoalesced             uint64 `json:"runtime_currents_coalesced"`
	MaxRuntimeCurrentPublishGapNanos     uint64 `json:"max_runtime_current_publish_gap_nanoseconds"`
	FirstThinkingPublishSamples          uint64 `json:"first_thinking_publish_samples"`
	LastFirstThinkingPublishLatencyNanos uint64 `json:"last_first_thinking_publish_latency_nanoseconds"`
	MaxFirstThinkingPublishLatencyNanos  uint64 `json:"max_first_thinking_publish_latency_nanoseconds"`
	SubscriberQueueOverflows             uint64 `json:"subscriber_queue_overflows"`
	SubscriberOversizedBatches           uint64 `json:"subscriber_oversized_batches"`
	GlobalQueueOverflows                 uint64 `json:"global_queue_overflows"`
}

type flowerLiveMetrics struct {
	batches                              atomic.Uint64
	logicalEvents                        atomic.Uint64
	encodedBytes                         atomic.Uint64
	currentSubscribers                   atomic.Int64
	peakSubscribers                      atomic.Int64
	encodeNanoseconds                    atomic.Uint64
	fanoutNanoseconds                    atomic.Uint64
	runtimeCurrentsReceived              atomic.Uint64
	runtimeCurrentsPublished             atomic.Uint64
	runtimeCurrentsCoalesced             atomic.Uint64
	maxRuntimeCurrentPublishGapNanos     atomic.Uint64
	firstThinkingPublishSamples          atomic.Uint64
	lastFirstThinkingPublishLatencyNanos atomic.Uint64
	maxFirstThinkingPublishLatencyNanos  atomic.Uint64
	subscriberQueueOverflows             atomic.Uint64
	subscriberOversizedBatches           atomic.Uint64
	globalQueueOverflows                 atomic.Uint64
}

func (m *flowerLiveMetrics) subscriberOpened() {
	current := m.currentSubscribers.Add(1)
	for {
		peak := m.peakSubscribers.Load()
		if current <= peak || m.peakSubscribers.CompareAndSwap(peak, current) {
			return
		}
	}
}

func (m *flowerLiveMetrics) subscriberClosed() {
	m.currentSubscribers.Add(-1)
}

func (m *flowerLiveMetrics) batchEncoded(logicalEvents int, encodedBytes int) {
	m.batches.Add(1)
	if logicalEvents > 0 {
		m.logicalEvents.Add(uint64(logicalEvents))
	}
	if encodedBytes > 0 {
		m.encodedBytes.Add(uint64(encodedBytes))
	}
}

func (m *flowerLiveMetrics) runtimeCurrentReceived() {
	m.runtimeCurrentsReceived.Add(1)
}

func (m *flowerLiveMetrics) runtimeCurrentPublished() {
	m.runtimeCurrentsPublished.Add(1)
}

func (m *flowerLiveMetrics) runtimeCurrentCoalesced() {
	m.runtimeCurrentsCoalesced.Add(1)
}

func (m *flowerLiveMetrics) runtimeCurrentPublishGap(gap time.Duration) {
	atomicMaxUint64(&m.maxRuntimeCurrentPublishGapNanos, durationNanoseconds(gap))
}

func (m *flowerLiveMetrics) runtimeFirstThinkingPublishLatency(latency time.Duration) {
	nanoseconds := durationNanoseconds(latency)
	m.firstThinkingPublishSamples.Add(1)
	m.lastFirstThinkingPublishLatencyNanos.Store(nanoseconds)
	atomicMaxUint64(&m.maxFirstThinkingPublishLatencyNanos, nanoseconds)
}

func (m *flowerLiveMetrics) subscriberDropped(reason flowerLiveSubscriberCloseReason) {
	switch reason {
	case flowerLiveSubscriberCloseOversizedBatch:
		m.subscriberOversizedBatches.Add(1)
	case flowerLiveSubscriberCloseGlobalQueueLimit:
		m.globalQueueOverflows.Add(1)
	case flowerLiveSubscriberCloseInitQueueLimit,
		flowerLiveSubscriberCloseBatchQueueLimit,
		flowerLiveSubscriberCloseByteQueueLimit:
		m.subscriberQueueOverflows.Add(1)
	}
}

func durationNanoseconds(duration time.Duration) uint64 {
	if duration <= 0 {
		return 0
	}
	return uint64(duration)
}

func atomicMaxUint64(target *atomic.Uint64, value uint64) {
	for {
		current := target.Load()
		if value <= current || target.CompareAndSwap(current, value) {
			return
		}
	}
}

func (m *flowerLiveMetrics) snapshot() FlowerLiveMetricsSnapshot {
	return FlowerLiveMetricsSnapshot{
		Batches:                              m.batches.Load(),
		LogicalEvents:                        m.logicalEvents.Load(),
		EncodedBytes:                         m.encodedBytes.Load(),
		CurrentSubscribers:                   m.currentSubscribers.Load(),
		PeakSubscribers:                      m.peakSubscribers.Load(),
		EncodeNanoseconds:                    m.encodeNanoseconds.Load(),
		FanoutNanoseconds:                    m.fanoutNanoseconds.Load(),
		RuntimeCurrentsReceived:              m.runtimeCurrentsReceived.Load(),
		RuntimeCurrentsPublished:             m.runtimeCurrentsPublished.Load(),
		RuntimeCurrentsCoalesced:             m.runtimeCurrentsCoalesced.Load(),
		MaxRuntimeCurrentPublishGapNanos:     m.maxRuntimeCurrentPublishGapNanos.Load(),
		FirstThinkingPublishSamples:          m.firstThinkingPublishSamples.Load(),
		LastFirstThinkingPublishLatencyNanos: m.lastFirstThinkingPublishLatencyNanos.Load(),
		MaxFirstThinkingPublishLatencyNanos:  m.maxFirstThinkingPublishLatencyNanos.Load(),
		SubscriberQueueOverflows:             m.subscriberQueueOverflows.Load(),
		SubscriberOversizedBatches:           m.subscriberOversizedBatches.Load(),
		GlobalQueueOverflows:                 m.globalQueueOverflows.Load(),
	}
}

func (s *Service) FlowerLiveMetrics() FlowerLiveMetricsSnapshot {
	if s == nil {
		return FlowerLiveMetricsSnapshot{}
	}
	return s.flowerLiveMetrics.snapshot()
}
