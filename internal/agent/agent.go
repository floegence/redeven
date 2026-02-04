package agent

import (
	"context"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	fsclient "github.com/floegence/flowersec/flowersec-go/client"
	"github.com/floegence/flowersec/flowersec-go/endpoint"
	"github.com/floegence/flowersec/flowersec-go/endpoint/serve"
	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/flowersec/flowersec-go/origin"
	fsproxy "github.com/floegence/flowersec/flowersec-go/proxy"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/codeapp"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/fs"
	"github.com/floegence/redeven-agent/internal/monitor"
	"github.com/floegence/redeven-agent/internal/session"
	syssvc "github.com/floegence/redeven-agent/internal/sys"
	"github.com/floegence/redeven-agent/internal/terminal"
)

const (
	controlRPCTypeRegister    uint32 = 41001
	controlRPCTypeHeartbeat   uint32 = 41002
	controlRPCTypeGrantServer uint32 = 41003 // notify
)

// Floe app ids.
const (
	FloeAppRedevenAgent = "com.floegence.redeven.agent"
	FloeAppRedevenCode  = "com.floegence.redeven.code"
)

type Options struct {
	Config *config.Config
	// ConfigPath is the path used to load the config file (used to derive state_dir).
	ConfigPath string

	Version   string
	Commit    string
	BuildTime string
}

type Agent struct {
	cfg *config.Config
	log *slog.Logger

	version   string
	commit    string
	buildTime string

	fsRoot string

	term *terminal.Manager
	mon  *monitor.Service
	sys  *syssvc.Service
	code *codeapp.Service

	mu       sync.Mutex
	sessions map[string]*activeSession // channel_id -> session
}

// activeSession represents a server-side Flowersec channel session handled by the agent.
//
// NOTE: This is an in-memory registry used for UI/auditing; it must not be used for authorization decisions.
type activeSession struct {
	cancel            context.CancelFunc
	meta              session.Meta
	tunnelURL         string // grant_server.tunnel_url (for UI/auditing only)
	connectedAtUnixMs int64  // set after ConnectTunnel succeeds
}

func New(opts Options) (*Agent, error) {
	if opts.Config == nil {
		return nil, errors.New("missing config")
	}
	if err := opts.Config.Validate(); err != nil {
		return nil, err
	}

	root := strings.TrimSpace(opts.Config.RootDir)
	if root == "" {
		home, _ := os.UserHomeDir()
		root = strings.TrimSpace(home)
	}
	if root == "" {
		root = "."
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	logger, err := newLogger(strings.TrimSpace(opts.Config.LogFormat), strings.TrimSpace(opts.Config.LogLevel))
	if err != nil {
		return nil, err
	}

	shell := strings.TrimSpace(opts.Config.Shell)
	if shell == "" {
		shell = strings.TrimSpace(os.Getenv("SHELL"))
	}
	if shell == "" {
		shell = "/bin/bash"
	}

	cfgPath := strings.TrimSpace(opts.ConfigPath)
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfgPathAbs, err := filepath.Abs(cfgPath)
	if err != nil {
		return nil, err
	}
	stateDir := filepath.Dir(cfgPathAbs)

	a := &Agent{
		cfg:       opts.Config,
		log:       logger,
		version:   strings.TrimSpace(opts.Version),
		commit:    strings.TrimSpace(opts.Commit),
		buildTime: strings.TrimSpace(opts.BuildTime),
		fsRoot:    rootAbs,
		term:      terminal.NewManager(shell, rootAbs, logger),
		mon:       monitor.NewService(logger),
		sys: syssvc.NewService(syssvc.Options{
			AgentInstanceID: opts.Config.AgentInstanceID,
			Version:         opts.Version,
			Commit:          opts.Commit,
			BuildTime:       opts.BuildTime,
		}),
		sessions: make(map[string]*activeSession),
	}

	codeSvc, err := codeapp.New(context.Background(), codeapp.Options{
		Logger:              logger,
		StateDir:            stateDir,
		ConfigPath:          cfgPathAbs,
		ControlplaneBaseURL: strings.TrimSpace(opts.Config.ControlplaneBaseURL),
		CodeServerPortMin:   opts.Config.CodeServerPortMin,
		CodeServerPortMax:   opts.Config.CodeServerPortMax,
		FSRoot:              rootAbs,
		Shell:               shell,
		AIConfig:            opts.Config.AI,
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			if a == nil {
				return nil, false
			}
			channelID = strings.TrimSpace(channelID)
			if channelID == "" {
				return nil, false
			}
			a.mu.Lock()
			s := a.sessions[channelID]
			var meta session.Meta
			if s != nil {
				meta = s.meta
			}
			a.mu.Unlock()
			if s == nil {
				return nil, false
			}
			return &meta, true
		},
	})
	if err != nil {
		return nil, fmt.Errorf("init codeapp: %w", err)
	}
	a.code = codeSvc

	return a, nil
}

