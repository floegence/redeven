package tessiven

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Broker is a bounded request bridge to Desktop's already-authorized connections.
// It owns no inventory, reconnect loop, operation progress, or mutation retries.
type Broker struct {
	mu   sync.Mutex
	conn *brokerConnection
}
type brokerConnection struct {
	ws      *websocket.Conn
	write   sync.Mutex
	mu      sync.Mutex
	pending map[string]chan brokerResponse
	done    chan struct{}
	once    sync.Once
}
type ResourcePermissions struct {
	Read    bool `json:"read"`
	Write   bool `json:"write"`
	Execute bool `json:"execute"`
	Admin   bool `json:"admin"`
}
type TargetResourceRequest struct {
	Request     ResourceRequest     `json:"request"`
	Permissions ResourcePermissions `json:"permissions"`
}
type brokerResponse struct {
	ID     string         `json:"id"`
	Result ResourceResult `json:"result"`
	Error  string         `json:"error,omitempty"`
	Code   string         `json:"code,omitempty"`
	Status int            `json:"status,omitempty"`
}

func (b *Broker) Close() {
	b.mu.Lock()
	c := b.conn
	b.conn = nil
	b.mu.Unlock()
	if c != nil {
		c.close()
	}
}
func (c *brokerConnection) close() { c.once.Do(func() { close(c.done); _ = c.ws.Close() }) }
func (b *Broker) Serve(ctx context.Context, ws *websocket.Conn) error {
	c := &brokerConnection{ws: ws, pending: map[string]chan brokerResponse{}, done: make(chan struct{})}
	b.mu.Lock()
	if b.conn != nil {
		b.mu.Unlock()
		_ = ws.Close()
		return errors.New("a Tessiven host connection is already active")
	}
	b.conn = c
	b.mu.Unlock()
	defer func() {
		c.close()
		b.mu.Lock()
		if b.conn == c {
			b.conn = nil
		}
		b.mu.Unlock()
	}()
	ws.SetReadLimit(4 << 20)
	_ = ws.SetReadDeadline(time.Now().Add(45 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				c.close()
				return
			case <-c.done:
				return
			case <-ticker.C:
				if ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					c.close()
					return
				}
			}
		}
	}()
	for {
		var response brokerResponse
		if err := ws.ReadJSON(&response); err != nil {
			return err
		}
		c.mu.Lock()
		reply := c.pending[response.ID]
		c.mu.Unlock()
		if reply != nil {
			select {
			case reply <- response:
			default:
			}
		}
	}
}
func (b *Broker) Execute(ctx context.Context, meta *session.Meta, req ResourceRequest) (ResourceResult, error) {
	if meta == nil || !meta.CanRead {
		return ResourceResult{}, ErrPermissionDenied
	}
	b.mu.Lock()
	c := b.conn
	b.mu.Unlock()
	if c == nil {
		return ResourceResult{}, ErrTargetUnavailable
	}
	id := uuid.NewString()
	reply := make(chan brokerResponse, 1)
	c.mu.Lock()
	if len(c.pending) >= 32 {
		c.mu.Unlock()
		return ResourceResult{}, errors.New("tessiven host request capacity reached")
	}
	c.pending[id] = reply
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	payload := struct {
		ID string `json:"id"`
		TargetResourceRequest
	}{id, TargetResourceRequest{req, ResourcePermissions{meta.CanRead, meta.CanWrite, meta.CanExecute, meta.CanAdmin}}}
	c.write.Lock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := c.ws.WriteJSON(payload)
	c.write.Unlock()
	if err != nil {
		c.close()
		return ResourceResult{}, brokerTransportError(req, err)
	}
	timer := time.NewTimer(35 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ResourceResult{}, brokerTransportError(req, ctx.Err())
	case <-c.done:
		return ResourceResult{}, brokerTransportError(req, ErrTargetUnavailable)
	case <-timer.C:
		return ResourceResult{}, brokerTransportError(req, context.DeadlineExceeded)
	case response := <-reply:
		if response.Error != "" {
			if response.Code == "TESSIVEN_OUTCOME_UNKNOWN" {
				return ResourceResult{}, ErrOutcomeUnknown
			}
			if response.Status >= 400 && response.Status < 500 && response.Code != "" {
				return ResourceResult{}, &ResourceError{Code: response.Code, Message: response.Error, Status: response.Status}
			}
			return ResourceResult{}, brokerTransportError(req, ErrTargetUnavailable)
		}
		if response.Result.RuntimeRef != req.RuntimeRef {
			if isResourceMutation(req.Action) {
				return ResourceResult{}, brokerTransportError(req, ErrResourceChanged)
			}
			return ResourceResult{}, ErrResourceChanged
		}
		return response.Result, nil
	}
}
func (p ResourcePermissions) Meta() *session.Meta {
	return &session.Meta{CanRead: p.Read, CanWrite: p.Write, CanExecute: p.Execute, CanAdmin: p.Admin}
}

// A failed delivery can be ambiguous even when WriteJSON itself fails.
func brokerTransportError(req ResourceRequest, cause error) error {
	if isResourceMutation(req.Action) {
		return fmt.Errorf("%w: %v", ErrOutcomeUnknown, cause)
	}
	return fmt.Errorf("%w: %v", ErrTargetUnavailable, cause)
}
