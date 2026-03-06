package localui

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
	"github.com/floegence/flowersec/flowersec-go/realtime/ws"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/agent"
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// LocalEnvPublicID is the fixed env_public_id used for Local UI mode.
	LocalEnvPublicID = "env_local"

	localNamespacePublicID = "ns_local"
	localUserPublicID      = "user_local"
	localUserEmail         = "local@redeven"
)

type Options struct {
	Logger *slog.Logger
	Port   int

	// Gateway is the Env App gateway handler mounted under /_redeven_proxy/*.
	Gateway *gateway.Gateway

	// Agent serves direct sessions (RPC/streams) after a successful E2EE handshake.
	Agent *agent.Agent

	// ConfigPath is the absolute path to the agent config file.
	// It is used to compute the local permission cap and to render Settings consistently.
	ConfigPath string

	// Version is the agent build version (used by /api/local/agent/version/latest).
	Version string

	// AccessGate protects the local browser entry when password mode is enabled.
	AccessGate *accessgate.Gate
}

type Server struct {
	log *slog.Logger

	port       int
	configPath string
	version    string

	gw *gateway.Gateway
	a  *agent.Agent

	accessGate     *accessgate.Gate
	allowedOrigins []string

	pendingMu sync.Mutex
	pending   map[string]pendingDirect

	ln4 net.Listener
	ln6 net.Listener
	srv *http.Server
}

type pendingDirect struct {
	psk               [32]byte
	initExpireAtUnixS int64
	meta              session.Meta
}

func AllowedOriginsForPort(port int) []string {
	p := port
	if p <= 0 {
		p = 23998
	}
	return []string{
		fmt.Sprintf("http://localhost:%d", p),
		fmt.Sprintf("http://127.0.0.1:%d", p),
		fmt.Sprintf("http://[::1]:%d", p),
	}
}

func New(opts Options) (*Server, error) {
	if opts.Agent == nil {
		return nil, errors.New("missing Agent")
	}
	if opts.Gateway == nil {
		return nil, errors.New("missing Gateway")
	}
	if strings.TrimSpace(opts.ConfigPath) == "" {
		return nil, errors.New("missing ConfigPath")
	}
	port := opts.Port
	if port == 0 {
		port = 23998
	}
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("invalid Port: %d", port)
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	return &Server{
		log:            logger,
		port:           port,
		configPath:     strings.TrimSpace(opts.ConfigPath),
		version:        strings.TrimSpace(opts.Version),
		gw:             opts.Gateway,
		a:              opts.Agent,
		accessGate:     opts.AccessGate,
		allowedOrigins: AllowedOriginsForPort(port),
		pending:        make(map[string]pendingDirect),
	}, nil
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

	addr4 := net.JoinHostPort("127.0.0.1", fmt.Sprintf("%d", s.port))
	ln4, err := net.Listen("tcp", addr4)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr4, err)
	}
	addr6 := net.JoinHostPort("::1", fmt.Sprintf("%d", s.port))
	ln6, err := net.Listen("tcp", addr6)
	if err != nil {
		_ = ln4.Close()
		return fmt.Errorf("listen %s: %w", addr6, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	// Browsers may request these root-level assets regardless of the actual SPA base path.
	// Keep them available to avoid noisy 404s in Local UI mode.
	mux.HandleFunc("/favicon.ico", s.handleFavicon)
	mux.HandleFunc("/logo.png", s.handleLogo)
	mux.HandleFunc("/api/local/access/status", s.handleAccessStatus)
	mux.HandleFunc("/api/local/access/unlock", s.handleAccessUnlock)
	mux.HandleFunc("/api/local/access/logout", s.handleAccessLogout)
	mux.HandleFunc("/api/local/runtime", s.handleRuntime)
	mux.HandleFunc("/api/local/direct/connect_info", s.handleConnectInfo)
	mux.HandleFunc("/api/local/environment", s.handleEnvironment)
	mux.HandleFunc("/api/local/agent/version/latest", s.handleLatestVersion)
	mux.HandleFunc("/_redeven_direct/ws", s.handleDirectWS)
	// Reuse the existing gateway for Env App UI + management APIs.
	mux.HandleFunc("/_redeven_proxy/", s.handleGateway)

	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.ln4 = ln4
	s.ln6 = ln6

	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()

	go s.sweepLoop(ctx)

	go func() {
		if err := s.srv.Serve(ln4); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Error("local ui server stopped (ipv4)", "error", err)
		}
	}()
	go func() {
		if err := s.srv.Serve(ln6); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Error("local ui server stopped (ipv6)", "error", err)
		}
	}()

	s.log.Info("local ui listening", "port", s.port)
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
	if s.ln4 != nil {
		_ = s.ln4.Close()
	}
	if s.ln6 != nil {
		_ = s.ln6.Close()
	}
	s.srv = nil
	s.ln4 = nil
	s.ln6 = nil
	return nil
}

