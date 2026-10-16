package monitor

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	gopsutilNet "github.com/shirou/gopsutil/v4/net"
)

func Test_readNetworkCounters_excludesLoopback(t *testing.T) {
	t.Parallel()
	counters, err := readNetworkCounters(context.Background(),
		func() ([]net.Interface, error) {
			return []net.Interface{{Name: "lo", Flags: net.FlagLoopback}, {Name: "eth0", Flags: net.FlagUp}}, nil
		},
		func(_ context.Context, pernic bool) ([]gopsutilNet.IOCountersStat, error) {
			if !pernic {
				t.Fatal("network sampling must read individual interfaces")
			}
			return []gopsutilNet.IOCountersStat{
				{Name: "lo", BytesRecv: 1000000, BytesSent: 2000000},
				{Name: "eth0", BytesRecv: 100, BytesSent: 200},
			}, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if want := (networkCounters{bytesReceived: 100, bytesSent: 200}); counters != want {
		t.Fatalf("network counters = %+v, want non-loopback counters %+v", counters, want)
	}
}

func Test_readNetworkCounters_usesInterfaceFlags(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		interfaces []net.Interface
		stats      []gopsutilNet.IOCountersStat
		want       networkCounters
	}{
		{name: "no interfaces"},
		{name: "no counters", interfaces: []net.Interface{{Name: "eth0"}}},
		{name: "only loopback", interfaces: []net.Interface{{Name: "lo", Flags: net.FlagLoopback}, {Name: "lo0", Flags: net.FlagUp | net.FlagLoopback}}, stats: []gopsutilNet.IOCountersStat{{Name: "lo", BytesRecv: 1000, BytesSent: 2000}, {Name: "lo0", BytesRecv: 3000, BytesSent: 4000}}},
		{name: "arbitrary loopback name", interfaces: []net.Interface{{Name: "local-custom", Flags: net.FlagLoopback}, {Name: "en0", Flags: net.FlagUp}}, stats: []gopsutilNet.IOCountersStat{{Name: "local-custom", BytesRecv: 1000, BytesSent: 2000}, {Name: "en0", BytesRecv: 3, BytesSent: 4}}, want: networkCounters{3, 4}},
		{name: "loopback-like name without flag", interfaces: []net.Interface{{Name: "lo0", Flags: net.FlagUp}}, stats: []gopsutilNet.IOCountersStat{{Name: "lo0", BytesRecv: 5, BytesSent: 6}}, want: networkCounters{5, 6}},
		{name: "multiple physical virtual and down interfaces", interfaces: []net.Interface{{Name: "eth0", Flags: net.FlagUp}, {Name: "bridge0", Flags: net.FlagBroadcast}, {Name: "utun7", Flags: net.FlagPointToPoint}, {Name: "en1"}}, stats: []gopsutilNet.IOCountersStat{{Name: "utun7", BytesRecv: 30, BytesSent: 300}, {Name: "en1", BytesRecv: 40, BytesSent: 400}, {Name: "eth0", BytesRecv: 10, BytesSent: 100}, {Name: "bridge0", BytesRecv: 20, BytesSent: 200}}, want: networkCounters{100, 1000}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			got, err := readNetworkCounters(ctx, func() ([]net.Interface, error) { return tc.interfaces, nil }, func(gotCtx context.Context, pernic bool) ([]gopsutilNet.IOCountersStat, error) {
				if gotCtx != ctx || !pernic {
					t.Fatal("reader must forward the context and request per-interface counters")
				}
				return tc.stats, nil
			})
			if err != nil || got != tc.want {
				t.Fatalf("readNetworkCounters() = %+v, %v; want %+v, nil", got, err, tc.want)
			}
		})
	}
}

func Test_readNetworkCounters_refreshesInterfaceMetadata(t *testing.T) {
	t.Parallel()
	flags := net.FlagLoopback
	listCalls, counterCalls := 0, 0
	list := func() ([]net.Interface, error) {
		listCalls++
		return []net.Interface{{Name: "changing0", Flags: flags}}, nil
	}
	read := func(context.Context, bool) ([]gopsutilNet.IOCountersStat, error) {
		counterCalls++
		return []gopsutilNet.IOCountersStat{{Name: "changing0", BytesRecv: 100, BytesSent: 200}}, nil
	}
	for _, want := range []networkCounters{{}, {100, 200}} {
		got, err := readNetworkCounters(context.Background(), list, read)
		if err != nil || got != want {
			t.Fatalf("readNetworkCounters() = %+v, %v; want %+v, nil", got, err, want)
		}
		flags = 0
	}
	if listCalls != 2 || counterCalls != 2 {
		t.Fatalf("sampling calls = (%d, %d), want (2, 2)", listCalls, counterCalls)
	}
}

