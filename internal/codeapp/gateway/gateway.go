package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

type Options struct {
	Logger     *slog.Logger
	ListenAddr string
	DistFS     fs.FS
	Backend    Backend
}

type Backend interface {
	ListSpaces(ctx context.Context) ([]SpaceStatus, error)
	CreateSpace(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error)
	UpdateSpace(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error)
	DeleteSpace(ctx context.Context, codeSpaceID string) error
	StartSpace(ctx context.Context, codeSpaceID string) (*SpaceStatus, error)
	StopSpace(ctx context.Context, codeSpaceID string) error
	ResolveCodeServerPort(ctx context.Context, codeSpaceID string) (int, error)
}

type SpaceStatus struct {
	CodeSpaceID        string `json:"code_space_id"`
	WorkspacePath      string `json:"workspace_path"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	CodePort           int    `json:"code_port"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64  `json:"last_opened_at_unix_ms"`

	Running bool `json:"running"`
	PID     int  `json:"pid"`
}

type CreateSpaceRequest struct {
	CodeSpaceID   string `json:"code_space_id"`
	WorkspacePath string `json:"workspace_path"`
	Name          string `json:"name"`
	Description   string `json:"description"`
}

type UpdateSpaceRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type Gateway struct {
	log *slog.Logger

	backend Backend

	distFS fs.FS
	dist   http.Handler

	ln   net.Listener
	srv  *http.Server
	addr string
}

func New(opts Options) (*Gateway, error) {
	if opts.Backend == nil {
		return nil, errors.New("missing Backend")
	}
	if opts.DistFS == nil {
		return nil, errors.New("missing DistFS")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	addr := strings.TrimSpace(opts.ListenAddr)
	if addr == "" {
		addr = "127.0.0.1:0"
	}

	// /_redeven_proxy/* is mapped to dist/*.
	//
	// Note: use the prefix without a trailing slash, so the stripped path keeps a
	// leading "/" (avoids FileServer canonicalization redirects).
	dist := http.StripPrefix("/_redeven_proxy", http.FileServer(http.FS(opts.DistFS)))

	return &Gateway{
		log:     logger,
		backend: opts.Backend,
		distFS:  opts.DistFS,
		dist:    dist,
		addr:    addr,
	}, nil
}

func (g *Gateway) Start(ctx context.Context) error {
	if g == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if g.ln != nil {
		return nil
	}

	ln, err := net.Listen("tcp", g.addr)
	if err != nil {
		return err
	}
	g.ln = ln

	g.srv = &http.Server{
		Handler:           http.HandlerFunc(g.serveHTTP),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		_ = g.Close()
	}()

	go func() {
		if err := g.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			g.log.Warn("codeapp gateway stopped", "error", err)
		}
	}()

	g.log.Info("codeapp gateway listening", "addr", g.ln.Addr().String())
	return nil
}

func (g *Gateway) Close() error {
	if g == nil {
		return nil
	}
	if g.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = g.srv.Shutdown(ctx)
	}
	if g.ln != nil {
		_ = g.ln.Close()
	}
	g.ln = nil
	return nil
}

func (g *Gateway) URL() string {
	if g == nil || g.ln == nil {
		return ""
	}
	return "http://" + g.ln.Addr().String()
}

