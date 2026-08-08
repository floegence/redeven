package agent

import (
	"context"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

// drainingEndpointSession accounts a stream before Flowersec dispatches its
// handler. This closes the ServeSession return-to-handler-start race without
// changing the released Flowersec dependency.
type drainingEndpointSession struct {
	flowersec.Session
	streams sync.WaitGroup
}

func (s *drainingEndpointSession) AcceptStream(ctx context.Context) (flowersec.IncomingStream, error) {
	incoming, err := s.Session.AcceptStream(ctx)
	if err != nil {
		return incoming, err
	}
	s.streams.Add(1)
	incoming.Stream = &drainingEndpointStream{ByteStream: incoming.Stream, done: s.streams.Done}
	return incoming, nil
}

func (s *drainingEndpointSession) Wait() {
	if s != nil {
		s.streams.Wait()
	}
}

type drainingEndpointStream struct {
	flowersec.ByteStream
	done      func()
	closeOnce sync.Once
}

func (s *drainingEndpointStream) Close() error {
	if s == nil {
		return nil
	}
	var err error
	s.closeOnce.Do(func() {
		err = s.ByteStream.Close()
		if s.done != nil {
			s.done()
		}
	})
	return err
}
