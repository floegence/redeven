package ai

import "sync/atomic"

type FlowerLiveMetricsSnapshot struct {
	Batches            uint64 `json:"batches"`
	LogicalEvents      uint64 `json:"logical_events"`
	EncodedBytes       uint64 `json:"encoded_bytes"`
	CurrentSubscribers int64  `json:"current_subscribers"`
	PeakSubscribers    int64  `json:"peak_subscribers"`
	EncodeNanoseconds  uint64 `json:"encode_nanoseconds"`
	FanoutNanoseconds  uint64 `json:"fanout_nanoseconds"`
}

type flowerLiveMetrics struct {
	batches            atomic.Uint64
	logicalEvents      atomic.Uint64
	encodedBytes       atomic.Uint64
	currentSubscribers atomic.Int64
	peakSubscribers    atomic.Int64
	encodeNanoseconds  atomic.Uint64
	fanoutNanoseconds  atomic.Uint64
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

func (m *flowerLiveMetrics) snapshot() FlowerLiveMetricsSnapshot {
	return FlowerLiveMetricsSnapshot{
		Batches:            m.batches.Load(),
		LogicalEvents:      m.logicalEvents.Load(),
		EncodedBytes:       m.encodedBytes.Load(),
		CurrentSubscribers: m.currentSubscribers.Load(),
		PeakSubscribers:    m.peakSubscribers.Load(),
		EncodeNanoseconds:  m.encodeNanoseconds.Load(),
		FanoutNanoseconds:  m.fanoutNanoseconds.Load(),
	}
}

func (s *Service) FlowerLiveMetrics() FlowerLiveMetricsSnapshot {
	if s == nil {
		return FlowerLiveMetricsSnapshot{}
	}
	return s.flowerLiveMetrics.snapshot()
}
