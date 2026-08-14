package terminal

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
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

func TestSemanticClearRPCRequiresCurrentAttachmentGenerationAndReturnsActorCut(t *testing.T) {
	manager := newQuietTestManager(t, t.TempDir())
	t.Cleanup(manager.Cleanup)
	created, err := manager.createSession("semantic-clear", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	if _, ok := created.LatestPresentation(); !ok {
		t.Skip("native semantic engine is not enabled in this test lane")
	}
	if err := created.AttachSemanticView("view", "local", 1); err != nil {
		t.Fatalf("AttachSemanticView() error = %v", err)
	}
	created.EnsureSemanticController("view", "local", 1)
	attachment, err := created.AttachSemanticLiveConnection("view", 1, 80, 24, termgo.LiveSubscriber{})
	if err != nil {
		t.Fatalf("AttachSemanticLiveConnection() error = %v", err)
	}
	t.Cleanup(func() {
		attachment.Detach()
		created.LogicalDetachSemanticView("view", 1)
	})
	if err := manager.activateSessionFunc(context.Background(), created.ID, 80, 24); err != nil {
		t.Fatalf("ActivateSessionContext() error = %v", err)
	}
	if _, err := created.ApplySemanticControllerSize("view", 80, 24, true); err != nil {
		t.Fatalf("ApplySemanticControllerSize() error = %v", err)
	}

	router := sessionrpc.NewRouter()
	peer := newTestRPCPeer(router)
	detach := manager.RegisterWithAccessGate(router, &session.Meta{CanWrite: true, CanExecute: true}, peer, nil)
	defer detach()

	stale := terminalSemanticClearResp{}
	err = peer.Call(context.Background(), TypeID_TERMINAL_CLEAR, terminalSemanticClearReq{
		SessionID: created.ID, ConnectionID: "view", TransportGeneration: 2,
	}, &stale)
	var rpcErr *sessionrpc.Error
	if !errors.As(err, &rpcErr) || rpcErr.Code != 409 {
		t.Fatalf("stale clear error = %#v, want generation conflict", err)
	}
	before, ok := created.LatestPresentation()
	if !ok {
		t.Fatal("latest presentation is unavailable before clear")
	}

	var response terminalSemanticClearResp
	if err := peer.Call(context.Background(), TypeID_TERMINAL_CLEAR, terminalSemanticClearReq{
		SessionID: created.ID, ConnectionID: "view", TransportGeneration: 1,
	}, &response); err != nil {
		t.Fatalf("semantic clear RPC error = %v", err)
	}
	after, ok := created.LatestPresentation()
	if !ok {
		t.Fatal("latest presentation is unavailable after clear")
	}
	if response.PresentationSequence != after.Sequence || response.ContentEpoch != after.State.ContentEpoch {
		t.Fatalf("clear response = %+v, latest presentation = %+v", response, after)
	}
	if after.Sequence <= before.Sequence || after.State.ContentEpoch != before.State.ContentEpoch+1 {
		t.Fatalf("clear actor cut did not advance atomically: before=%+v after=%+v", before.State, after.State)
	}
}
