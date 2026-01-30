package agent

import (
	"context"
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
	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/fs"
	"github.com/floegence/redeven-agent/internal/monitor"
	"github.com/floegence/redeven-agent/internal/session"
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
)

type Options struct {
	Config *config.Config

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

	mu       sync.Mutex
	sessions map[string]context.CancelFunc // channel_id -> cancel
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

	return &Agent{
		cfg:       opts.Config,
		log:       logger,
		version:   strings.TrimSpace(opts.Version),
		commit:    strings.TrimSpace(opts.Commit),
		buildTime: strings.TrimSpace(opts.BuildTime),
		fsRoot:    rootAbs,
		term:      terminal.NewManager(shell, rootAbs, logger),
		mon:       monitor.NewService(logger),
		sessions:  make(map[string]context.CancelFunc),
	}, nil
}

func (a *Agent) Run(ctx context.Context) error {
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
	origin, err := originFromWSURL(a.cfg.Direct.WsUrl)
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
	if floeApp != FloeAppRedevenAgent {
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

	a.mu.Lock()
	if _, ok := a.sessions[channelID]; ok {
		a.mu.Unlock()
		// Idempotency: ignore duplicate notify for the same channel.
		return
	}
	sessCtx, cancel := context.WithCancel(ctx)
	a.sessions[channelID] = cancel
	a.mu.Unlock()

	go func() {
		defer func() {
			a.mu.Lock()
			delete(a.sessions, channelID)
			a.mu.Unlock()
		}()
		if err := a.runDataSession(sessCtx, n.GrantServer, meta); err != nil && !errors.Is(err, context.Canceled) {
			a.log.Warn("data session ended", "channel_id", channelID, "error", err)
		}
	}()
}

func (a *Agent) runDataSession(ctx context.Context, grant *controlv1.ChannelInitGrant, meta *session.Meta) error {
	if grant == nil || meta == nil {
		return errors.New("missing grant/meta")
	}

	origin, err := originForTunnel(grant.TunnelUrl, a.cfg.ControlplaneBaseURL)
	if err != nil {
		return err
	}

	sess, err := endpoint.ConnectTunnel(ctx, grant,
		endpoint.WithOrigin(origin),
	)
	if err != nil {
		return err
	}
	defer sess.Close()

	fsSvc := fs.NewService(a.fsRoot)

	// One yamux session may carry multiple streams (rpc/others).
	return sess.ServeStreams(ctx, endpoint.DefaultMaxStreamHelloBytes, func(kind string, stream io.ReadWriteCloser) {
		switch kind {
		case "rpc":
			a.serveRPCStream(ctx, stream, meta, fsSvc)
		case "fs/read_file":
			fsSvc.ServeReadFileStream(ctx, stream, meta)
		default:
			// Unknown stream kind: close immediately.
			_ = stream.Close()
		}
	})
}

func (a *Agent) serveRPCStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, fsSvc *fs.Service) {
	router := rpc.NewRouter()
	srv := rpc.NewServer(stream, router)
	defer a.term.DetachSink(srv)

	// FS domain
	fsSvc.Register(router, meta)

	// Terminal domain
	a.term.Register(router, meta, srv)

	// Monitor domain
	a.mon.Register(router, meta)

	_ = srv.Serve(ctx)
}

func (a *Agent) stopAllSessions() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, cancel := range a.sessions {
		cancel()
	}
	a.sessions = make(map[string]context.CancelFunc)
}

func hostnameBestEffort() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(h)
}

func originFromWSURL(wsURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(u.Host) == "" {
		return "", errors.New("ws url missing host")
	}
	switch strings.ToLower(strings.TrimSpace(u.Scheme)) {
	case "wss":
		return "https://" + u.Host, nil
	case "ws":
		return "http://" + u.Host, nil
	default:
		return "", fmt.Errorf("unsupported ws scheme: %s", u.Scheme)
	}
}

func originForTunnel(tunnelURL string, controlplaneBaseURL string) (string, error) {
	// Prefer controlplane origin for consistent policy across official/custom tunnels.
	if strings.TrimSpace(controlplaneBaseURL) != "" {
		u, err := url.Parse(strings.TrimSpace(controlplaneBaseURL))
		if err == nil && strings.TrimSpace(u.Host) != "" {
			scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
			if scheme == "http" || scheme == "https" {
				return scheme + "://" + u.Host, nil
			}
		}
	}
	// Fall back to tunnel host.
	return originFromWSURL(tunnelURL)
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
