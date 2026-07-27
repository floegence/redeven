package agent

import (
	"sync"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	fsstream "github.com/floegence/flowersec/flowersec-go/stream"
)

// drainingEndpointSession accounts a stream before Flowersec dispatches its
// handler. This closes the ServeSession return-to-handler-start race without
// changing the released Flowersec dependency.
type drainingEndpointSession struct {
	endpoint.Session
	streams sync.WaitGroup
}

func (s *drainingEndpointSession) AcceptStreamHello(maxHelloBytes int) (string, fsstream.Stream, error) {
	kind, stream, err := s.Session.AcceptStreamHello(maxHelloBytes)
	if err != nil {
		return kind, stream, err
	}
	s.streams.Add(1)
	return kind, &drainingEndpointStream{Stream: stream, done: s.streams.Done}, nil
}

func (s *drainingEndpointSession) Wait() {
	if s != nil {
		s.streams.Wait()
	}
}

type drainingEndpointStream struct {
	fsstream.Stream
	done      func()
	closeOnce sync.Once
}

func (s *drainingEndpointStream) Close() error {
	if s == nil {
		return nil
	}
	var err error
	s.closeOnce.Do(func() {
		err = s.Stream.Close()
		if s.done != nil {
			s.done()
		}
	})
	return err
}
