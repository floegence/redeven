package localui

import (
	"context"
	"net/http"
	"net/url"

	"github.com/floegence/redeven/internal/gatewaymembership"
)

type gatewayMemberOriginKey struct{}

// StartGatewayOnly serves the same public application over member-initiated
// streams without opening public or trusted Desktop TCP listeners.
func (s *Server) StartGatewayOnly(ctx context.Context) error {
	if err := s.configureAcceptor(); err != nil {
		return err
	}
	control, err := newRuntimeControlServer(s.a, s.appServer, s.log, nil)
	if err != nil {
		return err
	}
	s.runtimeControl = control
	if err := s.startRuntimeStatusServer(ctx); err != nil {
		_ = s.Close()
		return err
	}
	if err := s.a.StartGatewayMembership(ctx, s.gatewayMemberApplication); err != nil {
		_ = s.Close()
		return err
	}
	go s.sweepLoop(ctx)
	go func() { <-ctx.Done(); _ = s.Close() }()
	return nil
}

func gatewayMemberOrigin(r *http.Request) string {
	if r == nil {
		return ""
	}
	origin, _ := r.Context().Value(gatewayMemberOriginKey{}).(string)
	return origin
}

// gatewayMemberApplication is the public access chain on the fixed logical
// Runtime origin. It never marks requests as trusted Desktop management traffic.
func (s *Server) gatewayMemberApplication(origin string) gatewaymembership.RuntimeApplication {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "https" {
		return gatewaymembership.RuntimeApplication{Handler: http.NotFoundHandler()}
	}
	application := s.handler()
	bindOrigin := func(r *http.Request) bool {
		if r == nil || r.TLS == nil || r.Host != parsed.Host {
			return false
		}
		*r = *r.WithContext(context.WithValue(r.Context(), gatewayMemberOriginKey{}, origin))
		return true
	}
	return gatewaymembership.RuntimeApplication{
		WebSocketHandler: s.acceptor.Handler(),
		AuthorizeWebSocketRequest: func(r *http.Request) bool {
			return bindOrigin(r) && s.authorizePublicWebSocketRequest(r)
		},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !bindOrigin(r) {
				http.Error(w, "Invalid member authority", http.StatusMisdirectedRequest)
				return
			}
			if !strictSameOriginWSRequest(r, r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions) {
				http.Error(w, "Invalid member origin", http.StatusForbidden)
				return
			}
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, localUIBodyLimit)
			}
			application.ServeHTTP(w, r)
		})}
}
