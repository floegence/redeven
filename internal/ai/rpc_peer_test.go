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
	nextNotifyID  uint64
	notifications map[uint32]map[uint64]func(context.Context, json.RawMessage)
}

func newTestRPCPeer(router *sessionrpc.Router) *testRPCPeer {
	return &testRPCPeer{router: router, notifications: make(map[uint32]map[uint64]func(context.Context, json.RawMessage))}
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
	handlers := make([]func(context.Context, json.RawMessage), 0, len(peer.notifications[typeID]))
	for _, handler := range peer.notifications[typeID] {
		handlers = append(handlers, handler)
	}
	peer.mu.RUnlock()
	for _, handler := range handlers {
		handler(ctx, append(json.RawMessage(nil), encoded...))
	}
	return nil
}

func (peer *testRPCPeer) OnNotify(typeID uint32, handler func(context.Context, json.RawMessage)) func() {
	peer.mu.Lock()
	peer.nextNotifyID++
	notifyID := peer.nextNotifyID
	if peer.notifications[typeID] == nil {
		peer.notifications[typeID] = make(map[uint64]func(context.Context, json.RawMessage))
	}
	peer.notifications[typeID][notifyID] = handler
	peer.mu.Unlock()
	return func() {
		peer.mu.Lock()
		delete(peer.notifications[typeID], notifyID)
		peer.mu.Unlock()
	}
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
