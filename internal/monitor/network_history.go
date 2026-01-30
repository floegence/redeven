package monitor

import (
	"sync"
	"time"
)

type networkStats struct {
	bytesReceived uint64
	bytesSent     uint64
	at            time.Time
}

type networkHistory struct {
	mu     sync.RWMutex
	window time.Duration
	max    int
	items  []networkStats
}

func newNetworkHistory(max int, window time.Duration) *networkHistory {
	if max <= 0 {
		max = 10
	}
	if window <= 0 {
		window = 6 * time.Second
	}
	return &networkHistory{max: max, window: window}
}

func (h *networkHistory) Add(s networkStats) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	h.items = append(h.items, s)
	if len(h.items) > h.max {
		h.items = h.items[len(h.items)-h.max:]
	}
}

// CalculateSpeed computes an average speed based on the oldest/newest samples within the window.
func (h *networkHistory) CalculateSpeed(now time.Time) (receivedSpeed float64, sentSpeed float64) {
	if h == nil {
		return 0, 0
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if len(h.items) < 2 {
		return 0, 0
	}

	// Pick samples within the window.
	valid := make([]networkStats, 0, len(h.items))
	for i := len(h.items) - 1; i >= 0; i-- {
		s := h.items[i]
		if now.Sub(s.at) <= h.window {
			valid = append([]networkStats{s}, valid...)
			continue
		}
		break
	}

	if len(valid) < 2 {
		return 0, 0
	}

	oldest := valid[0]
	newest := valid[len(valid)-1]
	dt := newest.at.Sub(oldest.at).Seconds()
	if dt <= 0 {
		return 0, 0
	}

	receivedSpeed = float64(newest.bytesReceived-oldest.bytesReceived) / dt
	sentSpeed = float64(newest.bytesSent-oldest.bytesSent) / dt
	return receivedSpeed, sentSpeed
}
