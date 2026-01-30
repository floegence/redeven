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
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/load"
	gopsutilNet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

const (
	// TypeID_SYS_MONITOR provides a monitoring snapshot (CPU/network/top processes).
	//
	// NOTE: The type_id must match Region Frontend: frontend/region/src/ui/services/typeIds.ts.
	TypeID_SYS_MONITOR uint32 = 3001
)

const (
	monitorCacheTTL     = 2 * time.Second
	networkSpeedWindow  = 6 * time.Second
	networkHistoryMax   = 10
	monitorProcessLimit = 20
)

type Service struct {
	log *slog.Logger

	mu      sync.Mutex
	hasSnap bool
	snap    monitorSnapshot

	netHistory *networkHistory
}

func NewService(log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		log:        log,
		netHistory: newNetworkHistory(networkHistoryMax, networkSpeedWindow),
	}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	if s == nil || r == nil {
		return
	}

	rpctyped.Register[sysMonitorReq, sysMonitorResp](r, TypeID_SYS_MONITOR, func(ctx context.Context, req *sysMonitorReq) (*sysMonitorResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}

		sortBy := "cpu"
		if req != nil {
			sortBy = normalizeSortBy(req.SortBy)
		}

		snap := s.getSnapshot(ctx)
		resp := buildResponse(snap, sortBy)
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

type processWithMetrics struct {
	pid         int32
	name        string
	cpuPercent  float64
	memoryBytes uint64
	username    string
}

func (s *Service) getSnapshot(ctx context.Context) monitorSnapshot {
	now := time.Now()

	s.mu.Lock()
	if s.hasSnap && now.Sub(s.snap.collectedAt) < monitorCacheTTL {
		out := s.snap
		s.mu.Unlock()
		return out
	}
	s.mu.Unlock()

	snap := s.collectSnapshot(ctx)

	s.mu.Lock()
	s.snap = snap
	s.hasSnap = true
	s.mu.Unlock()

	return snap
}

func (s *Service) collectSnapshot(ctx context.Context) monitorSnapshot {
	collectedAt := time.Now()

	resp := sysMonitorResp{
		Platform: runtime.GOOS,
	}

	// CPU usage: prefer non-blocking sampling (diff from last call) and per-CPU sampling on
	// macOS to avoid 0% results caused by coarse aggregated tick updates.
	if usage, err := readCPUUsage(ctx); err == nil {
		resp.CPUUsage = usage
	} else {
		s.log.Warn("sys_monitor: get cpu percent failed", "error", err)
	}

	cores, err := cpu.CountsWithContext(ctx, true)
	if err == nil {
		resp.CPUCores = cores
	} else if err != nil {
		s.log.Warn("sys_monitor: get cpu cores failed", "error", err)
	}

	if avg, err := load.AvgWithContext(ctx); err == nil && avg != nil {
		resp.LoadAverage = []float64{avg.Load1, avg.Load5, avg.Load15}
	} else if err != nil {
		s.log.Warn("sys_monitor: get load average failed", "error", err)
	}

	// Network + speed
	if ioStats, err := gopsutilNet.IOCountersWithContext(ctx, false); err == nil && len(ioStats) > 0 {
		resp.NetworkBytesReceived = ioStats[0].BytesRecv
		resp.NetworkBytesSent = ioStats[0].BytesSent

		s.netHistory.Add(networkStats{
			bytesReceived: ioStats[0].BytesRecv,
			bytesSent:     ioStats[0].BytesSent,
			at:            collectedAt,
		})

		recvSpd, sentSpd := s.netHistory.CalculateSpeed(collectedAt)
		resp.NetworkSpeedReceived = recvSpd
		resp.NetworkSpeedSent = sentSpd
	} else if err != nil {
		s.log.Warn("sys_monitor: get network io failed", "error", err)
	}

	procMetrics, err := collectProcessMetrics(ctx)
	if err != nil {
		s.log.Warn("sys_monitor: get process list failed", "error", err)
		procMetrics = nil
	}

	resp.TimestampMs = collectedAt.UnixMilli()

	return monitorSnapshot{
		collectedAt: collectedAt,
		data:        resp,
		procMetrics: procMetrics,
	}
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
