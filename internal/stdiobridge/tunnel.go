package stdiobridge

import (
	"io"
	"net"
	"net/http"
)

// Tunnel carries bytes for one already-authorized, fixed destination.
func Tunnel(w http.ResponseWriter, r *http.Request, conn net.Conn) {
	defer conn.Close()
	w.WriteHeader(http.StatusOK)
	flushResponse(w)
	streamDone := make(chan struct{})
	defer close(streamDone)
	go func() {
		select {
		case <-r.Context().Done():
			_ = conn.Close()
		case <-streamDone:
		}
	}()

	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		_, _ = io.Copy(conn, r.Body)
		if closer, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = closer.CloseWrite()
		}
	}()
	_, _ = io.Copy(flushingWriter{writer: w}, conn)
	_ = conn.Close()
	_ = r.Body.Close()
	<-requestDone
}

func flushResponse(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

type flushingWriter struct{ writer http.ResponseWriter }

func (w flushingWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	flushResponse(w.writer)
	return n, err
}
