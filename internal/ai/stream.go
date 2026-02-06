package ai

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

type ndjsonStream struct {
	mu sync.Mutex

	rw      http.ResponseWriter
	w       io.Writer
	f       http.Flusher
	ctrl    *http.ResponseController
	writeTO time.Duration

	ch     chan []byte
	closed bool
}

func newNDJSONStream(w http.ResponseWriter, writeTimeout time.Duration) *ndjsonStream {
	var f http.Flusher
	if w != nil {
		if fl, ok := w.(http.Flusher); ok {
			f = fl
		}
	}
	s := &ndjsonStream{
		rw:      w,
		w:       w,
		f:       f,
		writeTO: writeTimeout,
	}
	if w != nil {
		s.ctrl = http.NewResponseController(w)
		s.ch = make(chan []byte, 256)
		go s.writerLoop()
	}
	return s
}

func (s *ndjsonStream) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	ch := s.ch
	s.ch = nil
	if ch != nil {
		close(ch)
	}
	s.mu.Unlock()
}

func (s *ndjsonStream) writerLoop() {
	if s == nil {
		return
	}
	for frame := range s.ch {
		if s.writeTO > 0 && s.ctrl != nil {
			_ = s.ctrl.SetWriteDeadline(time.Now().Add(s.writeTO))
		}
		if _, err := s.w.Write(frame); err != nil {
			s.close()
			return
		}
		if s.f != nil {
			s.f.Flush()
		}
	}
}

func (s *ndjsonStream) send(v any) error {
	if s == nil || s.w == nil {
		return errors.New("stream not ready")
	}

	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b = append(b, '\n')

	s.mu.Lock()
	defer s.mu.Unlock()

	ch := s.ch
	if s.closed || ch == nil {
		return errors.New("stream closed")
	}

	select {
	case ch <- b:
		return nil
	default:
		// Avoid blocking the run on a slow/disconnected client. Treat as terminal.
		s.closed = true
		s.ch = nil
		close(ch)
		return errors.New("stream backpressure")
	}
}
