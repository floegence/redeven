package monitor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/load"
	gopsutilNet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

const (
	// TypeID_SYS_MONITOR provides a monitoring snapshot (CPU/network/top processes).
	//
	// NOTE: The type_id must match Env App: internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_SYS_MONITOR uint32 = 3001
)

const (
	networkSpeedWindow            = 6 * time.Second
	networkHistoryMax             = 10
	monitorProcessLimit           = 20
	defaultSystemRefreshInterval  = 2 * time.Second
	defaultProcessRefreshInterval = 10 * time.Second
	defaultSystemRefreshTimeout   = 1500 * time.Millisecond
	defaultProcessRefreshTimeout  = 6 * time.Second
)

type Service struct {
	log        *slog.Logger
	collectors monitorCollectors
	netHistory *networkHistory

	systemRefreshInterval  time.Duration
	processRefreshInterval time.Duration
	systemRefreshTimeout   time.Duration
	processRefreshTimeout  time.Duration

	startOnce sync.Once

	mu           sync.RWMutex
	hasSystem    bool
	systemSnap   monitorSnapshot
	hasProcesses bool
	processSnap  processSnapshot
}

func NewService(log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		log:                    log,
		collectors:             defaultMonitorCollectors(),
		netHistory:             newNetworkHistory(networkHistoryMax, networkSpeedWindow),
		systemRefreshInterval:  defaultSystemRefreshInterval,
		processRefreshInterval: defaultProcessRefreshInterval,
		systemRefreshTimeout:   defaultSystemRefreshTimeout,
		processRefreshTimeout:  defaultProcessRefreshTimeout,
	}
}

func (s *Service) Start(ctx context.Context) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}

	s.startOnce.Do(func() {
		go s.runLoop(ctx, s.systemRefreshInterval, s.refreshSystemSnapshot)
		go s.runLoop(ctx, s.processRefreshInterval, s.refreshProcessSnapshot)
	})
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	s.RegisterWithAccessGate(r, meta, nil)
}

func (s *Service) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	if s == nil || r == nil {
		return
	}

	accessgate.RegisterTyped[sysMonitorReq, sysMonitorResp](r, TypeID_SYS_MONITOR, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *sysMonitorReq) (*sysMonitorResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}

		sortBy := "cpu"
		if req != nil {
			sortBy = normalizeSortBy(req.SortBy)
		}

		resp := s.snapshotResponse(sortBy)
		return &resp, nil
	})
}

type sysMonitorReq struct {
	SortBy string `json:"sort_by,omitempty"`
}

type sysMonitorResp struct {
	CPUUsage    float64   `json:"cpu_usage"`
	CPUCores    int       `json:"cpu_cores"`
	LoadAverage []float64 `json:"load_average,omitempty"`

	NetworkBytesReceived uint64  `json:"network_bytes_received"`
	NetworkBytesSent     uint64  `json:"network_bytes_sent"`
	NetworkSpeedReceived float64 `json:"network_speed_received"`
	NetworkSpeedSent     float64 `json:"network_speed_sent"`

	Platform string `json:"platform"`

	Processes   []processInfo `json:"processes"`
	TimestampMs int64         `json:"timestamp_ms"`
}

