package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestAISessionRPCRemainsRegisteredWhileServiceIsUnavailable(t *testing.T) {
	router := sessionrpc.NewRouter()
	a := &Agent{}
	detach := a.registerAISessionRPC(router, &session.Meta{
		EndpointID: "env_local",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}, nil)
	t.Cleanup(detach)

	for _, method := range ai.RPCMethodInventory() {
		if method.Direction != ai.RPCDirectionRequest {
			continue
		}
		var rpcErr *sessionrpc.Error
		err := router.Call(context.Background(), method.TypeID, map[string]any{}, nil)
		if !errors.As(err, &rpcErr) {
			t.Errorf("AI RPC %s (%d) error = %v, want structured service error", method.Method, method.TypeID, err)
			continue
		}
		if rpcErr.Code == 404 {
			t.Errorf("AI RPC %s (%d) returned router-level 404", method.Method, method.TypeID)
		}
		if rpcErr.Code != 503 && rpcErr.Code != 400 {
			t.Errorf("AI RPC %s (%d) code = %d, want validation 400 or unavailable 503", method.Method, method.TypeID, rpcErr.Code)
		}
	}
}
