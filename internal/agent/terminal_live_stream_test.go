package agent

import (
	"context"
	"net"
	"testing"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

type terminalTestByteStream struct{ net.Conn }

func (*terminalTestByteStream) Kind() string                           { return livev1.StreamKind }
func (*terminalTestByteStream) TerminalError() *flowersec.SessionError { return nil }
func (*terminalTestByteStream) CloseWrite() error                      { return nil }
func (stream *terminalTestByteStream) Reset() error                    { return stream.Close() }

func TestTerminalLiveStreamHandlerReturnsInvalidStreamError(t *testing.T) {
	handler := (&Agent{}).terminalLiveStreamHandler(&session.Meta{CanRead: true})
	if err := handler(context.Background(), flowersec.IncomingStream{Kind: livev1.StreamKind}); err == nil {
		t.Fatal("terminal live stream handler error = nil, want unavailable stream error")
	}
}

func TestRegisterTerminalLiveStreamHandlesNamedStream(t *testing.T) {
	manager := terminal.NewManager("/bin/sh", t.TempDir(), nil)
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateSession("named-stream", "")
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	agent := &Agent{term: manager}
	handler := agent.terminalLiveStreamHandler(&session.Meta{CanRead: true})

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	done := make(chan error, 1)
	go func() {
		done <- handler(context.Background(), flowersec.IncomingStream{Kind: livev1.StreamKind, Stream: &terminalTestByteStream{Conn: serverConn}})
	}()
	attach, err := livev1.EncodeAttach(livev1.Attach{
		AttachGeneration: 1,
		Cols:             80,
		Rows:             24,
		SessionID:        created.ID,
		ConnectionID:     "agent-stream-test",
	})
	if err != nil {
		t.Fatalf("EncodeAttach() error = %v", err)
	}
	if _, err := clientConn.Write(attach); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	frame, err := livev1.ReadFrame(clientConn)
	if err != nil {
		t.Fatalf("ReadFrame() error = %v", err)
	}
	if frame.Type != livev1.FrameError {
		t.Fatalf("frame type = %v, want permission error", frame.Type)
	}
	_ = clientConn.Close()
	if err := <-done; err == nil {
		t.Fatal("terminal live stream handler error = nil, want permission error")
	}
}
