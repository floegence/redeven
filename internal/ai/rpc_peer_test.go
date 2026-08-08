package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type testRPCPeer struct {
	router *sessionrpc.Router

	mu            sync.RWMutex
	notifications map[uint32][]func(json.RawMessage)
}

func newTestRPCPeer(router *sessionrpc.Router) *testRPCPeer {
	return &testRPCPeer{router: router, notifications: make(map[uint32][]func(json.RawMessage))}
}

func (peer *testRPCPeer) Call(ctx context.Context, typeID uint32, request, response any) error {
	return peer.router.Call(ctx, typeID, request, response)
}

func (peer *testRPCPeer) Notify(_ context.Context, typeID uint32, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	peer.mu.RLock()
	handlers := append([]func(json.RawMessage){}, peer.notifications[typeID]...)
	peer.mu.RUnlock()
	for _, handler := range handlers {
		handler(append(json.RawMessage(nil), encoded...))
	}
	return nil
}

func (peer *testRPCPeer) OnNotify(typeID uint32, handler func(json.RawMessage)) {
	peer.mu.Lock()
	peer.notifications[typeID] = append(peer.notifications[typeID], handler)
	peer.mu.Unlock()
}

func callTestRPC(ctx context.Context, peer *testRPCPeer, typeID uint32, request json.RawMessage) (json.RawMessage, *sessionrpc.Error, error) {
	var response json.RawMessage
	if err := peer.Call(ctx, typeID, request, &response); err != nil {
		var rpcErr *sessionrpc.Error
		if errors.As(err, &rpcErr) {
			return nil, rpcErr, nil
		}
		return nil, nil, err
	}
	return response, nil, nil
}

var _ flowersec.RPCPeer = (*testRPCPeer)(nil)
