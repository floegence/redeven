package ai

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
)

type ndjsonStream struct {
	mu sync.Mutex
	w  io.Writer
	f  http.Flusher
}

func newNDJSONStream(w http.ResponseWriter) *ndjsonStream {
	var f http.Flusher
	if w != nil {
		if fl, ok := w.(http.Flusher); ok {
			f = fl
		}
	}
	return &ndjsonStream{w: w, f: f}
}

func (s *ndjsonStream) send(v any) error {
	if s == nil || s.w == nil {
		return errors.New("stream not ready")
	}

	b, err := json.Marshal(v)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.w.Write(b); err != nil {
		return err
	}
	if _, err := s.w.Write([]byte{'\n'}); err != nil {
		return err
	}
	if s.f != nil {
		s.f.Flush()
	}
	return nil
}
