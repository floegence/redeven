package agent

import (
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	fsstream "github.com/floegence/flowersec/flowersec-go/stream"
)

type trackerTestSession struct {
	endpoint.Session
	stream fsstream.Stream
}

func (s *trackerTestSession) AcceptStreamHello(int) (string, fsstream.Stream, error) {
	return "rpc", s.stream, nil
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
func (s *trackerTestStream) Reset() error { return s.Close() }

func TestDrainingEndpointSessionWaitsForAcceptedStreamClose(t *testing.T) {
	underlying := &trackerTestStream{}
	session := &drainingEndpointSession{Session: &trackerTestSession{stream: underlying}}
	_, stream, err := session.AcceptStreamHello(1024)
	if err != nil {
		t.Fatal(err)
	}
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
