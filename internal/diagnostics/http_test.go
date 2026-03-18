package diagnostics

import (
	"bufio"
	"bytes"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type testResponseWriter struct {
	header           http.Header
	body             bytes.Buffer
	statusCode       int
	writeHeaderCalls int
	flushed          bool
	hijacked         bool
	pushedTarget     string
}

func (w *testResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *testResponseWriter) WriteHeader(statusCode int) {
	w.writeHeaderCalls++
	if w.statusCode == 0 {
		w.statusCode = statusCode
	}
}

func (w *testResponseWriter) Write(body []byte) (int, error) {
	if w.statusCode == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(body)
}

func (w *testResponseWriter) Flush() {
	w.flushed = true
}

func (w *testResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.hijacked = true
	return nil, bufio.NewReadWriter(bufio.NewReader(strings.NewReader("")), bufio.NewWriter(io.Discard)), nil
}

func (w *testResponseWriter) Push(target string, _ *http.PushOptions) error {
	w.pushedTarget = target
	return nil
}

func TestStatusWriterTracksStatusAndForwardsOptionalInterfaces(t *testing.T) {
	t.Parallel()

	raw := &testResponseWriter{}
	wrapped := NewStatusWriter(raw)

	if _, err := wrapped.Write([]byte("ok")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if wrapped.StatusCode() != http.StatusOK {
		t.Fatalf("StatusCode() = %d, want %d", wrapped.StatusCode(), http.StatusOK)
	}
	if raw.statusCode != http.StatusOK {
		t.Fatalf("raw.statusCode = %d, want %d", raw.statusCode, http.StatusOK)
	}

	wrapped.Flush()
	if !raw.flushed {
		t.Fatalf("expected Flush() to reach the wrapped writer")
	}

	if _, _, err := wrapped.Hijack(); err != nil {
		t.Fatalf("Hijack() error = %v", err)
	}
	if !raw.hijacked {
		t.Fatalf("expected Hijack() to reach the wrapped writer")
	}

	if err := wrapped.Push("/next", nil); err != nil {
		t.Fatalf("Push() error = %v", err)
	}
	if raw.pushedTarget != "/next" {
		t.Fatalf("raw.pushedTarget = %q, want %q", raw.pushedTarget, "/next")
	}
}

func TestStatusWriterIgnoresDuplicateWriteHeader(t *testing.T) {
	t.Parallel()

	raw := &testResponseWriter{}
	wrapped := NewStatusWriter(raw)

	wrapped.WriteHeader(http.StatusCreated)
	wrapped.WriteHeader(http.StatusAccepted)

	if wrapped.StatusCode() != http.StatusCreated {
		t.Fatalf("StatusCode() = %d, want %d", wrapped.StatusCode(), http.StatusCreated)
	}
	if raw.statusCode != http.StatusCreated {
		t.Fatalf("raw.statusCode = %d, want %d", raw.statusCode, http.StatusCreated)
	}
	if raw.writeHeaderCalls != 1 {
		t.Fatalf("writeHeaderCalls = %d, want 1", raw.writeHeaderCalls)
	}
}
