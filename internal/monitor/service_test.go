package monitor

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/rpcutil"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
	"github.com/shirou/gopsutil/v4/process"
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

func Test_networkHistory_CalculateSpeed_handlesCounterReset(t *testing.T) {
	t.Parallel()

	h := newNetworkHistory(10, 6*time.Second)
	now := time.Now()
	h.Add(networkStats{bytesReceived: 1200, bytesSent: 900, at: now.Add(-2 * time.Second)})
	h.Add(networkStats{bytesReceived: 100, bytesSent: 50, at: now})

	recv, sent := h.CalculateSpeed(now)
	if recv != 0 || sent != 0 {
		t.Fatalf("speed after counter reset = (%v,%v), want (0,0)", recv, sent)
	}
}

func TestService_StartPublishesCachedSnapshot(t *testing.T) {
	t.Parallel()

	var systemCalls atomic.Int32
	var processCalls atomic.Int32
	var runtimeCalls atomic.Int32

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
		readRuntimeMetrics: func(context.Context) (runtimeProcessMetricsResp, error) {
			runtimeCalls.Add(1)
			return runtimeProcessMetricsResp{CPUPercent: 12.5, MemoryBytes: 4096, SampledAtMs: 1234}, nil
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
	runtimeBefore := runtimeCalls.Load()

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
	if runtimeCalls.Load() != runtimeBefore {
		t.Fatalf("snapshot response should not recollect runtime process metrics")
	}
	runtimeMetrics, ok := svc.runtimeProcessMetricsSnapshot()
	if !ok {
		t.Fatal("runtime process metrics unavailable")
	}
	if runtimeMetrics.CPUPercent != 12.5 || runtimeMetrics.MemoryBytes != 4096 || runtimeMetrics.SampledAtMs != 1234 {
		t.Fatalf("runtime process metrics = %+v", runtimeMetrics)
	}
}

func TestService_RuntimeProcessMetricsRequiresReadPermissionNotExecute(t *testing.T) {
	t.Parallel()

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.mu.Lock()
	svc.hasRuntimeMetrics = true
	svc.runtimeMetricsSnap = runtimeProcessMetricsResp{CPUPercent: 18.75, MemoryBytes: 8192, SampledAtMs: 4567}
	svc.mu.Unlock()

	router := sessionrpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true, CanExecute: false})
	resp, err := rpcutil.CallJSON[runtimeProcessMetricsReq, runtimeProcessMetricsResp](
		context.Background(),
		router,
		TypeID_RUNTIME_PROCESS_METRICS,
		&runtimeProcessMetricsReq{},
	)
	if err != nil {
		t.Fatalf("runtime process metrics RPC error = %v", err)
	}
	if resp.CPUPercent != 18.75 || resp.MemoryBytes != 8192 || resp.SampledAtMs != 4567 {
		t.Fatalf("runtime process metrics RPC = %+v", resp)
	}
}

func TestService_RuntimeProcessMetricsRejectsMissingReadPermission(t *testing.T) {
	t.Parallel()

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.mu.Lock()
	svc.hasRuntimeMetrics = true
	svc.runtimeMetricsSnap = runtimeProcessMetricsResp{CPUPercent: 1, MemoryBytes: 2, SampledAtMs: 3}
	svc.mu.Unlock()

	router := sessionrpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: false, CanExecute: true})
	_, err := rpcutil.CallJSON[runtimeProcessMetricsReq, runtimeProcessMetricsResp](
		context.Background(),
		router,
		TypeID_RUNTIME_PROCESS_METRICS,
		&runtimeProcessMetricsReq{},
	)
	rpcErr, ok := err.(*sessionrpc.Error)
	if !ok || rpcErr.Code != 403 || rpcErr.Message != "read permission denied" {
		t.Fatalf("runtime process metrics RPC error = %#v, want 403 read permission denied", err)
	}
}

func TestService_RuntimeProcessMetricsUnavailableBeforeSample(t *testing.T) {
	t.Parallel()

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	router := sessionrpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true})
	_, err := rpcutil.CallJSON[runtimeProcessMetricsReq, runtimeProcessMetricsResp](
		context.Background(),
		router,
		TypeID_RUNTIME_PROCESS_METRICS,
		&runtimeProcessMetricsReq{},
	)
	rpcErr, ok := err.(*sessionrpc.Error)
	if !ok || rpcErr.Code != 503 || rpcErr.Message != "runtime process metrics unavailable" {
		t.Fatalf("runtime process metrics RPC error = %#v, want 503 unavailable", err)
	}
}