func (a *Agent) Run(ctx context.Context) error {
	defer func() {
		if a != nil && a.code != nil {
			_ = a.code.Close()
		}
	}()

	a.log.Info("agent starting",
		"version", a.version,
		"commit", a.commit,
		"build_time", a.buildTime,
		"environment_id", a.cfg.EnvironmentID,
		"controlplane", a.cfg.ControlplaneBaseURL,
		"fs_root", a.fsRoot,
		"goos", runtime.GOOS,
		"goarch", runtime.GOARCH,
	)

	backoff := newBackoff()
	for {
		if ctx.Err() != nil {
			a.stopAllSessions()
			return ctx.Err()
		}

		err := a.runControlOnce(ctx)
		if ctx.Err() != nil {
			a.stopAllSessions()
			return ctx.Err()
		}
		a.log.Warn("control channel disconnected; retrying", "error", err)

		d := backoff.Next()
		timer := time.NewTimer(d)
		select {
		case <-ctx.Done():
			timer.Stop()
			a.stopAllSessions()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (a *Agent) runControlOnce(ctx context.Context) error {
	origin, err := origin.FromWSURL(a.cfg.Direct.WsUrl)
	if err != nil {
		return err
	}

	c, err := fsclient.ConnectDirect(ctx, a.cfg.Direct,
		fsclient.WithOrigin(origin),
		fsclient.WithKeepaliveInterval(15*time.Second),
	)
	if err != nil {
		return err
	}
	defer c.Close()

	rpcC := c.RPC()
	if rpcC == nil {
		return errors.New("missing rpc client")
	}

	unsub := rpcC.OnNotify(controlRPCTypeGrantServer, func(payload json.RawMessage) {
		a.handleGrantNotify(ctx, payload)
	})
	defer unsub()

	// Register (best-effort; required for server-side online state).
	_, err = rpctyped.Call[registerReq, registerResp](ctx, rpcC, controlRPCTypeRegister, &registerReq{
		EnvPublicID:     a.cfg.EnvironmentID,
		AgentInstanceID: a.cfg.AgentInstanceID,
		Version:         a.version,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		Hostname:        hostnameBestEffort(),
	})
	if err != nil {
		return err
	}

	// Heartbeat loop.
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			_, err := rpctyped.Call[heartbeatReq, heartbeatResp](ctx, rpcC, controlRPCTypeHeartbeat, &heartbeatReq{
				NowUnixMs: time.Now().UnixMilli(),
			})
			if err != nil {
				return err
			}
		}
	}
}

func (a *Agent) handleGrantNotify(ctx context.Context, payload json.RawMessage) {
	var n session.GrantServerNotify
	if err := json.Unmarshal(payload, &n); err != nil {
		a.log.Warn("invalid grant_server notify json", "error", err)
		return
	}
	if n.GrantServer == nil || n.SessionMeta == nil {
		a.log.Warn("invalid grant_server notify: missing fields")
		return
	}

	meta := n.SessionMeta
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	floeApp := strings.TrimSpace(meta.FloeApp)

	if channelID == "" || endpointID == "" || floeApp == "" {
		a.log.Warn("invalid session_meta", "channel_id", channelID, "endpoint_id", endpointID, "floe_app", floeApp)
		return
	}
	if endpointID != a.cfg.EnvironmentID {
		a.log.Warn("session_meta endpoint_id mismatch", "expected", a.cfg.EnvironmentID, "got", endpointID, "channel_id", channelID)
		return
	}
	if n.GrantServer.ChannelId != channelID {
		a.log.Warn("grant_server channel_id mismatch", "channel_id", channelID)
		return
	}
	if floeApp != FloeAppRedevenAgent && floeApp != FloeAppRedevenCode {
		a.log.Warn("unsupported floe_app; ignoring session", "floe_app", floeApp, "channel_id", channelID)
		return
	}

	// Clamp control-plane granted permissions using the local endpoint cap.
	declared := config.PermissionSet{
		Read:    meta.CanReadFiles,
		Write:   meta.CanWriteFiles,
		Execute: meta.CanExecute,
	}
	localCap := a.cfg.PermissionPolicy.ResolveCap(meta.UserPublicID, meta.FloeApp)
	effective := declared.Intersect(localCap)
	if effective != declared {
		a.log.Info("session permissions clamped by local policy",
			"channel_id", channelID,
			"user_public_id", meta.UserPublicID,
			"floe_app", meta.FloeApp,
			"declared_read", declared.Read,
			"declared_write", declared.Write,
			"declared_execute", declared.Execute,
			"cap_read", localCap.Read,
			"cap_write", localCap.Write,
			"cap_execute", localCap.Execute,
			"effective_read", effective.Read,
			"effective_write", effective.Write,
			"effective_execute", effective.Execute,
		)
	}
	meta.CanReadFiles = effective.Read
	meta.CanWriteFiles = effective.Write
	meta.CanExecute = effective.Execute

	// Code App security: code-server is a "full environment" capability.
	// We currently require read+write+execute to avoid misleading permission splits.
	if meta.FloeApp == FloeAppRedevenCode {
		csID := strings.TrimSpace(meta.CodeSpaceID)
		if csID == "" {
			a.log.Warn("missing code_space_id for code app session", "channel_id", channelID)
			return
		}
		if !codeapp.IsValidCodeSpaceID(csID) {
			a.log.Warn("invalid code_space_id for code app session", "code_space_id", csID, "channel_id", channelID)
			return
		}
		if !meta.CanReadFiles || !meta.CanWriteFiles || !meta.CanExecute {
			a.log.Warn("insufficient permissions for code app session; ignoring",
				"channel_id", channelID,
				"user_public_id", meta.UserPublicID,
				"code_space_id", csID,
				"can_read_files", meta.CanReadFiles,
				"can_write_files", meta.CanWriteFiles,
				"can_execute", meta.CanExecute,
			)
			return
		}
	}

	// Freeze the metadata snapshot used for auditing/UI and for the session runtime.
	metaCopy := *meta

	a.mu.Lock()
	if _, ok := a.sessions[channelID]; ok {
		a.mu.Unlock()
		// Idempotency: ignore duplicate notify for the same channel.
		return
	}
	sessCtx, cancel := context.WithCancel(ctx)
	a.sessions[channelID] = &activeSession{
		cancel:    cancel,
		meta:      metaCopy,
		tunnelURL: strings.TrimSpace(n.GrantServer.TunnelUrl),
	}
	a.mu.Unlock()

	go func(meta *session.Meta) {
		defer func() {
			a.mu.Lock()
			delete(a.sessions, channelID)
			a.mu.Unlock()
		}()
		_ = a.runDataSession(sessCtx, n.GrantServer, meta)
	}(&metaCopy)
}

func (a *Agent) runDataSession(ctx context.Context, grant *controlv1.ChannelInitGrant, meta *session.Meta) (err error) {
	if grant == nil || meta == nil {
		return errors.New("missing grant/meta")
	}

	opened := false
	startedAt := time.Now()
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	floeApp := strings.TrimSpace(meta.FloeApp)
	codeSpaceID := strings.TrimSpace(meta.CodeSpaceID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	userEmail := strings.TrimSpace(meta.UserEmail)
	defer func() {
		reason := "eof"
		if !opened {
			reason = "connect_failed"
		}
		if errors.Is(err, context.Canceled) {
			reason = "canceled"
		} else if err != nil {
			reason = "error"
		}

		attrs := []any{
			"channel_id", channelID,
			"env_public_id", endpointID,
			"floe_app", floeApp,
			"code_space_id", codeSpaceID,
			"user_public_id", userPublicID,
			"user_email", userEmail,
			"opened", opened,
			"reason", reason,
			"duration_ms", time.Since(startedAt).Milliseconds(),
		}
		if reason == "error" {
			a.log.Warn("data session closed", append(attrs, "error", err)...)
			return
		}
		a.log.Info("data session closed", attrs...)
	}()

	origin, err := origin.ForTunnel(grant.TunnelUrl, a.cfg.ControlplaneBaseURL)
	if err != nil {
		return err
	}

	sess, err := endpoint.ConnectTunnel(ctx, grant,
		endpoint.WithOrigin(origin),
	)
	if err != nil {
		return err
	}
	opened = true

	connectedAtUnixMs := time.Now().UnixMilli()
	a.markSessionConnected(channelID, connectedAtUnixMs)

	a.log.Info("data session opened",
		"channel_id", channelID,
		"env_public_id", endpointID,
		"floe_app", floeApp,
		"code_space_id", codeSpaceID,
		"user_public_id", userPublicID,
		"user_email", userEmail,
		"connected_at_unix_ms", connectedAtUnixMs,
	)
	defer sess.Close()

	if strings.TrimSpace(meta.FloeApp) == FloeAppRedevenCode {
		return a.serveCodeAppSession(ctx, sess, meta)
	}

	return a.serveRedevenAgentSession(ctx, sess, meta)
}

func (a *Agent) serveCodeAppSession(ctx context.Context, sess endpoint.Session, meta *session.Meta) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}
	if a.code == nil {
		return errors.New("codeapp not initialized")
	}

	codeSpaceID := strings.TrimSpace(meta.CodeSpaceID)
	if codeSpaceID == "" {
		return errors.New("missing code_space_id")
	}

	origin, err := a.code.ExternalOriginForCodeSpace(codeSpaceID)
	if err != nil {
		return err
	}

	// Ensure the code-server instance is running before accepting proxy streams.
	if _, err := a.code.ResolveCodeServerPort(ctx, codeSpaceID); err != nil {
		return err
	}

	up := strings.TrimSpace(a.code.GatewayURL())
	if up == "" {
		return errors.New("codeapp gateway not ready")
	}

	srv, err := serve.New(serve.Options{
		OnError: func(err error) {
			if err == nil {
				return
			}
			a.log.Warn("codeapp stream error", "channel_id", meta.ChannelID, "code_space_id", codeSpaceID, "error", err)
		},
	})
	if err != nil {
		return err
	}

	if err := fsproxy.Register(srv, fsproxy.Options{
		Upstream:       up,
		UpstreamOrigin: origin,
	}); err != nil {
		return err
	}

	return srv.ServeSession(ctx, sess)
}

