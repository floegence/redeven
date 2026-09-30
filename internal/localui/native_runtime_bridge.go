package localui

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/nativebridge"
)

type nativeRuntimeRequestKey struct{}

type nativeRuntimeBridge struct {
	mu                             sync.Mutex
	id, authority, endpoint, token string
	expires                        time.Time
	closed                         bool
	access                         map[string]string
}

func nativeRuntimeRequest(r *http.Request) *nativeRuntimeBridge {
	if r == nil {
		return nil
	}
	bridge, _ := r.Context().Value(nativeRuntimeRequestKey{}).(*nativeRuntimeBridge)
	return bridge
}

func (b *nativeRuntimeBridge) authorize(token string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.closed && time.Now().Before(b.expires) && len(token) == len(b.token) && subtle.ConstantTimeCompare([]byte(token), []byte(b.token)) == 1
}

func (b *nativeRuntimeBridge) bindAccess(owner string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if id, ok := b.access[owner]; ok {
		return id
	}
	digest := sha256.Sum256([]byte(owner))
	id := "native:" + b.id + ":" + base64.RawURLEncoding.EncodeToString(digest[:])
	b.access[owner] = id
	return id
}

func (b *nativeRuntimeBridge) register(_ string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.closed
}

func (s *Server) closeNativeRuntimeBridges() {
	s.nativeBridges.Range(func(_, value any) bool { value.(context.CancelFunc)(); return true })
}

func (s *Server) nativeAccessOwner(identity string) (string, bool) {
	var owner string
	found := false
	s.nativeBridges.Range(func(key, _ any) bool {
		bridge := key.(*nativeRuntimeBridge)
		bridge.mu.Lock()
		defer bridge.mu.Unlock()
		if !bridge.closed {
			for candidate, bound := range bridge.access {
				if bound == identity {
					owner, found = candidate, true
					return false
				}
			}
		}
		return true
	})
	return owner, found
}

func (s *Server) closeNativeRuntimeAccess(owner string) {
	if strings.HasPrefix(owner, "native:") {
		return
	}
	s.nativeBridges.Range(func(key, value any) bool {
		bridge := key.(*nativeRuntimeBridge)
		bridge.mu.Lock()
		_, found := bridge.access[owner]
		bridge.mu.Unlock()
		if found {
			value.(context.CancelFunc)()
		}
		return true
	})
}