type processInfo struct {
	PID         int32   `json:"pid"`
	Name        string  `json:"name"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemoryBytes uint64  `json:"memory_bytes"`
	Username    string  `json:"username"`
}

type monitorSnapshot struct {
	collectedAt time.Time
	data        sysMonitorResp
	procMetrics []processWithMetrics
}

type processSnapshot struct {
	metrics []processWithMetrics
}

type processWithMetrics struct {
	pid         int32
	name        string
	cpuPercent  float64
	memoryBytes uint64
	username    string
}

type monitorCollectors struct {
	readCPUUsage          func(ctx context.Context) (float64, error)
	countCPUCores         func(ctx context.Context) (int, error)
	readLoadAverage       func(ctx context.Context) ([]float64, error)
	readNetworkCounters   func(ctx context.Context) (networkCounters, error)
	collectProcessMetrics func(ctx context.Context) ([]processWithMetrics, error)
}

type networkCounters struct {
	bytesReceived uint64
	bytesSent     uint64
}

func defaultMonitorCollectors() monitorCollectors {
	return monitorCollectors{
		readCPUUsage:  readCPUUsage,
		countCPUCores: func(ctx context.Context) (int, error) { return cpu.CountsWithContext(ctx, true) },
		readLoadAverage: func(ctx context.Context) ([]float64, error) {
			avg, err := load.AvgWithContext(ctx)
			if err != nil {
				return nil, err
			}
			if avg == nil {
				return nil, nil
			}
			return []float64{avg.Load1, avg.Load5, avg.Load15}, nil
		},
		readNetworkCounters: func(ctx context.Context) (networkCounters, error) {
			ioStats, err := gopsutilNet.IOCountersWithContext(ctx, false)
			if err != nil {
				return networkCounters{}, err
			}
			if len(ioStats) == 0 {
				return networkCounters{}, nil
			}
			return networkCounters{
				bytesReceived: ioStats[0].BytesRecv,
				bytesSent:     ioStats[0].BytesSent,
			}, nil
		},
		collectProcessMetrics: collectProcessMetrics,
	}
}

func (s *Service) runLoop(ctx context.Context, interval time.Duration, refresh func(context.Context)) {
	if s == nil || refresh == nil {
		return
	}
	refresh(ctx)
	if interval <= 0 {
		<-ctx.Done()
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refresh(ctx)
		}
	}
}

func (s *Service) refreshSystemSnapshot(parent context.Context) {
	if s == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, s.systemRefreshTimeout)
	defer cancel()

	snap := s.collectSystemSnapshot(ctx)

	s.mu.Lock()
	s.systemSnap = snap
	s.hasSystem = true
	s.mu.Unlock()
}

func (s *Service) refreshProcessSnapshot(parent context.Context) {
	if s == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, s.processRefreshTimeout)
	defer cancel()

	procMetrics, err := s.collectors.collectProcessMetrics(ctx)
	if err != nil {
		s.log.Warn("sys_monitor: get process list failed", "error", err)
		return
	}

	s.mu.Lock()
	s.processSnap = processSnapshot{
		metrics: append([]processWithMetrics(nil), procMetrics...),
	}
	s.hasProcesses = true
	s.mu.Unlock()
}

func (s *Service) collectSystemSnapshot(ctx context.Context) monitorSnapshot {
	resp := sysMonitorResp{
		Platform:  runtime.GOOS,
		Processes: []processInfo{},
	}

	// CPU usage: prefer non-blocking sampling (diff from last call) and per-CPU sampling on
	// macOS to avoid 0% results caused by coarse aggregated tick updates.
	if usage, err := s.collectors.readCPUUsage(ctx); err == nil {
		resp.CPUUsage = usage
	} else {
		s.log.Warn("sys_monitor: get cpu percent failed", "error", err)
	}

	cores, err := s.collectors.countCPUCores(ctx)
	if err == nil {
		resp.CPUCores = cores
	} else {
		s.log.Warn("sys_monitor: get cpu cores failed", "error", err)
	}

	loadAverage, err := s.collectors.readLoadAverage(ctx)
	if err == nil {
		resp.LoadAverage = loadAverage
	} else {
		s.log.Warn("sys_monitor: get load average failed", "error", err)
	}

	collectedAt := time.Now()
	counters, err := s.collectors.readNetworkCounters(ctx)
	if err == nil {
		resp.NetworkBytesReceived = counters.bytesReceived
		resp.NetworkBytesSent = counters.bytesSent
		s.netHistory.Add(networkStats{
			bytesReceived: counters.bytesReceived,
			bytesSent:     counters.bytesSent,
			at:            collectedAt,
		})
		recvSpd, sentSpd := s.netHistory.CalculateSpeed(collectedAt)
		resp.NetworkSpeedReceived = recvSpd
		resp.NetworkSpeedSent = sentSpd
	} else {
		s.log.Warn("sys_monitor: get network io failed", "error", err)
	}

	publishedAt := time.Now()
	resp.TimestampMs = publishedAt.UnixMilli()

	return monitorSnapshot{
		collectedAt: publishedAt,
		data:        resp,
		procMetrics: nil,
	}
}

func (s *Service) currentSnapshot() (monitorSnapshot, bool) {
	if s == nil {
		return monitorSnapshot{}, false
	}

	s.mu.RLock()
	if !s.hasSystem {
		s.mu.RUnlock()
		return monitorSnapshot{}, false
	}
	snap := s.systemSnap
	if s.hasProcesses {
		snap.procMetrics = append([]processWithMetrics(nil), s.processSnap.metrics...)
	}
	s.mu.RUnlock()

	return monitorSnapshot{
		collectedAt: snap.collectedAt,
		data:        snap.data,
		procMetrics: snap.procMetrics,
	}, true
}

func (s *Service) snapshotResponse(sortBy string) sysMonitorResp {
	snap, ok := s.currentSnapshot()
	if !ok {
		return sysMonitorResp{
			Platform:  runtime.GOOS,
			Processes: []processInfo{},
		}
	}
	return buildResponse(snap, sortBy)
}

func readCPUUsage(ctx context.Context) (float64, error) {
	var errs []error

	// Non-blocking: compare against the last call. This avoids short-interval sampling returning 0
	// on newer macOS versions due to coarse aggregated tick updates.
	if p, err := cpu.PercentWithContext(ctx, 0, true); err == nil && len(p) > 0 {
		return average(p), nil
	} else if err != nil {
		errs = append(errs, err)
	}
	if p, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(p) > 0 {
		return p[0], nil
	} else if err != nil {
		errs = append(errs, err)
	}

	// Fallback: take a short blocking interval to bootstrap lastTimes if needed.
	if p, err := cpu.PercentWithContext(ctx, 250*time.Millisecond, true); err == nil && len(p) > 0 {
		return average(p), nil
	} else if err != nil {
		errs = append(errs, err)
	}
	if p, err := cpu.PercentWithContext(ctx, 250*time.Millisecond, false); err == nil && len(p) > 0 {
		return p[0], nil
	} else if err != nil {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return 0, errors.Join(errs...)
	}
	return 0, fmt.Errorf("cpu percent unavailable")
}

func average(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

func collectProcessMetrics(ctx context.Context) ([]processWithMetrics, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]processWithMetrics, 0, len(procs))
	for _, p := range procs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if p == nil {
			continue
		}

		name, err := p.NameWithContext(ctx)
		if err != nil || strings.TrimSpace(name) == "" {
			// Some system processes may not allow name lookup; keep a readable fallback.
			name = fmt.Sprintf("[%d]", p.Pid)
		}

		cpuPercent, err := p.CPUPercentWithContext(ctx)
		if err != nil {
			cpuPercent = 0
		}

		var memBytes uint64
		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			memBytes = memInfo.RSS
		}

		username, err := p.UsernameWithContext(ctx)
		if err != nil || strings.TrimSpace(username) == "" {
			username = "system"
		}

		out = append(out, processWithMetrics{
			pid:         p.Pid,
			name:        name,
			cpuPercent:  cpuPercent,
			memoryBytes: memBytes,
			username:    username,
		})
	}

	return out, nil
}

func normalizeSortBy(sortBy string) string {
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "memory":
		return "memory"
	case "cpu":
		return "cpu"
	default:
		return "cpu"
	}
}

func buildResponse(snap monitorSnapshot, sortBy string) sysMonitorResp {
	resp := snap.data
	resp.Processes = selectTopProcesses(snap.procMetrics, sortBy, monitorProcessLimit)
	return resp
}

func selectTopProcesses(metrics []processWithMetrics, sortBy string, limit int) []processInfo {
	if len(metrics) == 0 || limit <= 0 {
		return []processInfo{}
	}

	sortBy = normalizeSortBy(sortBy)
	copied := make([]processWithMetrics, len(metrics))
	copy(copied, metrics)

	sort.Slice(copied, func(i, j int) bool {
		if sortBy == "memory" {
			return copied[i].memoryBytes > copied[j].memoryBytes
		}
		return copied[i].cpuPercent > copied[j].cpuPercent
	})

	if len(copied) > limit {
		copied = copied[:limit]
	}

	out := make([]processInfo, 0, len(copied))
	for _, p := range copied {
		name := strings.TrimSpace(p.name)
		if name == "" {
			name = fmt.Sprintf("[%d]", p.pid)
		}

		out = append(out, processInfo{
			PID:         p.pid,
			Name:        name,
			CPUPercent:  p.cpuPercent,
			MemoryBytes: p.memoryBytes,
			Username:    p.username,
		})
	}
	return out
}
