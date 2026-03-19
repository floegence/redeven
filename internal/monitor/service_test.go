package monitor

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
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

func TestService_StartPublishesCachedSnapshot(t *testing.T) {
	t.Parallel()

	var systemCalls atomic.Int32
	var processCalls atomic.Int32

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.systemRefreshInterval = time.Hour
	svc.processRefreshInterval = time.Hour
	svc.systemRefreshTimeout = time.Second
	svc.processRefreshTimeout = time.Second
	svc.collectors = monitorCollectors{
		readCPUUsage:  func(context.Context) (float64, error) { systemCalls.Add(1); return 37.5, nil },
		countCPUCores: func(context.Context) (int, error) { return 8, nil },
		readLoadAverage: func(context.Context) ([]float64, error) {
			return []float64{1, 0.5, 0.25}, nil
		},
		readNetworkCounters: func(context.Context) (networkCounters, error) {
			return networkCounters{bytesReceived: 1024, bytesSent: 2048}, nil
		},
		collectProcessMetrics: func(context.Context) ([]processWithMetrics, error) {
			processCalls.Add(1)
			return []processWithMetrics{
				{pid: 11, name: "proc-a", cpuPercent: 20, memoryBytes: 100, username: "alice"},
				{pid: 12, name: "proc-b", cpuPercent: 40, memoryBytes: 200, username: "bob"},
			}, nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for {
		resp := svc.snapshotResponse("cpu")
		if resp.TimestampMs > 0 && len(resp.Processes) == 2 {
			if got := resp.Processes[0].PID; got != 12 {
				t.Fatalf("top process pid = %d, want 12", got)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for background snapshot: %+v", resp)
		}
		time.Sleep(10 * time.Millisecond)
	}

	systemBefore := systemCalls.Load()
	processBefore := processCalls.Load()

	resp := svc.snapshotResponse("memory")
	if resp.CPUUsage != 37.5 {
		t.Fatalf("cpu_usage = %v, want 37.5", resp.CPUUsage)
	}
	if got := len(resp.Processes); got != 2 {
		t.Fatalf("processes len = %d, want 2", got)
	}
	if got := resp.Processes[0].PID; got != 12 {
		t.Fatalf("top memory process pid = %d, want 12", got)
	}
	if systemCalls.Load() != systemBefore {
		t.Fatalf("snapshot response should not recollect system metrics")
	}
	if processCalls.Load() != processBefore {
		t.Fatalf("snapshot response should not recollect process metrics")
	}
}

func TestService_refreshProcessSnapshotKeepsLastSuccessfulData(t *testing.T) {
	t.Parallel()

	var processCalls atomic.Int32

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.systemRefreshTimeout = time.Second
	svc.processRefreshTimeout = time.Second
	svc.collectors = monitorCollectors{
		readCPUUsage:  func(context.Context) (float64, error) { return 12, nil },
		countCPUCores: func(context.Context) (int, error) { return 4, nil },
		readLoadAverage: func(context.Context) ([]float64, error) {
			return []float64{0.1, 0.2, 0.3}, nil
		},
		readNetworkCounters: func(context.Context) (networkCounters, error) {
			return networkCounters{bytesReceived: 1, bytesSent: 2}, nil
		},
		collectProcessMetrics: func(context.Context) ([]processWithMetrics, error) {
			call := processCalls.Add(1)
			if call == 1 {
				return []processWithMetrics{
					{pid: 21, name: "kept", cpuPercent: 99, memoryBytes: 10, username: "system"},
				}, nil
			}
			return nil, errors.New("boom")
		},
	}

	svc.refreshSystemSnapshot(context.Background())
	svc.refreshProcessSnapshot(context.Background())

	first := svc.snapshotResponse("cpu")
	if got := len(first.Processes); got != 1 {
		t.Fatalf("first processes len = %d, want 1", got)
	}
	if got := first.Processes[0].PID; got != 21 {
		t.Fatalf("first process pid = %d, want 21", got)
	}

	svc.refreshProcessSnapshot(context.Background())

	second := svc.snapshotResponse("cpu")
	if got := len(second.Processes); got != 1 {
		t.Fatalf("second processes len = %d, want 1", got)
	}
	if got := second.Processes[0].PID; got != 21 {
		t.Fatalf("second process pid = %d, want 21", got)
	}
}
