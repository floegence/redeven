package gateway

import (
	"bytes"
	"context"
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
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
)

type Options struct {
	Logger     *slog.Logger
	ListenAddr string
	DistFS     fs.FS
	Backend    Backend
	AI         *ai.Service
	// ConfigPath is the absolute path to the agent config file.
	// It is used to read and persist settings updates initiated from the Env App UI.
	ConfigPath string
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
	ai      *ai.Service

	configPath string
	configMu   sync.Mutex

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
		log:        logger,
		backend:    opts.Backend,
		ai:         opts.AI,
		configPath: strings.TrimSpace(opts.ConfigPath),
		distFS:     opts.DistFS,
		dist:       dist,
		addr:       addr,
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
	if originRole == originRoleCodeSpace {
		if g.maybeRedirectCodespaceRootToWorkspace(w, r) {
			return
		}
	}

	// Default: proxy to code-server (per-code-space).
	g.handleCodeServerProxy(w, r)
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

func toSettingsView(cfg *config.Config, configPath string) settingsView {
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

func (g *Gateway) handleAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/settings":
		cfg, err := g.loadConfigLocked()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: toSettingsView(cfg, g.configPath)})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/settings":
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
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			err = g.ai.UpdateConfig(nextAI, persist)
		} else {
			err = persist()
		}
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, ai.ErrConfigLocked) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: toSettingsView(updated, g.configPath)})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/models":
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

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/runs":
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID, err := channelIDFromRequest(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if g.ai.HasActiveRun(channelID) {
			writeJSON(w, http.StatusConflict, apiResp{OK: false, Error: "run already active"})
			return
		}

		var req ai.RunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
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
		if err := g.ai.StartRun(r.Context(), channelID, runID, req, w); err != nil {
			g.log.Warn("ai run failed", "channel_id", channelID, "run_id", runID, "error", err)
		}
		return

	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/runs/"):
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID, err := channelIDFromRequest(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
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
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
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
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/uploads":
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
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/uploads/"):
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
