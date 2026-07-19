package agent

import (
	"context"
	"net"
	"testing"
	"time"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	"github.com/floegence/flowersec/flowersec-go/endpoint/serve"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

func TestRegisterTerminalLiveStreamHandlesNamedStream(t *testing.T) {
	manager := terminal.NewManager("/bin/sh", t.TempDir(), nil)
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateSession("named-stream", "")
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	agent := &Agent{term: manager}
	server, err := serve.New(serve.Options{})
	if err != nil {
		t.Fatalf("serve.New() error = %v", err)
	}
	agent.registerTerminalLiveStream(server, &session.Meta{CanRead: true})

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	done := make(chan struct{})
	go func() {
		server.HandleStream(context.Background(), livev1.StreamKind, serverConn)
		close(done)
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
	<-done
}

func TestRegisterTerminalLiveStreamServesAuthorizedAttachAndResize(t *testing.T) {
	manager := terminal.NewManager("/bin/sh", t.TempDir(), nil)
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateSession("named-stream-authorized", "")
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	agent := &Agent{term: manager}
	server, err := serve.New(serve.Options{})
	if err != nil {
		t.Fatalf("serve.New() error = %v", err)
	}
	agent.registerTerminalLiveStream(server, &session.Meta{CanRead: true, CanWrite: true, CanExecute: true})

	serverConn, clientConn := net.Pipe()
	done := make(chan struct{})
	go func() {
		server.HandleStream(context.Background(), livev1.StreamKind, serverConn)
		close(done)
	}()
	t.Cleanup(func() {
		_ = clientConn.Close()
		_ = serverConn.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("terminal live stream handler did not stop")
		}
	})

	attach, err := livev1.EncodeAttach(livev1.Attach{
		AttachGeneration: 1,
		Cols:             100,
		Rows:             30,
		SessionID:        created.ID,
		ConnectionID:     "agent-authorized-stream",
	})
	if err != nil {
		t.Fatalf("EncodeAttach() error = %v", err)
	}
	if _, err := clientConn.Write(attach); err != nil {
		t.Fatalf("Write(attach) error = %v", err)
	}
	attachedFrame, err := livev1.ReadFrame(clientConn)
	if err != nil {
		t.Fatalf("ReadFrame(attached) error = %v", err)
	}
	attached, err := livev1.DecodeAttached(attachedFrame)
	if err != nil {
		t.Fatalf("DecodeAttached() error = %v", err)
	}
	if attached.Cols != 100 || attached.Rows != 30 {
		t.Fatalf("attached geometry = %dx%d, want 100x30", attached.Cols, attached.Rows)
	}

	resize, err := livev1.EncodeResize(livev1.Resize{Sequence: 1, Cols: 90, Rows: 25})
	if err != nil {
		t.Fatalf("EncodeResize() error = %v", err)
	}
	if _, err := clientConn.Write(resize); err != nil {
		t.Fatalf("Write(resize) error = %v", err)
	}
	for {
		frame, readErr := livev1.ReadFrame(clientConn)
		if readErr != nil {
			t.Fatalf("ReadFrame(resize applied) error = %v", readErr)
		}
		if frame.Type != livev1.FrameResizeApplied {
			continue
		}
		applied, decodeErr := livev1.DecodeResizeApplied(frame)
		if decodeErr != nil {
			t.Fatalf("DecodeResizeApplied() error = %v", decodeErr)
		}
		if applied.Sequence != 1 || applied.Cols != 90 || applied.Rows != 25 {
			t.Fatalf("resize applied = %#v, want sequence 1 and 90x25", applied)
		}
		break
	}
}
