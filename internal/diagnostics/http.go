package diagnostics

import (
	"bufio"
	"io"
	"net"
	"net/http"
)

type StatusWriter struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
}

func NewStatusWriter(w http.ResponseWriter) *StatusWriter {
	return &StatusWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}
}

func (w *StatusWriter) WriteHeader(statusCode int) {
	if w == nil || w.ResponseWriter == nil {
		return
	}
	if w.wroteHeader {
		return
	}
	w.statusCode = statusCode
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *StatusWriter) Write(body []byte) (int, error) {
	if w == nil || w.ResponseWriter == nil {
		return 0, http.ErrHandlerTimeout
	}
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *StatusWriter) ReadFrom(r io.Reader) (int64, error) {
	if w == nil || w.ResponseWriter == nil {
		return 0, http.ErrHandlerTimeout
	}
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if rf, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(r)
	}
	return io.Copy(w.ResponseWriter, r)
}

func (w *StatusWriter) StatusCode() int {
	if w == nil {
		return http.StatusOK
	}
	return w.statusCode
}

func (w *StatusWriter) Flush() {
	if w == nil || w.ResponseWriter == nil {
		return
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *StatusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if w == nil || w.ResponseWriter == nil {
		return nil, nil, http.ErrNotSupported
	}
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *StatusWriter) Push(target string, opts *http.PushOptions) error {
	if w == nil || w.ResponseWriter == nil {
		return http.ErrNotSupported
	}
	pusher, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return pusher.Push(target, opts)
}

func (w *StatusWriter) Unwrap() http.ResponseWriter {
	if w == nil {
		return nil
	}
	return w.ResponseWriter
}
