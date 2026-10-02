package gatewayservice

import (
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	gatewayenvprofiles "github.com/floegence/redeven/internal/runtimegateway/envprofiles"
	"github.com/gorilla/websocket"
)

func (s *Server) openProfileSession(profile gatewayenvprofiles.EnvironmentProfile, r *http.Request) (*profileSession, error) {
	id, err := randomB64u(24)
	if err != nil {
		return nil, err
	}
	token, err := randomB64u(32)
	if err != nil {
		return nil, err
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	session := &profileSession{
		ID: "gws_" + id, ClientKeyID: strings.TrimSpace(r.Header.Get("X-Redeven-Client-Key-ID")),
		GatewayID:    strings.TrimSpace(r.Header.Get("X-Redeven-Gateway-ID")),
		GatewayEnvID: profile.GatewayEnvID, TargetBaseURL: profile.AccessRoute.URL,
		AccessToken: token, EntryURL: strings.TrimRight(bindingAudience(r), "/") + "/gateway/v3/access/" + token + "/",
		ExpiresAtUnixMS: time.Now().Add(gatewayConnectArtifactTTL).UnixMilli(),
		CookieJar:       jar, Context: ctx, Cancel: cancel,
	}
	if s.isManagedDesktopBridgeRequest(r) {
		session.EntryURL = "/gateway/v3/access/" + token + "/"
	}
	return session, nil
}

func (s *Server) handleProfileAccess(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.EscapedPath(), "/gateway/v3/access/")
	token, targetPath, ok := strings.Cut(path, "/")
	if !ok || token == "" {
		http.Error(w, "Gateway session required", http.StatusUnauthorized)
		return
	}
	current := s.profileSessionByToken(token)
	if current == nil || current.Context.Err() != nil {
		w.Header().Set("X-Redeven-Gateway-Error", "SESSION_EXPIRED")
		http.Error(w, "Gateway session expired", http.StatusUnauthorized)
		return
	}
	if targetPath == "_tunnel" {
		s.serveTargetTunnel(w, r, current)
		return
	}
	s.serveProfileHTTP(w, r, current, "/"+targetPath)
}

func (s *Server) profileSessionByToken(token string) *profileSession {
	clean := strings.TrimSpace(token)
	if clean == "" {
		return nil
	}
	s.profileSessionsMu.Lock()
	defer s.profileSessionsMu.Unlock()
	for _, candidate := range s.profileSessions {
		if candidate != nil && subtle.ConstantTimeCompare([]byte(candidate.AccessToken), []byte(clean)) == 1 && time.Now().UnixMilli() < candidate.ExpiresAtUnixMS {
			return candidate
		}
	}
	return nil
}

// Desktop tunnels bytes without rewriting Runtime artifacts, origins or TLS.
// The destination is always the stored profile, never a client-supplied address.
func (s *Server) serveTargetTunnel(w http.ResponseWriter, r *http.Request, session *profileSession) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target, err := url.Parse(session.TargetBaseURL)
	if err != nil {
		http.Error(w, "Target unavailable", http.StatusBadGateway)
		return
	}
	port := target.Port()
	if port == "" {
		if target.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	transport, ok := s.proxyTransport.(*http.Transport)
	if !ok {
		http.Error(w, "Target unavailable", http.StatusBadGateway)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(session.Context, cancel)
	defer stop()
	upstream, err := transport.DialContext(ctx, "tcp", net.JoinHostPort(target.Hostname(), port))
	if err != nil {
		auditTargetUnavailable(session)
		w.Header().Set("X-Redeven-Gateway-Error", "TARGET_UNAVAILABLE")
		http.Error(w, "Target unavailable", http.StatusBadGateway)
		return
	}
	defer upstream.Close()
	upgrader := websocket.Upgrader{
		ReadBufferSize: 32 << 10, WriteBufferSize: 32 << 10,
		CheckOrigin: func(req *http.Request) bool {
			origin := req.Header.Get("Origin")
			return origin == "" || origin == requestOrigin(req)
		},
	}
	client, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	// NextReader streams into a bounded io.Copy buffer. HTTP request size must
	// not depend on how the Desktop divides its bytes into WebSocket messages.
	closeOnCancel := context.AfterFunc(ctx, func() {
		code := websocket.CloseNormalClosure
		if session.Context.Err() != nil {
			code = 4001
		}
		_ = client.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, ""), time.Now().Add(time.Second))
		_ = client.Close()
		_ = upstream.Close()
	})
	defer closeOnCancel()
	done := make(chan error, 1)
	go func() {
		defer cancel()
		buffer := make([]byte, 32<<10)
		for {
			n, readErr := upstream.Read(buffer)
			if n > 0 {
				if writeErr := client.WriteMessage(websocket.BinaryMessage, buffer[:n]); writeErr != nil {
					done <- writeErr
					return
				}
			}
			if readErr != nil {
				done <- readErr
				return
			}
		}
	}()
	for {
		kind, reader, readErr := client.NextReader()
		if readErr != nil {
			break
		}
		if kind != websocket.BinaryMessage {
			break
		}
		if _, err := io.Copy(upstream, reader); err != nil {
			break
		}
	}
	cancel()
	_ = client.Close()
	_ = upstream.Close()
	<-done
}

