// Package sessionrpc contains Redeven's application RPC registrations.
//
// It deliberately owns no transport, framing, connection, or session
// lifecycle. Flowersec v2 supplies those concerns through SessionHandlers and
// RPCPeer; this package only keeps product type IDs and JSON handlers together.
package sessionrpc

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

// Error is a bounded Redeven application error returned to a peer.
type Error struct {
	Code    uint32
	Message string
}

func ToWireError(err *Error) *flowersec.RPCError {
	if err == nil {
		return nil
	}
	return &flowersec.RPCError{Code: err.Code, Message: err.Message}
}

func (err *Error) Error() string {
	if err == nil {
		return "<nil>"
	}
	return err.Message
}

// Handler is one Redeven business RPC handler. Payload encoding is part of the
// product contract; Flowersec owns the enclosing RPC transport.
type Handler func(context.Context, json.RawMessage) (json.RawMessage, *Error)

// RPCRegistrar is the smallest Flowersec registration boundary shared by an
// endpoint-client RPCHandlers and an accepted-session SessionHandlers. Keeping
// this interface role-neutral prevents client code from borrowing the
// accepted-server stream facade.
type RPCRegistrar interface {
	HandleRPC(uint32, flowersec.RPCHandler) error
}

// Router collects immutable product handlers before Flowersec freezes the
// session's handler registry.
type Router struct {
	mu       sync.RWMutex
	handlers map[uint32]Handler
}

// Call invokes a registered business handler. It is intentionally a small
// in-process contract used by focused product tests; network transport remains
// Flowersec's RPCPeer/SessionHandlers.
func (router *Router) Call(ctx context.Context, typeID uint32, request, response any) error {
	if router == nil {
		return errors.New("missing RPC router")
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	router.mu.RLock()
	handler := router.handlers[typeID]
	router.mu.RUnlock()
	if handler == nil {
		return &Error{Code: 404, Message: "RPC handler not found"}
	}
	result, callErr := handler(ctx, payload)
	if callErr != nil {
		return callErr
	}
	if response == nil || len(result) == 0 {
		return nil
	}
	return json.Unmarshal(result, response)
}

func NewRouter() *Router {
	return &Router{handlers: make(map[uint32]Handler)}
}

func (router *Router) Register(typeID uint32, handler Handler) {
	if router == nil || typeID == 0 || handler == nil {
		return
	}
	router.mu.Lock()
	router.handlers[typeID] = handler
	router.mu.Unlock()
}

// Bind installs the complete product handler set on Flowersec before a
// session is established. Unknown type IDs remain Flowersec application errors.
func (router *Router) Bind(handlers RPCRegistrar) error {
	if router == nil || handlers == nil {
		return errors.New("missing Redeven RPC handler registry")
	}
	router.mu.RLock()
	registrations := make(map[uint32]Handler, len(router.handlers))
	for typeID, handler := range router.handlers {
		registrations[typeID] = handler
	}
	router.mu.RUnlock()
	for typeID, handler := range registrations {
		typeID, handler := typeID, handler
		if err := handlers.HandleRPC(typeID, func(ctx context.Context, payload json.RawMessage) (any, *flowersec.RPCError) {
			response, callErr := handler(ctx, append(json.RawMessage(nil), payload...))
			if callErr != nil {
				return nil, &flowersec.RPCError{Code: callErr.Code, Message: callErr.Message}
			}
			if len(response) == 0 {
				return struct{}{}, nil
			}
			return json.RawMessage(response), nil
		}); err != nil {
			return err
		}
	}
	return nil
}