func (a *Agent) serveRedevenAgentSession(ctx context.Context, sess endpoint.Session, meta *session.Meta) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}

	fsSvc := fs.NewService(a.fsRoot)

	srv, err := serve.New(serve.Options{
		OnError: func(err error) {
			if err == nil {
				return
			}
			a.log.Warn("agent stream error", "channel_id", meta.ChannelID, "floe_app", meta.FloeApp, "code_space_id", meta.CodeSpaceID, "error", err)
		},
	})
	if err != nil {
		return err
	}

	// RPC stream
	srv.Handle("rpc", func(ctx context.Context, stream io.ReadWriteCloser) {
		a.serveRPCStream(ctx, stream, meta, fsSvc)
	})

	// FS read-file stream (binary, chunked)
	srv.Handle("fs/read_file", func(ctx context.Context, stream io.ReadWriteCloser) {
		fsSvc.ServeReadFileStream(ctx, stream, meta)
	})

	// Env App UI static assets are delivered over flowersec-proxy (runtime mode).
	// Only enable the proxy handler for the reserved Env App codespace_id to avoid
	// unintentionally exposing it to legacy region UIs.
	if strings.TrimSpace(meta.CodeSpaceID) == "env-ui" {
		up := strings.TrimSpace(a.code.GatewayURL())
		if up == "" {
			return errors.New("codeapp gateway not ready")
		}
		baseOrigin, err := a.code.ExternalOriginForEnvApp(meta.EndpointID)
		if err != nil {
			return err
		}
		origin, err := originWithChannelLabel(baseOrigin, meta.ChannelID)
		if err != nil {
			return err
		}
		if err := fsproxy.Register(srv, fsproxy.Options{
			Upstream:       up,
			UpstreamOrigin: origin,
		}); err != nil {
			return err
		}
	}

	return srv.ServeSession(ctx, sess)
}