// Only the owner-only management socket mounts this handler. The native bridge
// has independent admission and never acquires trusted Desktop management rights.
func (s *Server) handleNativeRuntimeBridge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.ContentLength != 0 || r.Header.Get("Upgrade") != nativebridge.ProtocolVersion || !strings.EqualFold(r.Header.Get("Connection"), "Upgrade") {
		http.Error(w, "invalid native bridge request", http.StatusBadRequest)
		return
	}
	if s.nativeBridgeCount.Add(1) > 32 {
		s.nativeBridgeCount.Add(-1)
		http.Error(w, "native bridge capacity reached", http.StatusServiceUnavailable)
		return
	}
	defer s.nativeBridgeCount.Add(-1)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		http.Error(w, "native endpoint unavailable", http.StatusServiceUnavailable)
		return
	}
	defer listener.Close()
	token, err := randomB64u(32)
	if err != nil {
		http.Error(w, "native authorization unavailable", http.StatusServiceUnavailable)
		return
	}
	id, err := randomB64u(24)
	if err != nil {
		http.Error(w, "native identity unavailable", http.StatusServiceUnavailable)
		return
	}
	bridge := &nativeRuntimeBridge{id: id, authority: listener.Addr().String(), token: token, access: make(map[string]string)}
	bridge.endpoint = "ws://" + bridge.authority + flowersec.WebSocketDirectPath
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	s.pendingMu.Lock()
	s.directMu.Lock()
	closing := s.directClosing
	if !closing {
		s.nativeBridges.Store(bridge, context.CancelFunc(cancel))
	}
	s.directMu.Unlock()
	s.pendingMu.Unlock()
	if closing {
		http.Error(w, "Runtime is stopping", http.StatusServiceUnavailable)
		return
	}
	defer func() {
		bridge.mu.Lock()
		bridge.closed = true
		access := make([]string, 0, len(bridge.access))
		for _, identity := range bridge.access {
			access = append(access, identity)
		}
		bridge.mu.Unlock()
		for _, identity := range access {
			s.closePluginAccessSession(identity)
		}
		s.nativeBridges.Delete(bridge)
	}()
	direct, err := s.acceptor.HTTPDirectHandler(flowersec.HTTPDirectHandlerOptions{
		AuthorizeRequest: func(request *http.Request) bool {
			return request.Host == bridge.authority && strictSameOriginWSRequest(request, true)
		},
	})
	if err != nil {
		http.Error(w, "native protocol unavailable", http.StatusServiceUnavailable)
		return
	}
	server, err := flowersec.NewHTTPDirectServer(flowersec.HTTPDirectServerOptions{
		Handler: direct, ApplicationHandler: s.nativeRuntimeHandler(bridge),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 2 * time.Minute,
		WriteTimeout: 30 * time.Minute, IdleTimeout: 2 * time.Minute,
	})
	if err != nil {
		http.Error(w, "native protocol unavailable", http.StatusServiceUnavailable)
		return
	}
	defer func() {
		shutdown, done := context.WithTimeout(context.Background(), 2*time.Second)
		defer done()
		_ = server.Shutdown(shutdown)
	}()
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
			cancel()
		}
	}()
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "native transport unavailable", http.StatusInternalServerError)
		return
	}
	conn, buffered, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(buffered, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: %s\r\n\r\n", nativebridge.ProtocolVersion); err != nil {
		return
	}
	if err := buffered.Flush(); err != nil {
		return
	}
	transport := nativebridge.Server{
		Hello: func() nativebridge.Hello {
			bridge.mu.Lock()
			defer bridge.mu.Unlock()
			bridge.expires = time.Now().Add(5 * time.Minute)
			return nativebridge.Hello{Identity: s.RuntimeAttachStatus().Identity, Endpoint: bridge.endpoint, ChannelToken: bridge.token, ExpiresAtUnixMS: bridge.expires.UnixMilli()}
		},
		Authorize: bridge.authorize,
		Dial: func(ctx context.Context) (net.Conn, error) {
			dialer := net.Dialer{Timeout: 10 * time.Second}
			return dialer.DialContext(ctx, "tcp4", bridge.authority)
		},
	}
	// Use the hijacked reader so bytes received with the upgrade are not lost.
	_ = transport.Serve(ctx, &nativeBufferedConn{Conn: conn, reader: buffered.Reader}, conn)
}

type nativeBufferedConn struct {
	net.Conn
	reader interface{ Read([]byte) (int, error) }
}

func (c *nativeBufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

func (s *Server) nativeRuntimeHandler(bridge *nativeRuntimeBridge) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/local/runtime/health", s.handleRuntimeHealth)
	mux.HandleFunc("/api/local/runtime", s.handleRuntime)
	mux.HandleFunc("/api/local/environment", s.handleEnvironment)
	mux.HandleFunc("/api/local/access/status", s.handleAccessStatus)
	mux.HandleFunc("/api/local/access/unlock", s.handleAccessUnlock)
	mux.HandleFunc("/api/local/access/logout", s.handleAccessLogout)
	mux.HandleFunc("/api/local/direct/connect_artifact", s.handleConnectArtifact)
	mux.HandleFunc("/api/local/direct/artifact/spend", s.handleArtifactSpend)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Host != bridge.authority || !bridge.authorize(r.Header.Get(nativebridge.TokenHeader)) {
			http.Error(w, "native authorization required", http.StatusUnauthorized)
			return
		}
		if r.Header.Get(localDesktopBridgeTokenHeader) != "" {
			http.Error(w, "invalid native authorization", http.StatusBadRequest)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+bridge.authority {
			http.Error(w, "invalid native origin", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nativeRuntimeRequestKey{}, bridge)))
	})
}
