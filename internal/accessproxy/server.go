package accessproxy

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/session"
)

type Options struct {
	Logger   *slog.Logger
	Gate     *accessgate.Gate
	Meta     session.Meta
	Upstream string
}

type Server struct {
	log      *slog.Logger
	gate     *accessgate.Gate
	meta     session.Meta
	upstream *url.URL
	proxy    *httputil.ReverseProxy

	ln  net.Listener
	srv *http.Server
}

type apiResp struct {
	OK    bool      `json:"ok"`
	Error *apiError `json:"error,omitempty"`
	Data  any       `json:"data,omitempty"`
}

type apiError struct {
	Message string `json:"message"`
}

type unlockReq struct {
	Password string `json:"password"`
}

func New(opts Options) (*Server, error) {
	upstreamStr := strings.TrimSpace(opts.Upstream)
	if upstreamStr == "" {
		return nil, errors.New("missing upstream")
	}
	upstreamURL, err := url.Parse(upstreamStr)
	if err != nil || upstreamURL == nil || strings.TrimSpace(upstreamURL.Scheme) == "" || strings.TrimSpace(upstreamURL.Host) == "" {
		return nil, errors.New("invalid upstream")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstreamURL)
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	return &Server{log: logger, gate: opts.Gate, meta: opts.Meta, upstream: upstreamURL, proxy: proxy}, nil
}

func (s *Server) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if s.srv != nil {
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s.ln = ln
	s.srv = &http.Server{Handler: http.HandlerFunc(s.serveHTTP), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()
	go func() {
		if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Warn("access proxy stopped", "channel_id", strings.TrimSpace(s.meta.ChannelID), "error", err)
		}
	}()
	return nil
}

func (s *Server) Close() error {
	if s == nil {
		return nil
	}
	if s.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(ctx)
	}
	if s.ln != nil {
		_ = s.ln.Close()
	}
	s.srv = nil
	s.ln = nil
	return nil
}

func (s *Server) URL() string {
	if s == nil || s.ln == nil {
		return ""
	}
	return "http://" + s.ln.Addr().String()
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if s == nil || r == nil {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/_redeven_proxy/api/access/") {
		s.handleAccessAPI(w, r)
		return
	}
	if s.gate != nil && s.gate.Enabled() && !s.gate.IsChannelUnlocked(strings.TrimSpace(s.meta.ChannelID)) {
		http.Error(w, "access password required", http.StatusLocked)
		return
	}
	s.proxy.ServeHTTP(w, r)
}

func (s *Server) handleAccessAPI(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimSpace(r.URL.Path) {
	case "/_redeven_proxy/api/access/status":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: &apiError{Message: "method not allowed"}})
			return
		}
		status := accessgate.Status{PasswordRequired: false, Unlocked: true}
		if s.gate != nil {
			status = s.gate.Status(strings.TrimSpace(s.meta.ChannelID))
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return
	case "/_redeven_proxy/api/access/unlock":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: &apiError{Message: "method not allowed"}})
			return
		}
		var req unlockReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
			return
		}
		res, err := s.gate.UnlockChannel(strings.TrimSpace(s.meta.ChannelID), req.Password)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, apiResp{OK: false, Error: &apiError{Message: err.Error()}})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: res})
		return
	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: &apiError{Message: "not found"}})
		return
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