func (a *Agent) serveRPCStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, fsSvc *fs.Service) {
	router := rpc.NewRouter()
	srv := rpc.NewServer(stream, router)
	defer a.term.DetachSink(srv)

	// Sys domain (health checks).
	a.sys.Register(router, meta)

	// FS domain
	fsSvc.Register(router, meta)

	// Terminal domain
	a.term.Register(router, meta, srv)

	// Monitor domain
	a.mon.Register(router, meta)

	// Sessions domain (active Flowersec channel sessions).
	a.registerSessionsRPC(router, meta)

	_ = srv.Serve(ctx)
}

func (a *Agent) markSessionConnected(channelID string, connectedAtUnixMs int64) {
	if a == nil {
		return
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.sessions[channelID]
	if s == nil {
		return
	}
	if connectedAtUnixMs > 0 {
		s.connectedAtUnixMs = connectedAtUnixMs
	}
}

func (a *Agent) stopAllSessions() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, s := range a.sessions {
		if s == nil || s.cancel == nil {
			continue
		}
		s.cancel()
	}
	a.sessions = make(map[string]*activeSession)
}

func hostnameBestEffort() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(h)
}

func originWithChannelLabel(baseOrigin string, channelID string) (string, error) {
	baseOrigin = strings.TrimSpace(baseOrigin)
	channelID = strings.TrimSpace(channelID)
	if baseOrigin == "" || channelID == "" {
		return "", errors.New("invalid origin args")
	}

	u, err := url.Parse(baseOrigin)
	if err != nil || u == nil {
		return "", errors.New("invalid base origin")
	}
	host := strings.TrimSpace(u.Host)
	if host == "" {
		return "", errors.New("invalid base origin host")
	}

	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return "", errors.New("invalid base origin host")
	}

	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(channelID))
	enc = strings.ToLower(strings.TrimSpace(enc))
	if enc == "" {
		return "", errors.New("invalid channel id")
	}

	// Insert as the second label: env-xxx.ch-<enc>.<rest>.
	out := make([]string, 0, len(labels)+1)
	out = append(out, labels[0], "ch-"+enc)
	out = append(out, labels[1:]...)
	u.Host = strings.Join(out, ".")
	return u.String(), nil
}

