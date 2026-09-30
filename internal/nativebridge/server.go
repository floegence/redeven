package nativebridge

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"

	"github.com/floegence/redeven/internal/stdiobridge"
)

// Server has exactly one application-selected destination and no lifecycle API.
type Server struct {
	Hello     func() Hello
	Authorize func(string) bool
	Dial      func(context.Context) (net.Conn, error)
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	return stdiobridge.Serve(ctx, in, out, http.HandlerFunc(s.serveHTTP))
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.ProtoMajor != 2 {
		http.Error(w, "HTTP/2 required", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodGet && r.Host == BridgeAuthority && r.URL.Path == HelloPath && r.URL.RawQuery == "" {
		w.Header().Set("Content-Type", "application/json")
		hello := s.Hello()
		hello.ProtocolVersion = ProtocolVersion
		_ = json.NewEncoder(w).Encode(hello)
		return
	}
	if r.Method != http.MethodConnect || r.Host != RuntimeAuthority || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	if !s.Authorize(r.Header.Get(TokenHeader)) {
		http.Error(w, "native authorization expired", http.StatusUnauthorized)
		return
	}
	conn, err := s.Dial(r.Context())
	if err != nil {
		http.Error(w, "Runtime endpoint unavailable", http.StatusBadGateway)
		return
	}
	stdiobridge.Tunnel(w, r, conn)
}
