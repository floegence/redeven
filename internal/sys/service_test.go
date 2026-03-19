package sys

import (
	"context"
	"net"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
)

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
	resp, err := rpctyped.Call[pingReq, pingResp](ctx, client, TypeID_SYS_PING, &pingReq{})
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
