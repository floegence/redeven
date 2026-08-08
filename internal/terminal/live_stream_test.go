package terminal

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestLiveStreamRejectsMissingProcessPermission(t *testing.T) {
	manager := newQuietTestManager(t, t.TempDir())
	t.Cleanup(manager.Cleanup)
	created, err := manager.createSession("permission-test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	server, client := net.Pipe()
	t.Cleanup(func() {
		_ = server.Close()
		_ = client.Close()
	})
	done := make(chan error, 1)
	go func() {
		done <- manager.ServeLiveStream(context.Background(), server, &session.Meta{CanRead: true}, nil)
	}()

	attach, err := livev1.EncodeAttach(livev1.Attach{
		AttachGeneration: 1,
		Cols:             80,
		Rows:             24,
		SessionID:        created.ID,
		ConnectionID:     "permission-connection",
	})
	if err != nil {
		t.Fatalf("EncodeAttach() error = %v", err)
	}
	if _, err := client.Write(attach); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	frame, err := livev1.ReadFrame(client)
	if err != nil {
		t.Fatalf("ReadFrame() error = %v", err)
	}
	if frame.Type != livev1.FrameError {
		t.Fatalf("frame type = %v, want error", frame.Type)
	}
	if len(frame.Payload) < 2 {
		t.Fatalf("error payload length = %d, want at least 2", len(frame.Payload))
	}
	if code := binary.BigEndian.Uint16(frame.Payload[:2]); code != livev1.ErrorCodePermissionDenied {
		t.Fatalf("error code = %d, want %d", code, livev1.ErrorCodePermissionDenied)
	}
	if serveErr := <-done; !strings.Contains(serveErr.Error(), "permission") {
		t.Fatalf("ServeLiveStream() error = %v, want permission denial", serveErr)
	}
}

func TestTerminalRPCDoesNotRegisterLegacyLiveTypeIDs(t *testing.T) {
	manager := newQuietTestManager(t, t.TempDir())
	t.Cleanup(manager.Cleanup)

	router := sessionrpc.NewRouter()
	peer := newTestRPCPeer(router)
	detach := manager.RegisterWithAccessGate(
		router,
		&session.Meta{CanWrite: true, CanExecute: true},
		peer,
		nil,
	)
	defer detach()

	for _, typeID := range []uint32{2003, 2004, 2005, 2006} {
		callCtx, callCancel := context.WithTimeout(context.Background(), time.Second)
		var response any
		err := peer.Call(callCtx, typeID, struct{}{}, &response)
		callCancel()
		var rpcErr *sessionrpc.Error
		if !errors.As(err, &rpcErr) || rpcErr.Code != 404 {
			t.Fatalf("Call(typeID=%d) rpc error = %#v, want handler not found", typeID, err)
		}
	}
}
