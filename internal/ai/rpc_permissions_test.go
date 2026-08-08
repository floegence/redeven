package ai

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestRPC_Permissions_RequireRWX(t *testing.T) {
	t.Parallel()

	router := sessionrpc.NewRouter()
	svc := &Service{}
	meta := &session.Meta{CanRead: true, CanWrite: false, CanExecute: false}
	peer := newTestRPCPeer(router)
	svc.RegisterRPC(router, meta, peer)

	assertRWXDenied := func(typeID uint32) {
		t.Helper()
		_, rpcErr, err := callTestRPC(context.Background(), peer, typeID, []byte(`{}`))
		if err != nil {
			t.Fatalf("Call type_id=%d: %v", typeID, err)
		}
		if rpcErr == nil {
			t.Fatalf("Call type_id=%d: expected rpc error", typeID)
		}
		if rpcErr.Code != 403 {
			t.Fatalf("Call type_id=%d: code=%d, want 403", typeID, rpcErr.Code)
		}
		msg := strings.TrimSpace(rpcErr.Message)
		if !strings.Contains(msg, "read/write/execute permission denied") {
			t.Fatalf("Call type_id=%d: message=%q", typeID, msg)
		}
	}

	assertRWXDenied(TypeID_AI_SUBSCRIBE_SUMMARY)
	assertRWXDenied(TypeID_AI_SUBSCRIBE_THREAD)
	assertRWXDenied(TypeID_AI_MESSAGES_LIST)

}
