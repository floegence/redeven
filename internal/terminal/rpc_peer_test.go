package terminal

import (
	"context"
	"encoding/json"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type testRPCPeer struct {
	router *sessionrpc.Router

	mu            sync.RWMutex
	notifications map[uint32][]func(context.Context, json.RawMessage)
}

func newTestRPCPeer(router *sessionrpc.Router) *testRPCPeer {
	return &testRPCPeer{
		router:        router,
		notifications: make(map[uint32][]func(context.Context, json.RawMessage)),
	}
}

func (peer *testRPCPeer) Call(ctx context.Context, typeID uint32, request, response any) error {
	return peer.router.Call(ctx, typeID, request, response)
}

func (peer *testRPCPeer) Notify(ctx context.Context, typeID uint32, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	peer.mu.RLock()
	handlers := append([]func(context.Context, json.RawMessage){}, peer.notifications[typeID]...)
	peer.mu.RUnlock()
	for _, handler := range handlers {
		handler(ctx, append(json.RawMessage(nil), encoded...))
	}
	return nil
}

func (peer *testRPCPeer) OnNotify(typeID uint32, handler func(context.Context, json.RawMessage)) func() {
	peer.mu.Lock()
	peer.notifications[typeID] = append(peer.notifications[typeID], handler)
	peer.mu.Unlock()
	return func() {}
}

var _ flowersec.RPCPeer = (*testRPCPeer)(nil)
