package sys

import (
	"context"
	"net"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/rpcutil"
)

type staticMaintenanceProvider struct {
	snapshot *MaintenanceSnapshot
}

func (p staticMaintenanceProvider) CurrentMaintenanceSnapshot() *MaintenanceSnapshot {
	if p.snapshot == nil {
		return nil
	}
	out := *p.snapshot
	return &out
}

type staticRuntimeServiceProvider struct {
	snapshot RuntimeServiceSnapshot
}

func (p staticRuntimeServiceProvider) CurrentRuntimeServiceSnapshot() RuntimeServiceSnapshot {
	return p.snapshot
}

func TestServicePingReportsProcessStartedAt(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	router := rpc.NewRouter()
	NewService(Options{
		AgentInstanceID:    "agent_demo",
		ProcessStartedAtMs: 123456789,
		Version:            "v1.2.3",
		Commit:             "abc123",
		BuildTime:          "2026-03-19T00:00:00Z",
	}).Register(router, nil)

	srv := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = srv.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)
	resp, err := rpcutil.CallJSON[pingReq, pingResp](ctx, client, TypeID_SYS_PING, &pingReq{})
	if err != nil {
		t.Fatalf("sys.ping error = %v", err)
	}
	if resp == nil {
		t.Fatalf("sys.ping returned nil response")
	}
	if resp.ProcessStartedAtMs != 123456789 {
		t.Fatalf("ProcessStartedAtMs = %d, want 123456789", resp.ProcessStartedAtMs)
	}
	if resp.AgentInstanceID != "agent_demo" {
		t.Fatalf("AgentInstanceID = %q", resp.AgentInstanceID)
	}
}

func TestServicePingReportsMaintenanceSnapshot(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	router := rpc.NewRouter()
	NewService(Options{
		AgentInstanceID:    "agent_demo",
		ProcessStartedAtMs: 123456789,
		Version:            "v1.2.3",
		Commit:             "abc123",
		BuildTime:          "2026-03-19T00:00:00Z",
		Maintenance: staticMaintenanceProvider{
			snapshot: &MaintenanceSnapshot{
				Kind:          MaintenanceKindUpgrade,
				State:         MaintenanceStateFailed,
				TargetVersion: "v1.3.0",
				Message:       "Install failed: curl: (6) Could not resolve host.",
				StartedAtMs:   101,
				UpdatedAtMs:   202,
			},
		},
	}).Register(router, nil)

	srv := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = srv.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)
	resp, err := rpcutil.CallJSON[pingReq, pingResp](ctx, client, TypeID_SYS_PING, &pingReq{})
	if err != nil {
		t.Fatalf("sys.ping error = %v", err)
	}
	if resp == nil || resp.Maintenance == nil {
		t.Fatalf("Maintenance = nil, want snapshot")
	}
	if resp.Maintenance.Kind != MaintenanceKindUpgrade {
		t.Fatalf("Maintenance.Kind = %q, want %q", resp.Maintenance.Kind, MaintenanceKindUpgrade)
	}
	if resp.Maintenance.State != MaintenanceStateFailed {
		t.Fatalf("Maintenance.State = %q, want %q", resp.Maintenance.State, MaintenanceStateFailed)
	}
	if resp.Maintenance.Message != "Install failed: curl: (6) Could not resolve host." {
		t.Fatalf("Maintenance.Message = %q", resp.Maintenance.Message)
	}
}

func TestServicePingReportsRuntimeServiceSnapshot(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	router := rpc.NewRouter()
	NewService(Options{
		AgentInstanceID:    "agent_demo",
		ProcessStartedAtMs: 123456789,
		Version:            "v1.2.3",
		RuntimeService: staticRuntimeServiceProvider{
			snapshot: RuntimeServiceSnapshot{
				RuntimeVersion:   "v1.2.3",
				ProtocolVersion:  "redeven-runtime-v1",
				ServiceOwner:     "desktop",
				DesktopManaged:   true,
				EffectiveRunMode: "hybrid",
				RemoteEnabled:    true,
				Compatibility:    "compatible",
				ActiveWorkload: RuntimeServiceWorkload{
					TerminalCount:    2,
					SessionCount:     1,
					PortForwardCount: 3,
				},
			},
		},
	}).Register(router, nil)

	srv := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = srv.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)
	resp, err := rpcutil.CallJSON[pingReq, pingResp](ctx, client, TypeID_SYS_PING, &pingReq{})
	if err != nil {
		t.Fatalf("sys.ping error = %v", err)
	}
	if resp == nil || resp.RuntimeService == nil {
		t.Fatalf("RuntimeService = nil, want snapshot")
	}
	if resp.RuntimeService.RuntimeVersion != "v1.2.3" || resp.RuntimeService.ActiveWorkload.PortForwardCount != 3 {
		t.Fatalf("unexpected runtime service snapshot: %#v", resp.RuntimeService)
	}
}
