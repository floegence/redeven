//go:build !floeterm_native

package agent

import (
	"context"
	"encoding/binary"
	"net"
	"strings"
	"testing"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

func TestTerminalLiveStreamFailsClosedWithoutNativeActor(t *testing.T) {
	manager := terminal.NewManager("/bin/sh", t.TempDir(), nil)
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateSession("native-engine-required", "")
	if err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	handler := (&Agent{term: manager}).terminalLiveStreamHandler(
		&session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	)
	serverConn, clientConn := net.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- handler(context.Background(), flowersec.IncomingStream{
			Kind: livev1.StreamKind, Stream: &terminalTestByteStream{Conn: serverConn},
		})
	}()
	t.Cleanup(func() {
		_ = clientConn.Close()
		_ = serverConn.Close()
	})

	attach, err := livev1.EncodeAttach(livev1.Attach{
		AttachGeneration: 1,
		Cols:             80,
		Rows:             24,
		SessionID:        created.ID,
		ConnectionID:     "stub-must-fail-closed",
	})
	if err != nil {
		t.Fatalf("EncodeAttach() error = %v", err)
	}
	if _, err := clientConn.Write(attach); err != nil {
		t.Fatalf("Write(attach) error = %v", err)
	}
	frame, err := livev1.ReadFrame(clientConn)
	if err != nil {
		t.Fatalf("ReadFrame(error) error = %v", err)
	}
	if frame.Type != livev1.FrameError || len(frame.Payload) < 2 {
		t.Fatalf("attach response = %#v, want protocol error", frame)
	}
	if code := binary.BigEndian.Uint16(frame.Payload[:2]); code != livev1.ErrorCodeInternal {
		t.Fatalf("error code = %d, want internal failure", code)
	}
	if serveErr := <-done; serveErr == nil || !strings.Contains(serveErr.Error(), "semantic session actor is unavailable") {
		t.Fatalf("ServeLiveStream() error = %v, want native actor unavailable", serveErr)
	}
}
