package gatewaymembership

import (
	"context"
	"crypto/tls"
	"net/http"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Listener mounts the common member control endpoint and the Flowersec
// acceptor. Egress, when configured, shares this TLS listener and member store.
type Listener struct {
	store          *Store
	connections    *Connections
	mu             sync.Mutex
	admissions     map[string]Admission
	acceptor       *flowersec.Acceptor
	desktopAllowed func(string) bool
	clients        map[string]map[string]context.CancelFunc
}

func NewListener(store *Store, connections *Connections, desktopAllowed func(string) bool) (*Listener, error) {
	l := &Listener{store: store, connections: connections, admissions: make(map[string]Admission), desktopAllowed: desktopAllowed, clients: map[string]map[string]context.CancelFunc{}}
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{
		CheckOrigin:       func(request *http.Request) bool { return originAllowed(store, request) },
		MaxInboundStreams: gp.MaxMemberConnections,
		MaxDirectSessions: gp.MaxGatewayConnections * 2,
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			response, admission, err := store.ConsumeAdmission(request, desktopAllowed)
			if err != nil {
				return controlplane.RejectRuntime("permission_denied", false)
			}
			l.mu.Lock()
			l.admissions[admission.ChannelID] = admission
			l.mu.Unlock()
			return response, nil
		},
		Release:   func(_ context.Context, channelID string) { l.mu.Lock(); delete(l.admissions, channelID); l.mu.Unlock() },
		OnSession: l.serveSession,
	})
	if err != nil {
		return nil, err
	}
	l.acceptor = acceptor
	return l, nil
}

func originAllowed(store *Store, request *http.Request) bool {
	if store == nil || request == nil {
		return false
	}
	origin := request.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range store.EndpointOrigins() {
		if origin == allowed {
			return true
		}
	}
	return false
}

func (l *Listener) Server(tlsConfig *tls.Config, egress http.Handler) (*flowersec.WebSocketHTTPServer, error) {
	return flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{
		Handler: l.acceptor.Handler(), ApplicationHandler: l.applicationHandler(egress),
		TLSConfig: tlsConfig, ReadHeaderTimeout: 10 * time.Second,
	})
}

func (l *Listener) applicationHandler(egress http.Handler) http.Handler {
	mux := http.NewServeMux()
	l.store.RegisterMemberHandlers(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect || r.URL.Path == "/v5/member/cloud" || r.URL.Path == "/v5/member/cloud-closure" {
			if egress == nil {
				http.Error(w, "CLOUD_NOT_CONFIGURED", http.StatusForbidden)
				return
			}
			egress.ServeHTTP(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (l *Listener) serveSession(ctx context.Context, session flowersec.Session, channelID string) error {
	l.mu.Lock()
	admission, ok := l.admissions[channelID]
	l.mu.Unlock()
	if !ok {
		return ErrDenied
	}
	if admission.DesktopKeyID == "" {
		if err := l.store.recordEndpointUse(admission); err != nil {
			return err
		}
		return l.connections.ServeMember(ctx, admission, session)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	l.mu.Lock()
	if l.desktopAllowed == nil || !l.desktopAllowed(admission.DesktopKeyID) {
		l.mu.Unlock()
		return ErrDenied
	}
	if l.clients[admission.DesktopKeyID] == nil {
		l.clients[admission.DesktopKeyID] = map[string]context.CancelFunc{}
	}
	l.clients[admission.DesktopKeyID][channelID] = cancel
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		delete(l.clients[admission.DesktopKeyID], channelID)
		if len(l.clients[admission.DesktopKeyID]) == 0 {
			delete(l.clients, admission.DesktopKeyID)
		}
		l.mu.Unlock()
	}()
	stop := context.AfterFunc(ctx, func() { _ = session.Close() })
	defer stop()
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{MaxConcurrentStreams: gp.MaxMemberConnections})
	if err != nil {
		return err
	}
	if err := handlers.HandleStream(gp.MemberAccessStream, func(ctx context.Context, incoming flowersec.IncomingStream) error {
		if len(incoming.Metadata.Values()) != 0 {
			return ErrDenied
		}
		upstream, reservation, cancel, err := l.connections.OpenReverse(ctx, admission.MemberID, admission.MemberVersion)
		if err != nil {
			return err
		}
		defer cancel()
		defer reservation.Release()
		left, err := flowersec.NewByteStreamConn(ctx, incoming.Stream)
		if err != nil {
			_ = upstream.Close()
			return err
		}
		defer left.Close()
		right, err := flowersec.NewByteStreamConn(ctx, upstream)
		if err != nil {
			_ = upstream.Close()
			return err
		}
		defer right.Close()
		return flowersec.RelayStreams(ctx, left, right)
	}); err != nil {
		return err
	}
	return handlers.Serve(ctx, session)
}

func (l *Listener) RevokeClient(clientKeyID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, cancel := range l.clients[clientKeyID] {
		cancel()
	}
}