func (s *Server) Port() int {
	if s == nil {
		return 0
	}
	return s.port
}

type apiResp struct {
	OK    bool      `json:"ok"`
	Error *apiError `json:"error,omitempty"`
	Data  any       `json:"data,omitempty"`
}

type apiError struct {
	Message string `json:"message"`
}

type accessStatusResp struct {
	PasswordRequired bool `json:"password_required"`
	Unlocked         bool `json:"unlocked"`
}

type accessUnlockReq struct {
	Password string `json:"password"`
}

func (s *Server) accessEnabled() bool {
	return s != nil && s.accessGate != nil && s.accessGate.Enabled()
}

func (s *Server) localAccessToken(r *http.Request) string {
	if s == nil || r == nil {
		return ""
	}
	c, err := r.Cookie(accessgate.LocalSessionCookieName)
	if err != nil || c == nil {
		return ""
	}
	return strings.TrimSpace(c.Value)
}

func (s *Server) hasLocalAccess(r *http.Request) bool {
	if !s.accessEnabled() {
		return true
	}
	token := s.localAccessToken(r)
	if token == "" {
		return false
	}
	return s.accessGate.IsLocalSessionValid(token)
}

func (s *Server) setLocalAccessCookie(w http.ResponseWriter, token string, expiresAtUnixMs int64) {
	if w == nil || token == "" {
		return
	}
	expiresAt := time.UnixMilli(expiresAtUnixMs)
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
}

