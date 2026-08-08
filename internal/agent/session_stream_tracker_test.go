package agent

import (
	"context"
	"io"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

type trackerTestSession struct {
	flowersec.Session
	stream flowersec.ByteStream
}

func (s *trackerTestSession) AcceptStream(context.Context) (flowersec.IncomingStream, error) {
	return flowersec.IncomingStream{Kind: "rpc", Stream: s.stream}, nil
}

type trackerTestStream struct {
	closed atomic.Int32
}

func (*trackerTestStream) Read([]byte) (int, error)    { return 0, io.EOF }
func (*trackerTestStream) Write(p []byte) (int, error) { return len(p), nil }
func (s *trackerTestStream) Close() error {
	s.closed.Add(1)
	return nil
}
func (*trackerTestStream) Kind() string                           { return "rpc" }
func (*trackerTestStream) TerminalError() *flowersec.SessionError { return nil }
func (*trackerTestStream) CloseWrite() error                      { return nil }
func (s *trackerTestStream) Reset() error                         { return s.Close() }

func TestDrainingEndpointSessionWaitsForAcceptedStreamClose(t *testing.T) {
	underlying := &trackerTestStream{}
	session := &drainingEndpointSession{Session: &trackerTestSession{stream: underlying}}
	incoming, err := session.AcceptStream(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	stream := incoming.Stream
	waitDone := make(chan struct{})
	go func() {
		session.Wait()
		close(waitDone)
	}()
	select {
	case <-waitDone:
		t.Fatal("session drained before the accepted stream closed")
	case <-time.After(25 * time.Millisecond):
	}
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-waitDone:
	case <-time.After(time.Second):
		t.Fatal("session did not drain after stream close")
	}
	if got := underlying.closed.Load(); got != 1 {
		t.Fatalf("underlying close count = %d, want 1", got)
	}
}
