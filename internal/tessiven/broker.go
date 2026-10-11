package tessiven

import (
	"context"
	"encoding/json"
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
	// Authorize rechecks the current source policy at every effect boundary.
	Authorize func(*session.Meta) *session.Meta
	mu        sync.Mutex
	conn      *brokerConnection
}
type brokerConnection struct {
	source  string
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
type DesktopSourceScope struct {
	UserPublicID string `json:"user_public_id"`
	FloeApp      string `json:"floe_app"`
}

type TargetResourceRequest struct {
	Request     ResourceRequest     `json:"request"`
	Permissions ResourcePermissions `json:"permissions"`
}
type brokerResponse struct {
	ID     string `json:"id"`
	Result any    `json:"result"`
	Error  string `json:"error,omitempty"`
	Code   string `json:"code,omitempty"`
	Status int    `json:"status,omitempty"`
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
func (b *Broker) Serve(ctx context.Context, ws *websocket.Conn, source string) error {
	if source == "" {
		return ErrTargetUnavailable
	}
	c := &brokerConnection{source: source, ws: ws, pending: map[string]chan brokerResponse{}, done: make(chan struct{})}
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
	var result ResourceResult
	err := b.call(ctx, meta, req, "resource", isResourceMutation(req.Action), &result)
	if err == nil && result.RuntimeRef != req.RuntimeRef {
		err = ErrResourceChanged
		if isResourceMutation(req.Action) {
			err = ErrOutcomeUnknown
		}
	}
	return result, err
}

func (b *Broker) SourceActive(source string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if source == "" || b.conn == nil || b.conn.source != source {
		return false
	}
	select {
	case <-b.conn.done:
		return false
	default:
		return true
	}
}

func (b *Broker) call(ctx context.Context, meta *session.Meta, req any, kind string, mutation bool, out any) error {
	if meta == nil || !meta.CanRead {
		return ErrPermissionDenied
	}
	b.mu.Lock()
	c := b.conn
	b.mu.Unlock()
	if c == nil || !b.SourceActive(meta.DesktopSource) {
		return ErrTargetUnavailable
	}
	if ctx.Err() != nil {
		return ErrTargetUnavailable
	}
	if b.Authorize != nil {
		meta = b.Authorize(meta)
		if meta == nil || !meta.CanRead || mutation && (!meta.CanWrite || !meta.CanExecute) {
			return ErrPermissionDenied
		}
	}
	transportError := func(cause error) error {
		if mutation {
			return fmt.Errorf("%w: %v", ErrOutcomeUnknown, cause)
		}
		return fmt.Errorf("%w: %v", ErrTargetUnavailable, cause)
	}
	id := uuid.NewString()
	reply := make(chan brokerResponse, 1)
	c.mu.Lock()
	if len(c.pending) >= 32 {
		c.mu.Unlock()
		return errors.New("tessiven host request capacity reached")
	}
	c.pending[id] = reply
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	payload := struct {
		ID          string              `json:"id"`
		Kind        string              `json:"kind"`
		Request     any                 `json:"request"`
		Permissions ResourcePermissions `json:"permissions"`
		Scope       DesktopSourceScope  `json:"scope"`
	}{id, kind, req, ResourcePermissions{meta.CanRead, meta.CanWrite, meta.CanExecute, meta.CanAdmin}, DesktopSourceScope{meta.UserPublicID, meta.FloeApp}}
	c.write.Lock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := c.ws.WriteJSON(payload)
	c.write.Unlock()
	if err != nil {
		c.close()
		return transportError(err)
	}
	timer := time.NewTimer(35 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return transportError(ctx.Err())
	case <-c.done:
		return transportError(ErrTargetUnavailable)
	case <-timer.C:
		return transportError(context.DeadlineExceeded)
	case response := <-reply:
		if response.Error != "" {
			if response.Code == "TESSIVEN_OUTCOME_UNKNOWN" {
				return ErrOutcomeUnknown
			}
			if response.Code == "TESSIVEN_TARGET_UNAVAILABLE" {
				return ErrTargetUnavailable
			}
			if response.Status >= 400 && response.Status < 500 && response.Code != "" {
				return &ResourceError{Code: response.Code, Message: response.Error, Status: response.Status}
			}
			return transportError(ErrTargetUnavailable)
		}
		if !b.SourceActive(meta.DesktopSource) {
			return transportError(ErrTargetUnavailable)
		}
		if b.Authorize != nil {
			current := b.Authorize(meta)
			if current == nil || !current.CanRead || mutation && (!current.CanWrite || !current.CanExecute) {
				if mutation {
					return ErrOutcomeUnknown
				}
				return ErrPermissionDenied
			}
		}
		raw, err := json.Marshal(response.Result)
		if err != nil {
			return err
		}
		return json.Unmarshal(raw, out)
	}
}