func Test_readNetworkCounters_rejectsIncompleteSamples(t *testing.T) {
	t.Parallel()
	failure := errors.New("collector failed")
	for _, stage := range []string{"interfaces", "counters", "metadata", "canceled before sampling", "canceled during enumeration", "canceled during counters", "deadline"} {
		t.Run(stage, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			wantErr := failure
			wantLists, wantReads := 1, 1
			if stage == "interfaces" {
				wantReads = 0
			}
			if strings.HasPrefix(stage, "canceled") {
				wantErr = context.Canceled
			}
			if stage == "canceled before sampling" {
				cancel()
				wantLists, wantReads = 0, 0
			}
			if stage == "canceled during enumeration" {
				wantReads = 0
			}
			if stage == "deadline" {
				deadlineCtx, deadlineCancel := context.WithDeadline(ctx, time.Now().Add(-time.Second))
				defer deadlineCancel()
				ctx = deadlineCtx
				wantErr, wantLists, wantReads = context.DeadlineExceeded, 0, 0
			}
			lists, reads := 0, 0
			got, err := readNetworkCounters(ctx, func() ([]net.Interface, error) {
				lists++
				if stage == "interfaces" {
					return nil, failure
				}
				if stage == "canceled during enumeration" {
					cancel()
				}
				return []net.Interface{{Name: "eth0"}}, nil
			}, func(context.Context, bool) ([]gopsutilNet.IOCountersStat, error) {
				reads++
				if stage == "counters" {
					return []gopsutilNet.IOCountersStat{{Name: "eth0", BytesRecv: 99}}, failure
				}
				if stage == "canceled during counters" {
					cancel()
				}
				stats := []gopsutilNet.IOCountersStat{{Name: "eth0", BytesRecv: 100, BytesSent: 200}}
				if stage == "metadata" {
					stats = append(stats, gopsutilNet.IOCountersStat{Name: "removed0", BytesRecv: 1000})
				}
				return stats, nil
			})
			if got != (networkCounters{}) {
				t.Fatalf("failed sample returned partial counters: %+v", got)
			}
			if stage == "metadata" {
				if err == nil || !strings.Contains(err.Error(), "removed0") {
					t.Fatalf("metadata error = %v, want unmatched interface name", err)
				}
			} else if !errors.Is(err, wantErr) {
				t.Fatalf("error = %v, want %v", err, wantErr)
			}
			if lists != wantLists || reads != wantReads {
				t.Fatalf("sampling calls = (%d, %d), want (%d, %d)", lists, reads, wantLists, wantReads)
			}
		})
	}
}

func TestService_NetworkSnapshotExcludesLoopback(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name           string
		received, sent uint64
	}{
		{name: "only loopback grows", received: 100, sent: 200},
		{name: "both interfaces grow", received: 300, sent: 800},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := newNetworkTestService()
			stats := []gopsutilNet.IOCountersStat{{Name: "lo0", BytesRecv: 1000000, BytesSent: 1000000}, {Name: "en0", BytesRecv: 100, BytesSent: 200}}
			calls := 0
			svc.collectors.readNetworkCounters = func(ctx context.Context) (networkCounters, error) {
				calls++
				return readNetworkCounters(ctx, func() ([]net.Interface, error) {
					return []net.Interface{{Name: "lo0", Flags: net.FlagLoopback}, {Name: "en0"}}, nil
				}, func(context.Context, bool) ([]gopsutilNet.IOCountersStat, error) { return stats, nil })
			}
			first := svc.collectSystemSnapshot(context.Background()).data
			if first.NetworkBytesReceived != 100 || first.NetworkBytesSent != 200 || first.NetworkSpeedReceived != 0 || first.NetworkSpeedSent != 0 {
				t.Fatalf("first network snapshot = %+v", first)
			}
			svc.netHistory.items[0].at = time.Now().Add(-2 * time.Second)
			stats[0].BytesRecv += 1000000
			stats[0].BytesSent += 1000000
			stats[1].BytesRecv, stats[1].BytesSent = tc.received, tc.sent
			svc.refreshSystemSnapshot(context.Background())
			got := svc.snapshotResponse("cpu")
			dt := svc.netHistory.items[1].at.Sub(svc.netHistory.items[0].at).Seconds()
			wantRecv, wantSent := float64(tc.received-100)/dt, float64(tc.sent-200)/dt
			if got.NetworkBytesReceived != tc.received || got.NetworkBytesSent != tc.sent || got.NetworkSpeedReceived != wantRecv || got.NetworkSpeedSent != wantSent {
				t.Fatalf("network snapshot = %+v, want counters (%d, %d) and speeds (%v, %v)", got, tc.received, tc.sent, wantRecv, wantSent)
			}
			if calls != 2 {
				t.Fatalf("network read calls = %d, want 2; cached RPC must not recollect", calls)
			}
		})
	}
}