func (g *Gateway) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	p := r.URL.Path

	originRole := originRoleFromRequest(r)

	// No caching: UI + inject are agent-versioned and delivered over E2EE.
	w.Header().Set("Cache-Control", "no-store")

	if strings.HasPrefix(p, "/_redeven_proxy/api/") {
		// Hardening: only allow management APIs from the Env App origin (env-<env_id>.<region>).
		// Do not expose them to codespace origins (code-server is untrusted).
		if originRole != originRoleEnv {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		g.handleAPI(w, r)
		return
	}
	if strings.HasPrefix(p, "/_redeven_proxy/") {
		// Hardening: keep UI surfaces separated by origin.
		// - env-<env_id>.<region> serves Env App UI only
		// - cs-<id>.<region> serves inject.js only (no Env App UI)
		switch {
		case strings.HasPrefix(p, "/_redeven_proxy/env"):
			if originRole != originRoleEnv {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
		case p == "/_redeven_proxy/inject.js":
			// inject.js must be accessible from codespace origins, but allowing it from
			// other sandbox origins is harmless and can help debugging.
		default:
			// Unknown dist path: do not serve anything else by default.
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		g.dist.ServeHTTP(w, r)
		return
	}

	// Default: proxy to code-server (per-code-space).
	g.handleCodeServerProxy(w, r)
}

type apiResp struct {
	OK    bool        `json:"ok"`
	Error string      `json:"error,omitempty"`
	Data  interface{} `json:"data,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (g *Gateway) handleAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/spaces":
		spaces, err := g.backend.ListSpaces(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"spaces": spaces}})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/spaces":
		var req CreateSpaceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		s, err := g.backend.CreateSpace(r.Context(), req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
		return

	default:
		// /_redeven_proxy/api/spaces/<id>[/action]
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/spaces/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		id := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}

		if r.Method == http.MethodDelete && action == "" {
			if err := g.backend.DeleteSpace(r.Context(), id); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}
		if r.Method == http.MethodPatch && action == "" {
			var req UpdateSpaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if req.Name == nil && req.Description == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			s, err := g.backend.UpdateSpace(r.Context(), id, req)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "start" {
			s, err := g.backend.StartSpace(r.Context(), id)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "stop" {
			if err := g.backend.StopSpace(r.Context(), id); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return
	}
}

func (g *Gateway) handleCodeServerProxy(w http.ResponseWriter, r *http.Request) {
	extScheme, extHost, err := externalOriginFromRequest(r)
	if err != nil {
		http.Error(w, "missing external origin", http.StatusBadRequest)
		return
	}
	codeSpaceID, ok := codeSpaceIDFromExternalHost(extHost)
	if !ok {
		http.Error(w, "not a codespace origin", http.StatusNotFound)
		return
	}

	port, err := g.backend.ResolveCodeServerPort(r.Context(), codeSpaceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)}
	origin := fmt.Sprintf("%s://%s", extScheme, extHost)

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// code-server enforces host == origin.
			pr.Out.Host = extHost
			pr.Out.Header.Set("Origin", origin)
			// Hardening: ensure code-server getHost() is not polluted by forwarded headers.
			// (code-server prefers Forwarded/X-Forwarded-Host over Host)
			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Port")
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r)
}

func externalOriginFromRequest(r *http.Request) (scheme string, host string, err error) {
	if r == nil {
		return "", "", errors.New("nil request")
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return "", "", errors.New("missing origin")
	}
	u, err := url.Parse(origin)
	if err != nil || u == nil {
		return "", "", errors.New("invalid origin")
	}
	scheme = strings.ToLower(strings.TrimSpace(u.Scheme))
	host = strings.ToLower(strings.TrimSpace(u.Host))
	if (scheme != "http" && scheme != "https") || host == "" {
		return "", "", errors.New("invalid origin")
	}
	return scheme, host, nil
}

func codeSpaceIDFromExternalHost(host string) (string, bool) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", false
	}
	// Remove port if present (domain names only).
	hostNoPort := host
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	firstLabel := strings.Split(hostNoPort, ".")[0]
	firstLabel = strings.ToLower(strings.TrimSpace(firstLabel))
	if !strings.HasPrefix(firstLabel, "cs-") {
		return "", false
	}
	id := strings.TrimPrefix(firstLabel, "cs-")
	id = strings.TrimSpace(id)
	if id == "" {
		return "", false
	}
	return id, true
}

type originRole int

const (
	originRoleUnknown originRole = iota
	originRoleEnv
	originRoleCodeSpace
)

func originRoleFromRequest(r *http.Request) originRole {
	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return originRoleUnknown
	}

	hostNoPort := strings.TrimSpace(host)
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	first := strings.ToLower(strings.TrimSpace(strings.Split(hostNoPort, ".")[0]))
	switch {
	case strings.HasPrefix(first, "env-"):
		return originRoleEnv
	case strings.HasPrefix(first, "cs-"):
		return originRoleCodeSpace
	default:
		return originRoleUnknown
	}
}
