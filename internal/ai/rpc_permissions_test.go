package ai

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestRPC_Permissions_RequireRWX(t *testing.T) {
	t.Parallel()

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	router := rpc.NewRouter()
	svc := &Service{}
	meta := &session.Meta{CanRead: true, CanWrite: false, CanExecute: false}
	svc.RegisterRPC(router, meta, nil)

	server := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)

	assertRWXDenied := func(typeID uint32) {
		t.Helper()
		_, rpcErr, err := client.Call(context.Background(), typeID, []byte(`{}`))
		if err != nil {
			t.Fatalf("Call type_id=%d: %v", typeID, err)
		}
		if rpcErr == nil {
			t.Fatalf("Call type_id=%d: expected rpc error", typeID)
		}
		if rpcErr.Code != 403 {
			t.Fatalf("Call type_id=%d: code=%d, want 403", typeID, rpcErr.Code)
		}
		msg := ""
		if rpcErr.Message != nil {
			msg = strings.TrimSpace(*rpcErr.Message)
		}
		if !strings.Contains(msg, "read/write/execute permission denied") {
			t.Fatalf("Call type_id=%d: message=%q", typeID, msg)
		}
	}

	assertRWXDenied(TypeID_AI_SUBSCRIBE)
	assertRWXDenied(TypeID_AI_MESSAGES_LIST)
	assertRWXDenied(TypeID_AI_ACTIVE_RUN_SNAPSHOT)
	assertRWXDenied(TypeID_AI_SET_TOOL_COLLAPSED)

	cancel()
	_ = clientConn.Close()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("rpc server did not stop")
	}
}