func (s *Server) serveProfileHTTP(w http.ResponseWriter, r *http.Request, session *profileSession, targetPath string) {
	decodedPath, err := url.PathUnescape(targetPath)
	if err != nil {
		http.Error(w, "Invalid target path", http.StatusBadRequest)
		return
	}
	target, err := url.Parse(session.TargetBaseURL)
	if err != nil {
		http.Error(w, "Target unavailable", http.StatusBadGateway)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(session.Context, cancel)
	defer stop()
	proxy := &httputil.ReverseProxy{
		Transport: s.proxyTransport, FlushInterval: -1,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
			pr.Out.URL.Path = decodedPath
			pr.Out.URL.RawPath = targetPath
			pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			for name := range pr.Out.Header {
				lower := strings.ToLower(name)
				if lower == "cookie" || lower == "proxy-authorization" || lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") ||
					strings.HasPrefix(lower, "x-redeven-gateway-") || strings.HasPrefix(lower, "x-redeven-client-") ||
					strings.HasPrefix(lower, "x-redeven-request-") || lower == "x-redeven-desktop-bridge-token" {
					pr.Out.Header.Del(name)
				}
			}
			if pr.In.Header.Get("Origin") != "" {
				pr.Out.Header.Set("Origin", targetOrigin(target))
			}
			if pr.In.Header.Get("Referer") != "" {
				pr.Out.Header.Set("Referer", targetOrigin(target))
			}
			for _, cookie := range session.CookieJar.Cookies(pr.Out.URL) {
				pr.Out.AddCookie(cookie)
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			session.CookieJar.SetCookies(resp.Request.URL, resp.Cookies())
			resp.Header.Del("Set-Cookie")
			if location := resp.Header.Get("Location"); location != "" {
				parsed, err := url.Parse(location)
				if err != nil {
					return errors.New("invalid target redirect")
				}
				resolved := resp.Request.URL.ResolveReference(parsed)
				if resolved.Scheme != target.Scheme || resolved.Host != target.Host || resolved.User != nil {
					return errors.New("target redirect leaves this environment")
				}
				location = session.EntryURL + strings.TrimPrefix(resolved.RequestURI(), "/")
				if resolved.Fragment != "" {
					location += "#" + resolved.EscapedFragment()
				}
				resp.Header.Set("Location", location)
			}
			resp.Header.Set("Cache-Control", "no-store")
			resp.Header.Set("Referrer-Policy", "no-referrer")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			auditTargetUnavailable(session)
			w.Header().Set("X-Redeven-Gateway-Error", "TARGET_UNAVAILABLE")
			http.Error(w, "Target unavailable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

func auditTargetUnavailable(session *profileSession) {
	slog.Info("gateway.proxy.target_unreachable", "gateway_id", session.GatewayID,
		"environment_id", session.GatewayEnvID, "session_id", session.ID, "access_mode", "gateway_proxy")
}