func (s *Server) clearLocalAccessCookie(w http.ResponseWriter) {
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func (s *Server) requireLocalAccessAPI(w http.ResponseWriter, r *http.Request) bool {
	if s.hasLocalAccess(r) {
		return true
	}
	writeJSON(w, http.StatusLocked, apiResp{OK: false, Error: &apiError{Message: "access password required"}})
	return false
}

func (s *Server) requireLocalAccessHTTP(w http.ResponseWriter, r *http.Request) bool {
	if s.hasLocalAccess(r) {
		return true
	}
	http.Error(w, "access password required", http.StatusLocked)
	return false
}

func (s *Server) handleGateway(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessHTTP(w, r) {
		return
	}
	s.gw.ServeHTTP(w, r)
}

func writeHTML(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func localAccessPageHTML() string {
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redeven Access</title>
    <style>
      :root { color-scheme: dark; }
      @media (prefers-color-scheme: light) {
        :root { color-scheme: light; }
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0b0b0b;
        color: #f3f4f6;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 24px;
      }
      @media (prefers-color-scheme: light) {
        body { background: #f8fafc; color: #111827; }
      }
      .card {
        width: min(420px, 100%);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.82);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
        padding: 24px;
      }
      @media (prefers-color-scheme: light) {
        .card { background: rgba(255, 255, 255, 0.94); }
      }
      h1 { margin: 0; font-size: 22px; }
      p { margin: 10px 0 0; color: #cbd5e1; line-height: 1.5; }
      @media (prefers-color-scheme: light) {
        p { color: #475569; }
      }
      form { margin-top: 20px; }
      input {
        width: 100%;
        box-sizing: border-box;
        height: 44px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(15, 23, 42, 0.65);
        color: inherit;
        padding: 0 14px;
        font-size: 14px;
      }
      @media (prefers-color-scheme: light) {
        input { background: #ffffff; }
      }
      button {
        margin-top: 12px;
        width: 100%;
        height: 44px;
        border: 0;
        border-radius: 10px;
        background: #2563eb;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled { opacity: 0.6; cursor: wait; }
      .status { margin-top: 12px; min-height: 20px; font-size: 13px; color: #fca5a5; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Enter access password</h1>
      <p>This browser session is locked by the local agent. Enter the full password to continue.</p>
      <form id="unlock_form">
        <input id="password" type="password" autocomplete="current-password" placeholder="Password" autofocus />
        <button id="submit_button" type="submit">Unlock</button>
      </form>
      <div id="status" class="status"></div>
    </div>
    <script>
      const form = document.getElementById('unlock_form');
      const passwordInput = document.getElementById('password');
      const submitButton = document.getElementById('submit_button');
      const statusNode = document.getElementById('status');

      function setStatus(message) {
        statusNode.textContent = String(message || '');
      }

      async function unlock(password) {
        const resp = await fetch('/api/local/access/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ password }),
        });
        const text = await resp.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {}
        if (!resp.ok || data?.ok === false) {
          const msg = String(data?.error?.message || 'Unlock failed.');
          throw new Error(msg);
        }
        return data?.data || data || {};
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = String(passwordInput.value || '');
        submitButton.disabled = true;
        setStatus('');
        try {
          const out = await unlock(password);
          const token = String(out?.resume_token || '').trim();
          const target = token
            ? '/_redeven_proxy/env/#redeven_access_resume=' + encodeURIComponent(token)
            : '/_redeven_proxy/env/';
          window.location.replace(target);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
          submitButton.disabled = false;
          passwordInput.focus();
          passwordInput.select();
        }
      });
    </script>
  </body>
</html>`
}

func (s *Server) handleAccessStatus(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: accessStatusResp{
		PasswordRequired: s.accessEnabled(),
		Unlocked:         s.hasLocalAccess(r),
	}})
}

func (s *Server) handleAccessUnlock(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.accessEnabled() {
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"unlocked": true}})
		return
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req accessUnlockReq
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	result, err := s.accessGate.MintLocalSession(req.Password)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResp{OK: false, Error: &apiError{Message: err.Error()}})
		return
	}
	s.setLocalAccessCookie(w, result.SessionToken, result.SessionExpiresAtUnix)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
}

func (s *Server) handleAccessLogout(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.accessEnabled() {
		if token := s.localAccessToken(r); token != "" {
			s.accessGate.RevokeLocalSession(token)
		}
	}
	s.clearLocalAccessCookie(w)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"ok": true}})
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.accessEnabled() || s.hasLocalAccess(r) {
		http.Redirect(w, r, "/_redeven_proxy/env/", http.StatusFound)
		return
	}
	writeHTML(w, http.StatusOK, localAccessPageHTML())
}

func (s *Server) handleFavicon(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The Env App ships its own favicon under the embedded gateway base path.
	http.Redirect(w, r, "/_redeven_proxy/env/favicon.svg", http.StatusFound)
}

func (s *Server) handleLogo(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Keep the legacy root-level logo URL working so UI code doesn't need to special-case Local UI mode.
	http.Redirect(w, r, "/_redeven_proxy/env/logo.png", http.StatusFound)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type runtimeResp struct {
	Mode        string `json:"mode"`
	EnvPublicID string `json:"env_public_id"`
	DirectWSURL string `json:"direct_ws_url"`
}

func (s *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	wsURL, _ := s.directWSURLFromRequest(r)
	writeJSON(w, http.StatusOK, runtimeResp{
		Mode:        "local",
		EnvPublicID: LocalEnvPublicID,
		DirectWSURL: wsURL,
	})
}

func (s *Server) directWSURLFromRequest(r *http.Request) (string, error) {
	if r == nil {
		return "", errors.New("nil request")
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return "", errors.New("missing host")
	}
	scheme := "ws"
	if r.TLS != nil {
		scheme = "wss"
	}
	return (&url.URL{Scheme: scheme, Host: host, Path: "/_redeven_direct/ws"}).String(), nil
}

func randomB64u(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid length")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Server) mintPending(meta session.Meta, wsURL string) (*directv1.DirectConnectInfo, error) {
	if s == nil {
		return nil, errors.New("server not ready")
	}
	channelID, err := randomB64u(24)
	if err != nil {
		return nil, err
	}
	var psk [32]byte
	if _, err := rand.Read(psk[:]); err != nil {
		return nil, err
	}

	// Keep the init window reasonably short; the UI can always mint a fresh connect_info.
	initExp := time.Now().Add(10 * time.Minute).Unix()

	meta.ChannelID = channelID

	s.pendingMu.Lock()
	s.pending[channelID] = pendingDirect{
		psk:               psk,
		initExpireAtUnixS: initExp,
		meta:              meta,
	}
	s.pendingMu.Unlock()

	return &directv1.DirectConnectInfo{
		WsUrl:                    strings.TrimSpace(wsURL),
		ChannelId:                channelID,
		E2eePskB64u:              base64.RawURLEncoding.EncodeToString(psk[:]),
		ChannelInitExpireAtUnixS: initExp,
		DefaultSuite:             directv1.Suite_X25519_HKDF_SHA256_AES_256_GCM,
	}, nil
}

func (s *Server) handleConnectInfo(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Only accept empty body to keep the endpoint stable; reject unknown inputs.
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&struct{}{}); err != nil && err != io.EOF {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	wsURL, err := s.directWSURLFromRequest(r)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	cap := s.resolveLocalCap()
	meta := session.Meta{
		ChannelID:         "",
		EndpointID:        LocalEnvPublicID,
		FloeApp:           agent.FloeAppRedevenAgent,
		CodeSpaceID:       "env-ui",
		SessionKind:       "envapp_rpc",
		UserPublicID:      localUserPublicID,
		UserEmail:         localUserEmail,
		NamespacePublicID: localNamespacePublicID,
		CanRead:           cap.Read,
		CanWrite:          cap.Write,
		CanExecute:        cap.Execute,
		CanAdmin:          true,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
	}

	info, err := s.mintPending(meta, wsURL)
	if err != nil {
		http.Error(w, "failed to mint connect info", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, info)
}

type environmentResp struct {
	PublicID          string `json:"public_id"`
	Name              string `json:"name"`
	Description       string `json:"description,omitempty"`
	NamespacePublicID string `json:"namespace_public_id"`
	Status            string `json:"status"`
	LifecycleStatus   string `json:"lifecycle_status"`
	Agent             *struct {
		OS       string `json:"os,omitempty"`
		Arch     string `json:"arch,omitempty"`
		Hostname string `json:"hostname,omitempty"`
		LastSeen string `json:"last_seen,omitempty"`
	} `json:"agent,omitempty"`
	Permissions *struct {
		CanRead    bool `json:"can_read"`
		CanWrite   bool `json:"can_write"`
		CanExecute bool `json:"can_execute"`
		CanAdmin   bool `json:"can_admin"`
		IsOwner    bool `json:"is_owner"`
	} `json:"permissions,omitempty"`
}

func (s *Server) handleEnvironment(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cap := s.resolveLocalCap()

	host, _ := os.Hostname()
	now := time.Now().UTC().Format(time.RFC3339)

	writeJSON(w, http.StatusOK, environmentResp{
		PublicID:          LocalEnvPublicID,
		Name:              "Local Environment",
		NamespacePublicID: localNamespacePublicID,
		Status:            "online",
		LifecycleStatus:   "running",
		Agent: &struct {
			OS       string `json:"os,omitempty"`
			Arch     string `json:"arch,omitempty"`
			Hostname string `json:"hostname,omitempty"`
			LastSeen string `json:"last_seen,omitempty"`
		}{
			OS:       runtime.GOOS,
			Arch:     runtime.GOARCH,
			Hostname: strings.TrimSpace(host),
			LastSeen: now,
		},
		Permissions: &struct {
			CanRead    bool `json:"can_read"`
			CanWrite   bool `json:"can_write"`
			CanExecute bool `json:"can_execute"`
			CanAdmin   bool `json:"can_admin"`
			IsOwner    bool `json:"is_owner"`
		}{
			CanRead:    cap.Read,
			CanWrite:   cap.Write,
			CanExecute: cap.Execute,
			CanAdmin:   true,
			IsOwner:    true,
		},
	})
}

type latestVersionResp struct {
	LatestVersion string `json:"latest_version"`
	Message       string `json:"message,omitempty"`
}

func (s *Server) handleLatestVersion(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	v := strings.TrimSpace(s.version)
	if v == "" {
		v = "unknown"
	}
	writeJSON(w, http.StatusOK, latestVersionResp{
		LatestVersion: v,
		Message:       "Offline: latest version check is unavailable in local mode.",
	})
}

func (s *Server) resolveLocalCap() config.PermissionSet {
	if s == nil {
		return config.PermissionSet{Read: true, Write: false, Execute: true}
	}
	cfg, err := config.Load(s.configPath)
	if err != nil || cfg == nil {
		// Best-effort: keep the UI usable even if config is missing/corrupt.
		return config.PermissionSet{Read: true, Write: false, Execute: true}
	}
	if cfg.PermissionPolicy == nil {
		return config.PermissionSet{Read: true, Write: false, Execute: true}
	}
	return cfg.PermissionPolicy.ResolveCap(localUserPublicID, agent.FloeAppRedevenAgent)
}

func (s *Server) consumePending(channelID string) (pendingDirect, bool) {
	if s == nil {
		return pendingDirect{}, false
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return pendingDirect{}, false
	}
	now := time.Now().Unix()

	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()

	p, ok := s.pending[id]
	if !ok {
		return pendingDirect{}, false
	}
	delete(s.pending, id)
	if p.initExpireAtUnixS <= 0 || now > p.initExpireAtUnixS {
		return pendingDirect{}, false
	}
	return p, true
}

func (s *Server) handleDirectWS(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessHTTP(w, r) {
		return
	}

	checkOrigin := ws.NewOriginChecker(s.allowedOrigins, false)
	c, err := ws.Upgrade(w, r, ws.UpgraderOptions{CheckOrigin: checkOrigin})
	if err != nil {
		s.log.Warn("local direct ws upgrade failed", "error", err)
		return
	}
	defer c.Close()

	var resolved pendingDirect
	var resolvedOK bool
	var ch string
	sess, err := endpoint.AcceptDirectWSResolved(r.Context(), c.Underlying(), endpoint.AcceptDirectResolverOptions{
		ClockSkew: 60 * time.Second,
		Resolve: func(_ctx context.Context, init endpoint.DirectHandshakeInit) (endpoint.DirectHandshakeSecrets, error) {
			ch = strings.TrimSpace(init.ChannelID)
			p, ok := s.consumePending(ch)
			if !ok {
				return endpoint.DirectHandshakeSecrets{}, errors.New("unknown or expired channel")
			}
			resolved = p
			resolvedOK = true
			return endpoint.DirectHandshakeSecrets{
				PSK:               resolved.psk[:],
				InitExpireAtUnixS: resolved.initExpireAtUnixS,
			}, nil
		},
	})
	if err != nil {
		s.log.Warn("local direct ws handshake failed", "channel_id", ch, "error", err)
		return
	}
	defer sess.Close()

	if !resolvedOK {
		s.log.Warn("local direct session missing resolved meta", "channel_id", ch)
		return
	}

	metaCopy := resolved.meta
	if strings.TrimSpace(metaCopy.ChannelID) == "" {
		metaCopy.ChannelID = strings.TrimSpace(ch)
	}

	if err := s.a.ServeLocalDirectSession(r.Context(), sess, &metaCopy); err != nil && r.Context().Err() == nil {
		s.log.Warn("local direct session exited", "channel_id", metaCopy.ChannelID, "error", err)
	}
}

func (s *Server) sweepLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.sweepExpired()
		}
	}
}

func (s *Server) sweepExpired() {
	if s == nil {
		return
	}
	now := time.Now().Unix()

	s.pendingMu.Lock()
	for k, v := range s.pending {
		if v.initExpireAtUnixS > 0 && now > v.initExpireAtUnixS {
			delete(s.pending, k)
		}
	}
	s.pendingMu.Unlock()
}