func TestService_NetworkFailureRecoversWithoutRecordingFailedSample(t *testing.T) {
	t.Parallel()
	for _, stage := range []string{"interfaces", "counters", "metadata", "cancellation"} {
		t.Run(stage, func(t *testing.T) {
			t.Parallel()
			svc := newNetworkTestService()
			svc.netHistory.Add(networkStats{bytesReceived: 100, bytesSent: 200, at: time.Now().Add(-2 * time.Second)})
			failing := true
			svc.collectors.readNetworkCounters = func(ctx context.Context) (networkCounters, error) {
				ctx, cancel := context.WithCancel(ctx)
				defer cancel()
				return readNetworkCounters(ctx, func() ([]net.Interface, error) {
					if failing && stage == "interfaces" {
						return nil, errors.New("interface enumeration failed")
					}
					return []net.Interface{{Name: "eth0"}}, nil
				}, func(context.Context, bool) ([]gopsutilNet.IOCountersStat, error) {
					if failing && stage == "counters" {
						return nil, errors.New("counter read failed")
					}
					if failing && stage == "cancellation" {
						cancel()
					}
					name := "eth0"
					if failing && stage == "metadata" {
						name = "removed0"
					}
					return []gopsutilNet.IOCountersStat{{Name: name, BytesRecv: 300, BytesSent: 800}}, nil
				})
			}
			svc.refreshSystemSnapshot(context.Background())
			failed := svc.snapshotResponse("cpu")
			if failed.NetworkBytesReceived != 0 || failed.NetworkBytesSent != 0 || failed.NetworkSpeedReceived != 0 || failed.NetworkSpeedSent != 0 || len(svc.netHistory.items) != 1 {
				t.Fatalf("failed network sample changed counters or history: %+v, history length %d", failed, len(svc.netHistory.items))
			}
			if failed.CPUUsage != 12 || failed.MemoryUsedBytes != 512 || failed.TimestampMs == 0 {
				t.Fatalf("network failure interrupted other system metrics: %+v", failed)
			}
			failing = false
			svc.refreshSystemSnapshot(context.Background())
			recovered := svc.snapshotResponse("cpu")
			if recovered.NetworkBytesReceived != 300 || recovered.NetworkBytesSent != 800 || recovered.NetworkSpeedReceived <= 0 || recovered.NetworkSpeedSent <= 0 || len(svc.netHistory.items) != 2 {
				t.Fatalf("network did not recover: %+v, history length %d", recovered, len(svc.netHistory.items))
			}
			// A gap beyond the speed window must bootstrap from a new valid sample.
			for i := range svc.netHistory.items {
				svc.netHistory.items[i].at = time.Now().Add(-time.Hour)
			}
			svc.refreshSystemSnapshot(context.Background())
			afterGap := svc.snapshotResponse("cpu")
			if afterGap.NetworkSpeedReceived != 0 || afterGap.NetworkSpeedSent != 0 {
				t.Fatalf("speed after a long sampling gap = (%v, %v), want (0, 0)", afterGap.NetworkSpeedReceived, afterGap.NetworkSpeedSent)
			}
		})
	}
}

func newNetworkTestService() *Service {
	svc := NewService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.collectors = monitorCollectors{
		readCPUUsage:    func(context.Context) (float64, error) { return 12, nil },
		countCPUCores:   func(context.Context) (int, error) { return 4, nil },
		readLoadAverage: func(context.Context) ([]float64, error) { return nil, nil },
		readMemoryUsage: func(context.Context) (memoryUsage, error) { return memoryUsage{totalBytes: 1024, usedBytes: 512}, nil },
	}
	return svc
}