func TestService_RuntimeProcessMetricsSamplingFailureIsUnavailable(t *testing.T) {
	t.Parallel()

	failRuntimeMetrics := false
	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.collectors = monitorCollectors{
		readCPUUsage:        func(context.Context) (float64, error) { return 0, nil },
		countCPUCores:       func(context.Context) (int, error) { return 1, nil },
		readLoadAverage:     func(context.Context) ([]float64, error) { return nil, nil },
		readNetworkCounters: func(context.Context) (networkCounters, error) { return networkCounters{}, nil },
		readRuntimeMetrics: func(context.Context) (runtimeProcessMetricsResp, error) {
			if failRuntimeMetrics {
				return runtimeProcessMetricsResp{}, errors.New("sample failed")
			}
			return runtimeProcessMetricsResp{CPUPercent: 5, MemoryBytes: 4096, SampledAtMs: 1234}, nil
		},
	}

	svc.refreshSystemSnapshot(context.Background())
	if got, ok := svc.runtimeProcessMetricsSnapshot(); !ok || got.CPUPercent != 5 {
		t.Fatalf("first runtime process metrics = (%+v, %v), want available", got, ok)
	}

	failRuntimeMetrics = true
	svc.refreshSystemSnapshot(context.Background())
	if got, ok := svc.runtimeProcessMetricsSnapshot(); ok {
		t.Fatalf("runtime process metrics after failed sample = (%+v, %v), want unavailable", got, ok)
	}
}

func TestService_SystemMonitorStillRequiresExecutePermission(t *testing.T) {
	t.Parallel()

	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.mu.Lock()
	svc.hasSystem = true
	svc.systemSnap = monitorSnapshot{data: sysMonitorResp{Platform: "test", Processes: []processInfo{}}}
	svc.mu.Unlock()

	readOnlyRouter := sessionrpc.NewRouter()
	svc.Register(readOnlyRouter, &session.Meta{CanRead: true, CanExecute: false})
	_, err := rpcutil.CallJSON[sysMonitorReq, sysMonitorResp](
		context.Background(),
		readOnlyRouter,
		TypeID_SYS_MONITOR,
		&sysMonitorReq{},
	)
	rpcErr, ok := err.(*sessionrpc.Error)
	if !ok || rpcErr.Code != 403 || rpcErr.Message != "execute permission denied" {
		t.Fatalf("system monitor RPC error = %#v, want 403 execute permission denied", err)
	}

	executeRouter := sessionrpc.NewRouter()
	svc.Register(executeRouter, &session.Meta{CanExecute: true})
	if _, err := rpcutil.CallJSON[sysMonitorReq, sysMonitorResp](
		context.Background(),
		executeRouter,
		TypeID_SYS_MONITOR,
		&sysMonitorReq{},
	); err != nil {
		t.Fatalf("system monitor RPC with execute permission error = %v", err)
	}
}

func TestReadRuntimeProcessMetricsSamplesExactProcessHandle(t *testing.T) {
	t.Parallel()

	currentProcess, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		t.Fatalf("open current process: %v", err)
	}
	metrics, err := readRuntimeProcessMetrics(context.Background(), currentProcess)
	if err != nil {
		t.Fatalf("read current process metrics: %v", err)
	}
	if metrics.CPUPercent < 0 || metrics.MemoryBytes == 0 || metrics.SampledAtMs <= 0 {
		t.Fatalf("current process metrics = %+v, want non-negative CPU, positive RSS and sample time", metrics)
	}
}

func TestNormalizeRuntimeProcessMetricsRejectsInvalidCPU(t *testing.T) {
	t.Parallel()

	sampledAt := time.UnixMilli(4321)
	for _, value := range []float64{-1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		got := normalizeRuntimeProcessMetrics(runtimeProcessMetricsResp{CPUPercent: value}, sampledAt)
		if got.CPUPercent != 0 || got.SampledAtMs != 4321 {
			t.Fatalf("normalize CPU %v = %+v, want zero CPU and supplied sample time", value, got)
		}
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

func Test_killProcessByPID_invalidPID(t *testing.T) {
	t.Parallel()

	err := killProcessByPID(context.Background(), 0)
	if !errors.Is(err, errInvalidProcessPID) {
		t.Fatalf("killProcessByPID error = %v, want invalid pid", err)
	}
}

func Test_killProcessByPID_terminatesStartedProcess(t *testing.T) {
	t.Parallel()

	cmd := exec.Command(os.Args[0], "-test.run=TestHelperProcessSleep", "--")
	cmd.Env = append(os.Environ(), "GO_WANT_HELPER_PROCESS_SLEEP=1")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start helper process: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	time.Sleep(150 * time.Millisecond)

	if err := killProcessByPID(context.Background(), int32(cmd.Process.Pid)); err != nil {
		t.Fatalf("killProcessByPID: %v", err)
	}

	select {
	case err := <-done:
		if err == nil {
			t.Fatalf("helper process exited cleanly, want killed process error")
		}
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatalf("timed out waiting for helper process to exit")
	}
}

func TestHelperProcessSleep(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS_SLEEP") != "1" {
		return
	}

	time.Sleep(30 * time.Second)
	os.Exit(0)
}
