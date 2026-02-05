package gateway

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/auditlog"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/portforward"
	pfregistry "github.com/floegence/redeven-agent/internal/portforward/registry"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
)

type Options struct {
	Logger                  *slog.Logger
	ListenAddr              string
	DistFS                  fs.FS
	Backend                 Backend
	PortForward             PortForwardBackend
	AI                      *ai.Service
	Audit                   *auditlog.Store
	ResolveSessionMeta      func(channelID string) (*session.Meta, bool)
	ResolveSessionTunnelURL func(channelID string) (string, bool)
	// ConfigPath is the absolute path to the agent config file.
	// It is used to read and persist settings updates initiated from the Env App UI.
	ConfigPath string

	// SecretsStore holds user-managed secrets (such as AI provider API keys).
	// If nil, the gateway will derive a default secrets path from ConfigPath.
	SecretsStore *settings.SecretsStore
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

type PortForwardBackend interface {
	ListForwards(ctx context.Context) ([]pfregistry.Forward, error)
	GetForward(ctx context.Context, forwardID string) (*pfregistry.Forward, error)
	CreateForward(ctx context.Context, req portforward.CreateForwardRequest) (*pfregistry.Forward, error)
	UpdateForward(ctx context.Context, forwardID string, req portforward.UpdateForwardRequest) (*pfregistry.Forward, error)
	DeleteForward(ctx context.Context, forwardID string) error
	TouchLastOpened(ctx context.Context, forwardID string) (*pfregistry.Forward, error)
}

type SpaceStatus struct {
	CodeSpaceID        string `json:"code_space_id"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	WorkspacePath      string `json:"workspace_path"`
	CodePort           int    `json:"code_port"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64  `json:"last_opened_at_unix_ms"`

	Running bool `json:"running"`
	PID     int  `json:"pid"`
}

type CreateSpaceRequest struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type UpdateSpaceRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type Gateway struct {
	log *slog.Logger

	backend Backend
	pf      PortForwardBackend
	ai      *ai.Service
	audit   *auditlog.Store

	resolveSessionMeta      func(channelID string) (*session.Meta, bool)
	resolveSessionTunnelURL func(channelID string) (string, bool)

	configPath string
	configMu   sync.Mutex
	secrets    *settings.SecretsStore

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
	if strings.TrimSpace(opts.ConfigPath) == "" {
		return nil, errors.New("missing ConfigPath")
	}
	if opts.ResolveSessionMeta == nil {
		return nil, errors.New("missing ResolveSessionMeta")
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

	secrets := opts.SecretsStore
	if secrets == nil {
		// Keep user-managed secrets in the same state dir as config.json.
		dir := filepath.Dir(strings.TrimSpace(opts.ConfigPath))
		secrets = settings.NewSecretsStore(filepath.Join(dir, "secrets.json"))
	}

	return &Gateway{
		log:                     logger,
		backend:                 opts.Backend,
		pf:                      opts.PortForward,
		ai:                      opts.AI,
		audit:                   opts.Audit,
		resolveSessionMeta:      opts.ResolveSessionMeta,
		resolveSessionTunnelURL: opts.ResolveSessionTunnelURL,
		configPath:              strings.TrimSpace(opts.ConfigPath),
		secrets:                 secrets,
		distFS:                  opts.DistFS,
		dist:                    dist,
		addr:                    addr,
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

	// UX: ensure code-server always opens the codespace's bound workspace directory.
	//
	// code-server decides the initial workspace based on ?folder/?workspace (first),
	// last-opened state, or CLI args. It does not know about the agent registry.
	// Redirecting here makes the "codespace workspace_path is strongly bound" rule
	// deterministic for all entry paths (open/refresh/bookmark).
	switch originRole {
	case originRoleCodeSpace:
		if g.maybeRedirectCodespaceRootToWorkspace(w, r) {
			return
		}
		g.handleCodeServerProxy(w, r)
		return
	case originRolePortForward:
		g.handlePortForwardProxy(w, r)
		return
	default:
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
}

type apiResp struct {
	OK    bool        `json:"ok"`
	Error string      `json:"error,omitempty"`
	Data  interface{} `json:"data,omitempty"`
}

type settingsView struct {
	ConfigPath string `json:"config_path"`

	Connection settingsConnectionView `json:"connection"`
	Runtime    settingsRuntimeView    `json:"runtime"`
	Logging    settingsLoggingView    `json:"logging"`
	Codespaces settingsCodespacesView `json:"codespaces"`

	PermissionPolicy *config.PermissionPolicy `json:"permission_policy"`
	AI               *config.AIConfig         `json:"ai"`
	AISecrets        *settingsAISecretsView   `json:"ai_secrets,omitempty"`
}

type settingsAISecretsView struct {
	ProviderAPIKeySet map[string]bool `json:"provider_api_key_set"`
}

type settingsConnectionView struct {
	ControlplaneBaseURL string             `json:"controlplane_base_url"`
	EnvironmentID       string             `json:"environment_id"`
	AgentInstanceID     string             `json:"agent_instance_id"`
	Direct              settingsDirectView `json:"direct"`
}

type settingsDirectView struct {
	WsURL                    string `json:"ws_url"`
	ChannelID                string `json:"channel_id"`
	ChannelInitExpireAtUnixS int64  `json:"channel_init_expire_at_unix_s"`
	DefaultSuite             uint16 `json:"default_suite"`
	E2eePskSet               bool   `json:"e2ee_psk_set"`
}

type settingsRuntimeView struct {
	RootDir string `json:"root_dir"`
	Shell   string `json:"shell"`
}

type settingsLoggingView struct {
	LogFormat string `json:"log_format"`
	LogLevel  string `json:"log_level"`
}

type settingsCodespacesView struct {
	CodeServerPortMin int `json:"code_server_port_min"`
	CodeServerPortMax int `json:"code_server_port_max"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func toSettingsView(cfg *config.Config, configPath string, secrets *settings.SecretsStore) settingsView {
	var direct settingsDirectView
	if cfg != nil && cfg.Direct != nil {
		direct = settingsDirectView{
			WsURL:                    strings.TrimSpace(cfg.Direct.WsUrl),
			ChannelID:                strings.TrimSpace(cfg.Direct.ChannelId),
			ChannelInitExpireAtUnixS: cfg.Direct.ChannelInitExpireAtUnixS,
			DefaultSuite:             uint16(cfg.Direct.DefaultSuite),
			E2eePskSet:               strings.TrimSpace(cfg.Direct.E2eePskB64u) != "",
		}
	}

	var out settingsView
	out.ConfigPath = strings.TrimSpace(configPath)
	if cfg != nil {
		out.Connection = settingsConnectionView{
			ControlplaneBaseURL: strings.TrimSpace(cfg.ControlplaneBaseURL),
			EnvironmentID:       strings.TrimSpace(cfg.EnvironmentID),
			AgentInstanceID:     strings.TrimSpace(cfg.AgentInstanceID),
			Direct:              direct,
		}
		out.Runtime = settingsRuntimeView{
			RootDir: strings.TrimSpace(cfg.RootDir),
			Shell:   strings.TrimSpace(cfg.Shell),
		}
		out.Logging = settingsLoggingView{
			LogFormat: strings.TrimSpace(cfg.LogFormat),
			LogLevel:  strings.TrimSpace(cfg.LogLevel),
		}
		out.Codespaces = settingsCodespacesView{
			CodeServerPortMin: cfg.CodeServerPortMin,
			CodeServerPortMax: cfg.CodeServerPortMax,
		}
		out.PermissionPolicy = cfg.PermissionPolicy
		out.AI = cfg.AI

		if secrets != nil && cfg.AI != nil && len(cfg.AI.Providers) > 0 {
			ids := make([]string, 0, len(cfg.AI.Providers))
			for i := range cfg.AI.Providers {
				id := strings.TrimSpace(cfg.AI.Providers[i].ID)
				if id == "" {
					continue
				}
				ids = append(ids, id)
			}
			if len(ids) > 0 {
				if set, err := secrets.GetAIProviderAPIKeySet(ids); err == nil {
					out.AISecrets = &settingsAISecretsView{ProviderAPIKeySet: set}
				}
			}
		}
	}
	return out
}

func (g *Gateway) loadConfigLocked() (*config.Config, error) {
	if g == nil {
		return nil, errors.New("gateway not ready")
	}
	path := strings.TrimSpace(g.configPath)
	if path == "" {
		return nil, errors.New("missing config path")
	}
	g.configMu.Lock()
	defer g.configMu.Unlock()
	return config.Load(path)
}

func (g *Gateway) updateConfigLocked(mut func(cfg *config.Config) error) (*config.Config, error) {
	if g == nil {
		return nil, errors.New("gateway not ready")
	}
	path := strings.TrimSpace(g.configPath)
	if path == "" {
		return nil, errors.New("missing config path")
	}
	g.configMu.Lock()
	defer g.configMu.Unlock()

	cfg, err := config.Load(path)
	if err != nil {
		return nil, err
	}
	if mut != nil {
		if err := mut(cfg); err != nil {
			return nil, err
		}
	}
	if err := config.Save(path, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

type requiredPermission int

const (
	requiredPermissionRead requiredPermission = iota
	requiredPermissionWrite
	requiredPermissionExecute
	requiredPermissionAdmin
)

func (g *Gateway) requirePermission(w http.ResponseWriter, r *http.Request, perm requiredPermission) (*session.Meta, bool) {
	if g == nil || w == nil || r == nil {
		return nil, false
	}
	if g.resolveSessionMeta == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "gateway not ready"})
		return nil, false
	}

	channelID, err := channelIDFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session origin"})
		return nil, false
	}

	meta, ok := g.resolveSessionMeta(channelID)
	if !ok || meta == nil {
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "permission denied"})
		return nil, false
	}

	switch perm {
	case requiredPermissionRead:
		if !meta.CanRead {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "read permission denied"})
			return nil, false
		}
	case requiredPermissionWrite:
		if !meta.CanWrite {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "write permission denied"})
			return nil, false
		}
	case requiredPermissionExecute:
		if !meta.CanExecute {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "execute permission denied"})
			return nil, false
		}
	case requiredPermissionAdmin:
		if !meta.CanAdmin {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "admin permission denied"})
			return nil, false
		}
	default:
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "permission denied"})
		return nil, false
	}

	return meta, true
}

func sanitizeAuditError(err error) string {
	if err == nil {
		return ""
	}
	s := strings.TrimSpace(err.Error())
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 240 {
		s = s[:240] + "..."
	}
	return s
}

func truncateString(s string, max int) string {
	if max <= 0 {
		return ""
	}
	v := strings.TrimSpace(s)
	if len(v) <= max {
		return v
	}
	return v[:max] + "..."
}

func auditURLHost(raw string) (scheme string, host string) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return "", ""
	}
	return strings.TrimSpace(u.Scheme), strings.TrimSpace(u.Host)
}

func (g *Gateway) appendAudit(meta *session.Meta, action string, status string, detail map[string]any, err error) {
	if g == nil || g.audit == nil || meta == nil {
		return
	}
	a := strings.TrimSpace(action)
	if a == "" {
		return
	}
	st := strings.TrimSpace(status)
	if st == "" {
		st = "success"
	}

	tunnelURL := ""
	if g.resolveSessionTunnelURL != nil {
		if v, ok := g.resolveSessionTunnelURL(strings.TrimSpace(meta.ChannelID)); ok {
			tunnelURL = strings.TrimSpace(v)
		}
	}

	g.audit.Append(auditlog.Entry{
		Action:    a,
		Status:    st,
		Error:     sanitizeAuditError(err),
		ChannelID: strings.TrimSpace(meta.ChannelID),

		EnvPublicID:       strings.TrimSpace(meta.EndpointID),
		NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),

		UserPublicID: strings.TrimSpace(meta.UserPublicID),
		UserEmail:    strings.TrimSpace(meta.UserEmail),

		FloeApp:     strings.TrimSpace(meta.FloeApp),
		SessionKind: strings.TrimSpace(meta.SessionKind),
		CodeSpaceID: strings.TrimSpace(meta.CodeSpaceID),
		TunnelURL:   tunnelURL,
		CanRead:     meta.CanRead,
		CanWrite:    meta.CanWrite,
		CanExecute:  meta.CanExecute,
		CanAdmin:    meta.CanAdmin,
		Detail:      detail,
	})
}

func (g *Gateway) handleAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/audit/logs":
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return
		}
		if g.audit == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "audit log not configured"})
			return
		}
		limit := 200
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		entries, err := g.audit.List(limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to read audit log"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"entries": entries}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/settings":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		cfg, err := g.loadConfigLocked()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: toSettingsView(cfg, g.configPath, g.secrets)})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/settings":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		type settingsUpdateReq struct {
			RootDir *string `json:"root_dir,omitempty"`
			Shell   *string `json:"shell,omitempty"`

			LogFormat *string `json:"log_format,omitempty"`
			LogLevel  *string `json:"log_level,omitempty"`

			CodeServerPortMin *int `json:"code_server_port_min,omitempty"`
			CodeServerPortMax *int `json:"code_server_port_max,omitempty"`

			PermissionPolicy json.RawMessage `json:"permission_policy,omitempty"`
			AI               json.RawMessage `json:"ai,omitempty"`
		}

		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body settingsUpdateReq
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}

		if body.RootDir == nil && body.Shell == nil &&
			body.LogFormat == nil && body.LogLevel == nil &&
			body.CodeServerPortMin == nil && body.CodeServerPortMax == nil &&
			len(body.PermissionPolicy) == 0 && len(body.AI) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
			return
		}

		var nextPolicy *config.PermissionPolicy
		if len(body.PermissionPolicy) > 0 {
			raw := bytes.TrimSpace(body.PermissionPolicy)
			if !bytes.Equal(raw, []byte("null")) {
				var p config.PermissionPolicy
				ppDec := json.NewDecoder(bytes.NewReader(raw))
				ppDec.DisallowUnknownFields()
				if err := ppDec.Decode(&p); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid permission_policy json"})
					return
				}
				if err := ppDec.Decode(&struct{}{}); err != io.EOF {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid permission_policy json"})
					return
				}
				if err := p.Validate(); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: fmt.Sprintf("invalid permission_policy: %s", err.Error())})
					return
				}
				nextPolicy = &p
			}
		}

		var nextAI *config.AIConfig
		if len(body.AI) > 0 {
			raw := bytes.TrimSpace(body.AI)
			if !bytes.Equal(raw, []byte("null")) {
				var cfg config.AIConfig
				aiDec := json.NewDecoder(bytes.NewReader(raw))
				aiDec.DisallowUnknownFields()
				if err := aiDec.Decode(&cfg); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid ai json"})
					return
				}
				if err := aiDec.Decode(&struct{}{}); err != io.EOF {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid ai json"})
					return
				}
				if err := cfg.Validate(); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: fmt.Sprintf("invalid ai: %s", err.Error())})
					return
				}
				nextAI = &cfg
			}
		}

		auditDetail := map[string]any{}
		if body.RootDir != nil {
			auditDetail["root_dir"] = strings.TrimSpace(*body.RootDir)
		}
		if body.Shell != nil {
			auditDetail["shell"] = strings.TrimSpace(*body.Shell)
		}
		if body.LogFormat != nil {
			auditDetail["log_format"] = strings.TrimSpace(*body.LogFormat)
		}
		if body.LogLevel != nil {
			auditDetail["log_level"] = strings.TrimSpace(*body.LogLevel)
		}
		if body.CodeServerPortMin != nil {
			auditDetail["code_server_port_min"] = *body.CodeServerPortMin
		}
		if body.CodeServerPortMax != nil {
			auditDetail["code_server_port_max"] = *body.CodeServerPortMax
		}
		if len(body.PermissionPolicy) > 0 {
			auditDetail["permission_policy_updated"] = true
		}
		if len(body.AI) > 0 {
			// Do NOT log any AI config details (may include secrets).
			auditDetail["ai_updated"] = true
		}

		var updated *config.Config
		persist := func() error {
			cfg, err := g.updateConfigLocked(func(c *config.Config) error {
				if body.RootDir != nil {
					c.RootDir = strings.TrimSpace(*body.RootDir)
				}
				if body.Shell != nil {
					c.Shell = strings.TrimSpace(*body.Shell)
				}
				if body.LogFormat != nil {
					c.LogFormat = strings.TrimSpace(*body.LogFormat)
				}
				if body.LogLevel != nil {
					c.LogLevel = strings.TrimSpace(*body.LogLevel)
				}
				if body.CodeServerPortMin != nil {
					c.CodeServerPortMin = *body.CodeServerPortMin
				}
				if body.CodeServerPortMax != nil {
					c.CodeServerPortMax = *body.CodeServerPortMax
				}
				if len(body.PermissionPolicy) > 0 {
					c.PermissionPolicy = nextPolicy
				}
				if len(body.AI) > 0 {
					c.AI = nextAI
				}
				return nil
			})
			if err != nil {
				return err
			}
			updated = cfg
			return nil
		}

		var err error
		if len(body.AI) > 0 {
			if g.ai == nil {
				g.appendAudit(meta, "settings_update", "failure", auditDetail, errors.New("ai service not ready"))
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			err = g.ai.UpdateConfig(nextAI, persist)
		} else {
			err = persist()
		}
		if err != nil {
			g.appendAudit(meta, "settings_update", "failure", auditDetail, err)
			status := http.StatusBadRequest
			if errors.Is(err, ai.ErrConfigLocked) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
			return
		}

		g.appendAudit(meta, "settings_update", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: toSettingsView(updated, g.configPath, g.secrets)})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/provider_keys/status":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		type reqBody struct {
			ProviderIDs []string `json:"provider_ids"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		set, err := g.secrets.GetAIProviderAPIKeySet(body.ProviderIDs)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load ai provider key status"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/ai/provider_keys":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		type patch struct {
			ProviderID string  `json:"provider_id"`
			APIKey     *string `json:"api_key"`
		}
		type reqBody struct {
			Patches []patch `json:"patches"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if len(body.Patches) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing patches"})
			return
		}

		converted := make([]settings.AIProviderAPIKeyPatch, 0, len(body.Patches))
		touched := make([]string, 0, len(body.Patches))
		for i := range body.Patches {
			p := body.Patches[i]
			id := strings.TrimSpace(p.ProviderID)
			if id == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid provider_id"})
				return
			}
			var key *string
			if p.APIKey != nil {
				v := strings.TrimSpace(*p.APIKey)
				key = &v
			}
			converted = append(converted, settings.AIProviderAPIKeyPatch{ProviderID: id, APIKey: key})
			touched = append(touched, id)
		}

		if err := g.secrets.ApplyAIProviderAPIKeyPatches(converted); err != nil {
			g.appendAudit(meta, "ai_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}

		set, err := g.secrets.GetAIProviderAPIKeySet(touched)
		if err != nil {
			g.appendAudit(meta, "ai_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load ai provider key status"})
			return
		}

		g.appendAudit(meta, "ai_provider_key_update", "success", map[string]any{"providers": touched}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/models":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		models, err := g.ai.ListModels()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: models})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/threads":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}

		limit := 50
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

		out, err := g.ai.ListThreads(r.Context(), meta, limit, cursor)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/threads":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body ai.CreateThreadRequest
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}

		th, err := g.ai.CreateThread(r.Context(), meta, body.Title)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: ai.CreateThreadResponse{Thread: *th}})
		return

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/threads/"):
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/threads/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		threadID := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}

		if threadID == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		switch {
		case action == "" && r.Method == http.MethodGet:
			meta, ok := g.requirePermission(w, r, requiredPermissionRead)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			th, err := g.ai.GetThread(r.Context(), meta, threadID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			if th == nil {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"thread": th}})
			return

		case action == "" && r.Method == http.MethodPatch:
			meta, ok := g.requirePermission(w, r, requiredPermissionRead)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.PatchThreadRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}

			if body.Title == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			if err := g.ai.RenameThread(r.Context(), meta, threadID, *body.Title); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			th, err := g.ai.GetThread(r.Context(), meta, threadID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			if th == nil {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"thread": th}})
			return

		case action == "" && r.Method == http.MethodDelete:
			meta, ok := g.requirePermission(w, r, requiredPermissionWrite)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			if err := g.ai.DeleteThread(r.Context(), meta, threadID); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, ai.ErrThreadBusy) {
					status = http.StatusConflict
				} else if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				g.appendAudit(meta, "ai_thread_delete", "failure", map[string]any{"thread_id": threadID}, err)
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_thread_delete", "success", map[string]any{"thread_id": threadID}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "messages" && r.Method == http.MethodGet:
			meta, ok := g.requirePermission(w, r, requiredPermissionRead)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}

			limit := 200
			if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
				if v, err := strconv.Atoi(raw); err == nil {
					limit = v
				}
			}
			var beforeID int64
			if raw := strings.TrimSpace(r.URL.Query().Get("before_id")); raw != "" {
				if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
					beforeID = v
				}
			}

			out, err := g.ai.ListThreadMessages(r.Context(), meta, threadID, limit, beforeID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
			return

		case action == "messages" && r.Method == http.MethodPost:
			meta, ok := g.requirePermission(w, r, requiredPermissionRead)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.AppendThreadMessageRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := g.ai.AppendThreadMessage(r.Context(), meta, threadID, body.Role, body.Text, body.Format); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/runs":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID := strings.TrimSpace(meta.ChannelID)
		if channelID == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session"})
			return
		}
		if g.ai.HasActiveRun(channelID) {
			writeJSON(w, http.StatusConflict, apiResp{OK: false, Error: "run already active"})
			return
		}

		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var req ai.RunStartRequest
		if err := dec.Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}

		if strings.TrimSpace(req.ThreadID) == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing thread_id"})
			return
		}
		if g.ai.HasActiveThread(strings.TrimSpace(req.ThreadID)) {
			writeJSON(w, http.StatusConflict, apiResp{OK: false, Error: "thread already active"})
			return
		}
		th, err := g.ai.GetThread(r.Context(), meta, strings.TrimSpace(req.ThreadID))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if th == nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
			return
		}

		if strings.TrimSpace(req.Model) == "" {
			models, err := g.ai.ListModels()
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
				return
			}
			req.Model = models.DefaultModel
		}

		runID, err := ai.NewRunID()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to allocate run id"})
			return
		}

		// Stream response (NDJSON).
		w.Header().Set("X-Redeven-AI-Run-ID", runID)
		w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
		w.WriteHeader(http.StatusOK)

		// Block until the run completes (or the client disconnects).
		startedAt := time.Now()
		runErr := g.ai.StartRun(r.Context(), meta, runID, req, w)
		auditDetail := map[string]any{
			"run_id":      runID,
			"thread_id":   strings.TrimSpace(req.ThreadID),
			"model":       strings.TrimSpace(req.Model),
			"duration_ms": time.Since(startedAt).Milliseconds(),
		}
		if runErr != nil {
			g.log.Warn("ai run failed", "channel_id", channelID, "run_id", runID, "error", runErr)
			g.appendAudit(meta, "ai_run", "failure", auditDetail, runErr)
			return
		}
		g.appendAudit(meta, "ai_run", "success", auditDetail, nil)
		return

	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/runs/"):
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID := strings.TrimSpace(meta.ChannelID)
		if channelID == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session"})
			return
		}

		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/runs/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		runID := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}

		if r.Method == http.MethodPost && action == "cancel" {
			if err := g.ai.CancelRun(channelID, runID); err != nil {
				g.appendAudit(meta, "ai_run_cancel", "failure", map[string]any{"run_id": runID}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_run_cancel", "success", map[string]any{"run_id": runID}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		if r.Method == http.MethodPost && action == "tool_approvals" {
			var body ai.ToolApprovalRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if strings.TrimSpace(body.ToolID) == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing tool_id"})
				return
			}
			if err := g.ai.ApproveTool(channelID, runID, body.ToolID, body.Approved); err != nil {
				g.appendAudit(meta, "ai_tool_approval", "failure", map[string]any{
					"run_id":   runID,
					"tool_id":  strings.TrimSpace(body.ToolID),
					"approved": body.Approved,
				}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_tool_approval", "success", map[string]any{
				"run_id":   runID,
				"tool_id":  strings.TrimSpace(body.ToolID),
				"approved": body.Approved,
			}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/uploads":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		// 10 MiB upload cap (aligned with ChatInput defaults).
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid multipart form"})
			return
		}
		f, fh, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing file"})
			return
		}
		defer f.Close()

		name := ""
		mimeType := ""
		if fh != nil {
			name = fh.Filename
			mimeType = fh.Header.Get("Content-Type")
		}

		out, err := g.ai.SaveUpload(f, name, mimeType, 10<<20)
		if err != nil {
			g.appendAudit(meta, "ai_upload", "failure", map[string]any{
				"name":      strings.TrimSpace(name),
				"mime_type": strings.TrimSpace(mimeType),
			}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		uploadID := ""
		if out != nil {
			u := strings.TrimSpace(out.URL)
			if u != "" {
				u = strings.TrimSuffix(u, "/")
				if i := strings.LastIndex(u, "/"); i >= 0 {
					uploadID = strings.TrimSpace(u[i+1:])
				}
			}
		}
		g.appendAudit(meta, "ai_upload", "success", map[string]any{
			"upload_id": uploadID,
			"name":      strings.TrimSpace(out.Name),
			"mime_type": strings.TrimSpace(out.MimeType),
			"size":      out.Size,
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/uploads/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/uploads/")
		rest = strings.TrimPrefix(rest, "/")
		uploadID := strings.TrimSpace(rest)
		if uploadID == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		info, filePath, err := g.ai.OpenUpload(uploadID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: err.Error()})
			return
		}

		f, err := os.Open(filePath)
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		w.Header().Set("Content-Type", strings.TrimSpace(info.MimeType))
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", info.Name))
		http.ServeContent(w, r, info.Name, st.ModTime(), f)
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/spaces":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		spaces, err := g.backend.ListSpaces(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"spaces": spaces}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/forwards":
		if _, ok := g.requirePermission(w, r, requiredPermissionExecute); !ok {
			return
		}
		if g.pf == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
			return
		}
		forwards, err := g.pf.ListForwards(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		views := make([]portForwardView, 0, len(forwards))
		for _, f := range forwards {
			views = append(views, portForwardView{
				ForwardID:          f.ForwardID,
				TargetURL:          f.TargetURL,
				Name:               f.Name,
				Description:        f.Description,
				HealthPath:         f.HealthPath,
				InsecureSkipVerify: f.InsecureSkipVerify,
				CreatedAtUnixMs:    f.CreatedAtUnixMs,
				UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
				LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
				Health:             portForwardHealth{Status: "unknown"},
			})
		}

		// Best-effort health probing (bounded concurrency + tight timeout).
		sem := make(chan struct{}, 8)
		var wg sync.WaitGroup
		for i := range views {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
				case <-r.Context().Done():
					return
				}
				defer func() { <-sem }()
				views[i].Health = probePortForwardHealth(r.Context(), views[i].TargetURL)
			}(i)
		}
		wg.Wait()

		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"forwards": views}})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/forwards":
		meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
		if !ok {
			return
		}
		if g.pf == nil {
			g.appendAudit(meta, "port_forward_create", "failure", nil, errors.New("portforward not ready"))
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
			return
		}
		var req portforward.CreateForwardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		scheme, host := auditURLHost(req.Target)
		auditDetail := map[string]any{
			"target_scheme":        scheme,
			"target_host":          host,
			"name":                 truncateString(req.Name, 80),
			"insecure_skip_verify": req.InsecureSkipVerify,
		}
		f, err := g.pf.CreateForward(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "port_forward_create", "failure", auditDetail, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if f == nil {
			g.appendAudit(meta, "port_forward_create", "failure", auditDetail, errors.New("failed to create forward"))
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to create forward"})
			return
		}
		auditDetail["forward_id"] = f.ForwardID
		view := portForwardView{
			ForwardID:          f.ForwardID,
			TargetURL:          f.TargetURL,
			Name:               f.Name,
			Description:        f.Description,
			HealthPath:         f.HealthPath,
			InsecureSkipVerify: f.InsecureSkipVerify,
			CreatedAtUnixMs:    f.CreatedAtUnixMs,
			UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
			LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
			Health:             probePortForwardHealth(r.Context(), f.TargetURL),
		}
		g.appendAudit(meta, "port_forward_create", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/spaces":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		var req CreateSpaceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		auditDetail := map[string]any{
			"path":        truncateString(req.Path, 160),
			"name":        truncateString(req.Name, 80),
			"description": truncateString(req.Description, 160),
		}
		s, err := g.backend.CreateSpace(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "codespace_create", "failure", auditDetail, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if s != nil {
			auditDetail["code_space_id"] = s.CodeSpaceID
			auditDetail["workspace_path"] = truncateString(s.WorkspacePath, 160)
		}
		g.appendAudit(meta, "codespace_create", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
		return

	default:
		if strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/forwards/") {
			meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
			if !ok {
				return
			}
			if g.pf == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
				return
			}

			// /_redeven_proxy/api/forwards/<id>[/action]
			rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/forwards/")
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
				if err := g.pf.DeleteForward(r.Context(), id); err != nil {
					g.appendAudit(meta, "port_forward_delete", "failure", map[string]any{"forward_id": id}, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				g.appendAudit(meta, "port_forward_delete", "success", map[string]any{"forward_id": id}, nil)
				writeJSON(w, http.StatusOK, apiResp{OK: true})
				return
			}

			if r.Method == http.MethodPatch && action == "" {
				var req portforward.UpdateForwardRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
					return
				}
				if req.Target == nil && req.Name == nil && req.Description == nil && req.HealthPath == nil && req.InsecureSkipVerify == nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
					return
				}
				auditDetail := map[string]any{"forward_id": id}
				if req.Target != nil {
					scheme, host := auditURLHost(*req.Target)
					auditDetail["target_scheme"] = scheme
					auditDetail["target_host"] = host
				}
				if req.Name != nil {
					auditDetail["name"] = truncateString(*req.Name, 80)
				}
				if req.InsecureSkipVerify != nil {
					auditDetail["insecure_skip_verify"] = *req.InsecureSkipVerify
				}
				f, err := g.pf.UpdateForward(r.Context(), id, req)
				if err != nil {
					g.appendAudit(meta, "port_forward_update", "failure", auditDetail, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				if f == nil {
					g.appendAudit(meta, "port_forward_update", "failure", auditDetail, errors.New("not found"))
					writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
					return
				}
				view := portForwardView{
					ForwardID:          f.ForwardID,
					TargetURL:          f.TargetURL,
					Name:               f.Name,
					Description:        f.Description,
					HealthPath:         f.HealthPath,
					InsecureSkipVerify: f.InsecureSkipVerify,
					CreatedAtUnixMs:    f.CreatedAtUnixMs,
					UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
					LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
					Health:             probePortForwardHealth(r.Context(), f.TargetURL),
				}
				g.appendAudit(meta, "port_forward_update", "success", auditDetail, nil)
				writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
				return
			}

			if r.Method == http.MethodPost && action == "touch" {
				f, err := g.pf.TouchLastOpened(r.Context(), id)
				if err != nil {
					g.appendAudit(meta, "port_forward_open", "failure", map[string]any{"forward_id": id}, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				if f == nil {
					g.appendAudit(meta, "port_forward_open", "failure", map[string]any{"forward_id": id}, errors.New("not found"))
					writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
					return
				}
				scheme, host := auditURLHost(f.TargetURL)
				g.appendAudit(meta, "port_forward_open", "success", map[string]any{
					"forward_id":    f.ForwardID,
					"target_scheme": scheme,
					"target_host":   host,
				}, nil)
				view := portForwardView{
					ForwardID:          f.ForwardID,
					TargetURL:          f.TargetURL,
					Name:               f.Name,
					Description:        f.Description,
					HealthPath:         f.HealthPath,
					InsecureSkipVerify: f.InsecureSkipVerify,
					CreatedAtUnixMs:    f.CreatedAtUnixMs,
					UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
					LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
					Health:             probePortForwardHealth(r.Context(), f.TargetURL),
				}
				writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
				return
			}

			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		if !strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/spaces/") {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

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
			meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
			if !ok {
				return
			}
			if err := g.backend.DeleteSpace(r.Context(), id); err != nil {
				g.appendAudit(meta, "codespace_delete", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_delete", "success", map[string]any{"code_space_id": id}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}
		if r.Method == http.MethodPatch && action == "" {
			meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
			if !ok {
				return
			}
			var req UpdateSpaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if req.Name == nil && req.Description == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			auditDetail := map[string]any{"code_space_id": id}
			if req.Name != nil {
				auditDetail["name"] = truncateString(*req.Name, 80)
			}
			if req.Description != nil {
				auditDetail["description"] = truncateString(*req.Description, 160)
			}
			s, err := g.backend.UpdateSpace(r.Context(), id, req)
			if err != nil {
				g.appendAudit(meta, "codespace_update", "failure", auditDetail, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_update", "success", auditDetail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "start" {
			meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
			if !ok {
				return
			}
			s, err := g.backend.StartSpace(r.Context(), id)
			if err != nil {
				g.appendAudit(meta, "codespace_start", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			auditDetail := map[string]any{"code_space_id": id}
			if s != nil {
				auditDetail["code_port"] = s.CodePort
			}
			g.appendAudit(meta, "codespace_start", "success", auditDetail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "stop" {
			meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
			if !ok {
				return
			}
			if err := g.backend.StopSpace(r.Context(), id); err != nil {
				g.appendAudit(meta, "codespace_stop", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_stop", "success", map[string]any{"code_space_id": id}, nil)
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

type portForwardHealth struct {
	Status              string `json:"status"` // healthy|unreachable|unknown
	LastCheckedAtUnixMs int64  `json:"last_checked_at_unix_ms"`
	LatencyMs           int64  `json:"latency_ms"`
	LastError           string `json:"last_error"`
}

type portForwardView struct {
	ForwardID          string `json:"forward_id"`
	TargetURL          string `json:"target_url"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	HealthPath         string `json:"health_path"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`

	CreatedAtUnixMs    int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64 `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64 `json:"last_opened_at_unix_ms"`

	Health portForwardHealth `json:"health"`
}

func probePortForwardHealth(ctx context.Context, targetURL string) portForwardHealth {
	out := portForwardHealth{
		Status:              "unknown",
		LastCheckedAtUnixMs: time.Now().UnixMilli(),
		LatencyMs:           0,
		LastError:           "",
	}
	u, err := portforward.ParseTargetURL(strings.TrimSpace(targetURL))
	if err != nil || u == nil {
		out.LastError = truncateErr(err)
		return out
	}
	host := strings.TrimSpace(u.Host)
	if host == "" {
		out.LastError = "missing target host"
		return out
	}

	probeCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
	defer cancel()

	start := time.Now()
	conn, err := (&net.Dialer{Timeout: 800 * time.Millisecond}).DialContext(probeCtx, "tcp", host)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		out.Status = "unreachable"
		out.LatencyMs = latency
		out.LastError = truncateErr(err)
		return out
	}
	_ = conn.Close()

	out.Status = "healthy"
	out.LatencyMs = latency
	return out
}

func truncateErr(err error) string {
	if err == nil {
		return ""
	}
	s := strings.TrimSpace(err.Error())
	const max = 200
	if len(s) <= max {
		return s
	}
	return strings.TrimSpace(s[:max]) + "..."
}

func (g *Gateway) handlePortForwardProxy(w http.ResponseWriter, r *http.Request) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	if g.pf == nil {
		http.Error(w, "portforward not configured", http.StatusServiceUnavailable)
		return
	}

	extScheme, extHost, err := externalOriginFromRequest(r)
	if err != nil {
		http.Error(w, "missing external origin", http.StatusBadRequest)
		return
	}
	forwardID, ok := forwardIDFromExternalHost(extHost)
	if !ok {
		http.Error(w, "not a port forward origin", http.StatusNotFound)
		return
	}

	fw, err := g.pf.GetForward(r.Context(), forwardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if fw == nil {
		http.Error(w, "port forward not found", http.StatusNotFound)
		return
	}

	targetURL, err := portforward.ParseTargetURL(strings.TrimSpace(fw.TargetURL))
	if err != nil {
		http.Error(w, "invalid port forward target", http.StatusInternalServerError)
		return
	}

	targetBase := &url.URL{Scheme: targetURL.Scheme, Host: targetURL.Host}
	targetOrigin := fmt.Sprintf("%s://%s", targetURL.Scheme, targetURL.Host)

	extOrigin := fmt.Sprintf("%s://%s", extScheme, extHost)
	extWsScheme := "ws"
	if extScheme == "https" {
		extWsScheme = "wss"
	}
	extWsOrigin := fmt.Sprintf("%s://%s", extWsScheme, extHost)

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     false,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: fw.InsecureSkipVerify,
		},
		// Disable HTTP/2 to keep WebSocket upgrade behavior predictable.
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}

	proxy := &httputil.ReverseProxy{
		Transport: transport,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(targetBase)

			// Compatibility-first: make the upstream believe it is serving its own origin.
			pr.Out.Host = targetURL.Host
			pr.Out.Header.Set("Origin", targetOrigin)
			if strings.TrimSpace(pr.Out.Header.Get("Referer")) != "" {
				pr.Out.Header.Set("Referer", targetOrigin)
			}

			// Let the Go transport manage gzip so ModifyResponse can safely rewrite HTML.
			pr.Out.Header.Del("Accept-Encoding")

			// Hardening: ensure upstream getHost() is not polluted by forwarded headers.
			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Port")
		},
		ModifyResponse: func(resp *http.Response) error {
			if resp == nil {
				return nil
			}

			// Compatibility-first for embedded iframe + injected script.
			resp.Header.Del("Content-Security-Policy")
			resp.Header.Del("Content-Security-Policy-Report-Only")
			resp.Header.Del("X-Frame-Options")

			// Rewrite Location back to the sandbox origin when redirecting to the target itself.
			if loc := strings.TrimSpace(resp.Header.Get("Location")); loc != "" {
				resp.Header.Set("Location", rewriteLocationToSandbox(loc, targetURL, extOrigin))
			}

			// Strip Domain from Set-Cookie so cookies bind to pf-* host.
			if sc := resp.Header.Values("Set-Cookie"); len(sc) > 0 {
				resp.Header.Del("Set-Cookie")
				for _, v := range sc {
					resp.Header.Add("Set-Cookie", stripCookieDomain(v))
				}
			}

			ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
			if !strings.Contains(ct, "text/html") {
				return nil
			}

			// Best-effort HTML rewrite for absolute URLs that point back to the target origin.
			const maxHTMLBytes = 2 << 20 // 2 MiB
			b, err := io.ReadAll(io.LimitReader(resp.Body, maxHTMLBytes+1))
			if err != nil {
				return err
			}
			_ = resp.Body.Close()

			// Too large: keep the original body (but it is already decompressed).
			if len(b) > maxHTMLBytes {
				resp.Body = io.NopCloser(bytes.NewReader(b))
				resp.ContentLength = int64(len(b))
				resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(b)))
				return nil
			}

			rewritten := rewriteHTMLOrigins(string(b), targetURL, extOrigin, extWsOrigin)
			resp.Body = io.NopCloser(strings.NewReader(rewritten))
			resp.ContentLength = int64(len(rewritten))
			resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
			// Body was modified; validators are no longer reliable.
			resp.Header.Del("ETag")
			resp.Header.Del("Last-Modified")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}

	proxy.ServeHTTP(w, r)
}

func rewriteLocationToSandbox(location string, target *url.URL, externalOrigin string) string {
	loc := strings.TrimSpace(location)
	if loc == "" || target == nil {
		return location
	}
	u, err := url.Parse(loc)
	if err != nil || u == nil {
		return location
	}
	if strings.TrimSpace(u.Host) == "" {
		// Relative redirects are already sandbox-safe.
		return location
	}

	targetHost := strings.ToLower(strings.TrimSpace(target.Hostname()))
	targetPort := strings.TrimSpace(target.Port())
	if targetPort == "" {
		targetPort = defaultPortForScheme(strings.ToLower(strings.TrimSpace(target.Scheme)))
	}

	locHost := strings.ToLower(strings.TrimSpace(u.Hostname()))
	locPort := strings.TrimSpace(u.Port())
	if locPort == "" {
		scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
		if scheme == "" {
			scheme = strings.ToLower(strings.TrimSpace(target.Scheme))
		}
		locPort = defaultPortForScheme(scheme)
	}

	if locHost != targetHost || (targetPort != "" && locPort != "" && locPort != targetPort) {
		return location
	}

	// Redirect within the target itself: rewrite back to the sandbox origin.
	//
	// Note: return a path-only redirect to avoid leaking the sandbox origin into app logic.
	path := u.EscapedPath()
	if strings.TrimSpace(path) == "" {
		path = "/"
	}
	if strings.TrimSpace(u.RawQuery) != "" {
		path += "?" + u.RawQuery
	}
	if strings.TrimSpace(u.Fragment) != "" {
		path += "#" + u.Fragment
	}
	_ = externalOrigin
	return path
}

func defaultPortForScheme(scheme string) string {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https", "wss":
		return "443"
	case "http", "ws":
		return "80"
	default:
		return ""
	}
}

func stripCookieDomain(v string) string {
	raw := strings.TrimSpace(v)
	if raw == "" {
		return v
	}
	parts := strings.Split(raw, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if strings.HasPrefix(strings.ToLower(t), "domain=") {
			continue
		}
		out = append(out, t)
	}
	return strings.Join(out, "; ")
}

func rewriteHTMLOrigins(html string, target *url.URL, externalOrigin string, externalWsOrigin string) string {
	if html == "" || target == nil {
		return html
	}

	extOrigin := strings.TrimSpace(externalOrigin)
	extHost := ""
	if extOrigin != "" {
		if u, err := url.Parse(extOrigin); err == nil && u != nil {
			extHost = strings.TrimSpace(u.Host)
		}
	}
	extWsOrigin := strings.TrimSpace(externalWsOrigin)

	targetHostPort := strings.TrimSpace(target.Host)
	targetHostname := strings.TrimSpace(target.Hostname())
	targetPort := strings.TrimSpace(target.Port())

	hosts := []string{targetHostPort}
	// Also rewrite the no-port variant when the target uses the default port for its scheme.
	if targetHostname != "" && targetPort != "" && targetPort == defaultPortForScheme(target.Scheme) {
		hosts = append(hosts, targetHostname)
	}

	out := html
	for _, h := range hosts {
		if h == "" {
			continue
		}
		out = strings.ReplaceAll(out, "http://"+h, extOrigin)
		out = strings.ReplaceAll(out, "https://"+h, extOrigin)
		out = strings.ReplaceAll(out, "ws://"+h, extWsOrigin)
		out = strings.ReplaceAll(out, "wss://"+h, extWsOrigin)
		if extHost != "" {
			out = strings.ReplaceAll(out, "//"+h, "//"+extHost)
		}
	}
	return out
}

func (g *Gateway) maybeRedirectCodespaceRootToWorkspace(w http.ResponseWriter, r *http.Request) bool {
	if g == nil || r == nil || g.backend == nil || r.URL == nil {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if r.URL.Path != "/" {
		return false
	}

	q := r.URL.Query()
	if strings.TrimSpace(q.Get("folder")) != "" || strings.TrimSpace(q.Get("workspace")) != "" {
		return false
	}

	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return false
	}
	codeSpaceID, ok := codeSpaceIDFromExternalHost(host)
	if !ok {
		return false
	}

	spaces, err := g.backend.ListSpaces(r.Context())
	if err != nil {
		return false
	}
	var workspacePath string
	for _, sp := range spaces {
		if sp.CodeSpaceID != codeSpaceID {
			continue
		}
		workspacePath = strings.TrimSpace(sp.WorkspacePath)
		break
	}
	if workspacePath == "" {
		return false
	}

	q.Set("folder", workspacePath)
	q.Del("workspace")

	u := &url.URL{Path: r.URL.Path, RawQuery: q.Encode()}
	http.Redirect(w, r, u.String(), http.StatusFound)
	return true
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

func channelIDFromRequest(r *http.Request) (string, error) {
	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return "", err
	}

	hostNoPort := strings.TrimSpace(host)
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	parts := strings.Split(hostNoPort, ".")
	if len(parts) < 2 {
		return "", errors.New("missing session origin label")
	}

	// Env App sessions inject a second label: "ch-<base32(channel_id)>"
	chLabel := strings.ToLower(strings.TrimSpace(parts[1]))
	if !strings.HasPrefix(chLabel, "ch-") {
		return "", errors.New("missing channel label")
	}
	enc := strings.TrimSpace(strings.TrimPrefix(chLabel, "ch-"))
	if enc == "" {
		return "", errors.New("invalid channel label")
	}

	dec, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(enc))
	if err != nil {
		return "", errors.New("invalid channel label encoding")
	}
	channelID := strings.TrimSpace(string(dec))
	if channelID == "" {
		return "", errors.New("invalid channel id")
	}
	return channelID, nil
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

func forwardIDFromExternalHost(host string) (string, bool) {
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
	if !strings.HasPrefix(firstLabel, "pf-") {
		return "", false
	}
	id := strings.TrimPrefix(firstLabel, "pf-")
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
	originRolePortForward
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
	case strings.HasPrefix(first, "pf-"):
		return originRolePortForward
	default:
		return originRoleUnknown
	}
}
