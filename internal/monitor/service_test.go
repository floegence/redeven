package monitor

import (
	"testing"
	"time"
)

func Test_normalizeSortBy(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "cpu"},
		{"cpu", "cpu"},
		{"CPU", "cpu"},
		{"memory", "memory"},
		{" Memory ", "memory"},
		{"unknown", "cpu"},
	}

	for _, c := range cases {
		if got := normalizeSortBy(c.in); got != c.want {
			t.Fatalf("normalizeSortBy(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func Test_selectTopProcesses_sortAndLimit(t *testing.T) {
	metrics := []processWithMetrics{
		{pid: 1, name: "a", cpuPercent: 10, memoryBytes: 100},
		{pid: 2, name: "b", cpuPercent: 30, memoryBytes: 300},
		{pid: 3, name: "c", cpuPercent: 20, memoryBytes: 200},
	}

	topCPU := selectTopProcesses(metrics, "cpu", 2)
	if len(topCPU) != 2 {
		t.Fatalf("topCPU len = %d, want 2", len(topCPU))
	}
	if topCPU[0].PID != 2 || topCPU[1].PID != 3 {
		t.Fatalf("topCPU order = [%d,%d], want [2,3]", topCPU[0].PID, topCPU[1].PID)
	}

	topMem := selectTopProcesses(metrics, "memory", 2)
	if len(topMem) != 2 {
		t.Fatalf("topMem len = %d, want 2", len(topMem))
	}
	if topMem[0].PID != 2 || topMem[1].PID != 3 {
		t.Fatalf("topMem order = [%d,%d], want [2,3]", topMem[0].PID, topMem[1].PID)
	}
}

func Test_networkHistory_CalculateSpeed_windowedAverage(t *testing.T) {
	h := newNetworkHistory(10, 6*time.Second)
	now := time.Now()

	// An old sample outside the window should not affect the result.
	h.Add(networkStats{bytesReceived: 0, bytesSent: 0, at: now.Add(-10 * time.Second)})

	// Two points: +200 bytes in 2s => 100 B/s
	h.Add(networkStats{bytesReceived: 1000, bytesSent: 500, at: now.Add(-2 * time.Second)})
	h.Add(networkStats{bytesReceived: 1200, bytesSent: 700, at: now})

	recv, sent := h.CalculateSpeed(now)
	if recv < 99 || recv > 101 {
		t.Fatalf("recv speed = %v, want ~= 100", recv)
	}
	if sent < 99 || sent > 101 {
		t.Fatalf("sent speed = %v, want ~= 100", sent)
	}

	// Repeated calls should be stable.
	recv2, sent2 := h.CalculateSpeed(now)
	if recv2 != recv || sent2 != sent {
		t.Fatalf("speed changed unexpectedly: got (%v,%v) want (%v,%v)", recv2, sent2, recv, sent)
	}
}
