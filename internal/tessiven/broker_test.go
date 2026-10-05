package tessiven

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/gorilla/websocket"
)

func connectedBroker(t *testing.T) (*Broker, *websocket.Conn) {
	t.Helper()
	broker := &Broker{}
	ready := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		go func() {
			for {
				broker.mu.Lock()
				connected := broker.conn != nil
				broker.mu.Unlock()
				if connected {
					close(ready)
					return
				}
				time.Sleep(time.Millisecond)
			}
		}()
		_ = broker.Serve(r.Context(), ws)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(broker.Close)
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ws.Close() })
	select {
	case <-ready:
	case <-time.After(time.Second):
		t.Fatal("host failed to attach")
	}
	return broker, ws
}

func TestBrokerPreservesExactTargetAndPermissions(t *testing.T) {
	broker, ws := connectedBroker(t)
	req := ResourceRequest{RuntimeRef: "ssh:authorized", Action: "inspect", Binding: &Binding{Owner: "managed_service", ResourceID: "actual-id"}}
	meta := &session.Meta{CanRead: true}
	go func() {
		var message struct {
			ID string `json:"id"`
			TargetResourceRequest
		}
		if err := ws.ReadJSON(&message); err != nil {
			return
		}
		if message.Request.RuntimeRef != req.RuntimeRef || message.Permissions.Write || message.Permissions.Execute || message.Request.Binding.ResourceID != "actual-id" {
			t.Error("authority widened in transit")
		}
		_ = ws.WriteJSON(brokerResponse{ID: message.ID, Result: ResourceResult{RuntimeRef: req.RuntimeRef}})
	}()
	result, err := broker.Execute(t.Context(), meta, req)
	if err != nil || result.RuntimeRef != req.RuntimeRef {
		t.Fatal(result, err)
	}
	if _, err := broker.Execute(t.Context(), &session.Meta{}, req); !errors.Is(err, ErrPermissionDenied) {
		t.Fatal("missing read permission admitted", err)
	}
}
func TestBrokerDisconnectMakesDispatchedMutationUnknown(t *testing.T) {
	broker, ws := connectedBroker(t)
	go func() { var message any; _ = ws.ReadJSON(&message); _ = ws.Close() }()
	_, err := broker.Execute(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, ResourceRequest{RuntimeRef: "ssh:authorized", Action: "restart"})
	if !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatal("ambiguous action became retryable", err)
	}
}
func TestBrokerRejectsSubstitutedTarget(t *testing.T) {
	broker, ws := connectedBroker(t)
	go func() {
		var message struct {
			ID string `json:"id"`
		}
		_ = ws.ReadJSON(&message)
		_ = ws.WriteJSON(brokerResponse{ID: message.ID, Result: ResourceResult{RuntimeRef: "local:local"}})
	}()
	_, err := broker.Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "ssh:authorized", Action: "inspect"})
	if !errors.Is(err, ErrResourceChanged) {
		t.Fatal("target substitution accepted", err)
	}
}
func TestBrokerNeverReconnectsOrRetries(t *testing.T) {
	broker := &Broker{}
	_, err := broker.Execute(context.Background(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "ssh:missing", Action: "start"})
	if !errors.Is(err, ErrTargetUnavailable) {
		t.Fatal(err)
	}
}
