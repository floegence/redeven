package agent

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestLocalDirectSessionRegistersEveryAIRequestRPC(t *testing.T) {
	a := newProviderLinkTestAgent(t, "", nil)
	handlers, cleanup, err := a.NewLocalSessionHandlers(&session.Meta{
		EndpointID: "env_local",
		ChannelID:  "channel_test",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	})
	if err != nil {
		t.Fatalf("NewLocalSessionHandlers() error = %v", err)
	}
	t.Cleanup(cleanup)

	registered := registeredFlowersecRPCTypeIDs(t, handlers)
	for _, method := range ai.RPCMethodInventory() {
		if method.Direction != ai.RPCDirectionRequest {
			continue
		}
		if _, ok := registered[method.TypeID]; !ok {
			t.Errorf("local direct session missing AI RPC %s (%d)", method.Method, method.TypeID)
		}
	}
}

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

func registeredFlowersecRPCTypeIDs(t *testing.T, handlers *flowersec.SessionHandlers) map[uint32]struct{} {
	t.Helper()
	value := reflect.ValueOf(handlers)
	if !value.IsValid() || value.IsNil() {
		t.Fatal("missing Flowersec session handlers")
	}
	rpcHandlers := value.Elem().FieldByName("rpcHandlers")
	if !rpcHandlers.IsValid() || rpcHandlers.Kind() != reflect.Map {
		t.Fatal("Flowersec session handlers do not expose the expected registry to this compatibility test")
	}
	ids := make([]uint32, 0, rpcHandlers.Len())
	for _, key := range rpcHandlers.MapKeys() {
		ids = append(ids, uint32(key.Uint()))
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	result := make(map[uint32]struct{}, len(ids))
	for _, typeID := range ids {
		result[typeID] = struct{}{}
	}
	return result
}