// --- control channel types (wire JSON) ---

type registerReq struct {
	EnvPublicID     string `json:"env_public_id,omitempty"`
	AgentInstanceID string `json:"agent_instance_id,omitempty"`
	Version         string `json:"version,omitempty"`
	OS              string `json:"os,omitempty"`
	Arch            string `json:"arch,omitempty"`
	Hostname        string `json:"hostname,omitempty"`
}

type registerResp struct {
	OK bool `json:"ok"`
}

type heartbeatReq struct {
	NowUnixMs int64 `json:"now_unix_ms,omitempty"`
}

type heartbeatResp struct {
	OK bool `json:"ok"`
}

// --- helper: backoff ---

type backoff struct {
	attempt int
}

func newBackoff() *backoff { return &backoff{} }

func (b *backoff) Next() time.Duration {
	// 250ms, 450ms, 810ms, ... capped at 10s
	if b.attempt < 0 {
		b.attempt = 0
	}
	base := 250 * time.Millisecond
	d := time.Duration(float64(base) * pow(1.8, b.attempt))
	b.attempt++
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	return d
}

func pow(base float64, exp int) float64 {
	out := 1.0
	for i := 0; i < exp; i++ {
		out *= base
	}
	return out
}

// --- logger ---

func newLogger(format string, level string) (*slog.Logger, error) {
	var h slog.Handler

	var lvl slog.Level
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "", "info":
		lvl = slog.LevelInfo
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		return nil, fmt.Errorf("unknown log level: %s", level)
	}

	opts := &slog.HandlerOptions{Level: lvl}

	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "json":
		h = slog.NewJSONHandler(os.Stdout, opts)
	case "text":
		h = slog.NewTextHandler(os.Stdout, opts)
	default:
		return nil, fmt.Errorf("unknown log format: %s", format)
	}

	return slog.New(h), nil
}
