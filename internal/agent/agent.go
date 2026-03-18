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
	"sync/atomic"
	"time"

	fsclient "github.com/floegence/flowersec/flowersec-go/client"
	"github.com/floegence/flowersec/flowersec-go/endpoint"
	"github.com/floegence/flowersec/flowersec-go/endpoint/serve"
	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/flowersec/flowersec-go/origin"
	fsproxy "github.com/floegence/flowersec/flowersec-go/proxy"
	fsproxyprofile "github.com/floegence/flowersec/flowersec-go/proxy/profile"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/accessproxy"
	"github.com/floegence/redeven-agent/internal/accessrpc"
	"github.com/floegence/redeven-agent/internal/auditlog"
	"github.com/floegence/redeven-agent/internal/codeapp"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/diagnostics"
	"github.com/floegence/redeven-agent/internal/fs"
	"github.com/floegence/redeven-agent/internal/gitrepo"
	"github.com/floegence/redeven-agent/internal/monitor"
	"github.com/floegence/redeven-agent/internal/pathutil"
	"github.com/floegence/redeven-agent/internal/portforward"
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
	// FloeAppRedevenPortForward proxies an arbitrary HTTP service reachable from the agent.
	FloeAppRedevenPortForward = "com.floegence.redeven.portforward"
)

const (
	maintenanceOpNone    int32 = 0
	maintenanceOpUpgrade int32 = 1
	maintenanceOpRestart int32 = 2
)

type Options struct {
	Config *config.Config
	// ConfigPath is the path used to load the config file (used to derive state_dir).
	ConfigPath string
	// LocalUIEnabled indicates Local UI is enabled (e.g. `redeven run --mode hybrid|local`).
	//
	// When enabled, the agent is allowed to start even without a full bootstrap config.
	LocalUIEnabled bool
	// ControlChannelEnabled indicates whether the agent should connect to the Region Center control channel.
	//
	// In Local mode, this should be false even when the config is fully bootstrapped.
	ControlChannelEnabled bool
	// DesktopManaged disables CLI self-upgrade behaviors that do not apply when the
	// agent lifecycle is owned by a desktop shell package.
	DesktopManaged bool

	Version   string
	Commit    string
	BuildTime string

	// OnControlConnected is called once after the agent successfully connects to the
	// remote control channel and completes the initial register call.
	//
	// This hook is intended for CLI UX (e.g., printing the environment access URL)
	// and must not be used for authorization decisions.
	OnControlConnected func()

	AccessGate *accessgate.Gate
}

type Agent struct {
	cfg *config.Config
	log *slog.Logger

	audit *auditlog.Store
	diag  *diagnostics.Store

	version   string
	commit    string
	buildTime string

	agentHomeAbs string

	term *terminal.Manager
	mon  *monitor.Service
	sys  *syssvc.Service
	code *codeapp.Service

	maintenance atomic.Int32

	mu       sync.Mutex
	sessions map[string]*activeSession // channel_id -> session

	controlConnectedOnce sync.Once
	onControlConnected   func()

	localUIEnabled        bool
	controlChannelEnabled bool
	desktopManaged        bool
	accessGate            *accessgate.Gate
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
	if err := opts.Config.ValidateLocalMinimal(); err != nil {
		return nil, err
	}

	agentHomeDir := strings.TrimSpace(opts.Config.AgentHomeDir)
	if agentHomeDir == "" {
		home, _ := os.UserHomeDir()
		agentHomeDir = strings.TrimSpace(home)
	}
	if agentHomeDir == "" {
		return nil, errors.New("missing agent home dir")
	}
	agentHomeAbs, err := pathutil.CanonicalizeExistingDirAbs(agentHomeDir)
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
		cfg:                   opts.Config,
		log:                   logger,
		version:               strings.TrimSpace(opts.Version),
		commit:                strings.TrimSpace(opts.Commit),
		buildTime:             strings.TrimSpace(opts.BuildTime),
		agentHomeAbs:          agentHomeAbs,
		term:                  terminal.NewManager(shell, agentHomeAbs, logger),
		mon:                   monitor.NewService(logger),
		sessions:              make(map[string]*activeSession),
		onControlConnected:    opts.OnControlConnected,
		localUIEnabled:        opts.LocalUIEnabled,
		controlChannelEnabled: opts.ControlChannelEnabled,
		desktopManaged:        opts.DesktopManaged,
		accessGate:            opts.AccessGate,
	}

	auditStore, err := auditlog.New(auditlog.Options{Logger: logger, StateDir: stateDir})
	if err != nil {
		// Best-effort: agent must keep running even if audit logging is unavailable.
		logger.Warn("audit log init failed", "error", err)
	} else {
		a.audit = auditStore
	}
	if diagnostics.EnabledForLogLevel(opts.Config.LogLevel) {
		diagnosticsStore, err := diagnostics.New(diagnostics.Options{Logger: logger, StateDir: stateDir, Source: diagnostics.SourceAgent})
		if err != nil {
			logger.Warn("diagnostics init failed", "error", err)
		} else {
			a.diag = diagnosticsStore
		}
	}
	var upgrader syssvc.Upgrader
	if !a.desktopManaged {
		upgrader = &sysUpgrader{a: a}
	}
	a.sys = syssvc.NewService(syssvc.Options{
		AgentInstanceID: opts.Config.AgentInstanceID,
		Version:         opts.Version,
		Commit:          opts.Commit,
		BuildTime:       opts.BuildTime,
		Upgrader:        upgrader,
		Restarter:       &sysRestarter{a: a},
	})

	codeSvc, err := codeapp.New(context.Background(), codeapp.Options{
		Logger:              logger,
		StateDir:            stateDir,
		ConfigPath:          cfgPathAbs,
		ControlplaneBaseURL: strings.TrimSpace(opts.Config.ControlplaneBaseURL),
		CodeServerPortMin:   opts.Config.CodeServerPortMin,
		CodeServerPortMax:   opts.Config.CodeServerPortMax,
		AgentHomeDir:        agentHomeAbs,
		Shell:               shell,
		AIConfig:            opts.Config.AI,
		Audit:               auditStore,
		Diagnostics:         a.diag,
		LocalUIEnabled:      a.localUIEnabled,
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
		ResolveSessionTunnelURL: func(channelID string) (string, bool) {
			if a == nil {
				return "", false
			}
			channelID = strings.TrimSpace(channelID)
			if channelID == "" {
				return "", false
			}
			a.mu.Lock()
			s := a.sessions[channelID]
			var tunnelURL string
			if s != nil {
				tunnelURL = s.tunnelURL
			}
			a.mu.Unlock()
			if s == nil {
				return "", false
			}
			return strings.TrimSpace(tunnelURL), true
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
		"agent_home_abs", a.agentHomeAbs,
		"goos", runtime.GOOS,
		"goarch", runtime.GOARCH,
	)

	if !a.controlChannelEnabled {
		a.log.Info("control channel disabled; running without remote connection")
		<-ctx.Done()
		a.stopAllSessions()
		return ctx.Err()
	}

	if a.cfg == nil {
		return errors.New("missing config")
	}
	if err := a.cfg.ValidateRemoteStrict(); err != nil {
		return err
	}

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

	a.controlConnectedOnce.Do(func() {
		if a.onControlConnected != nil {
			a.onControlConnected()
		}
	})

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
	if a != nil && a.maintenance.Load() != maintenanceOpNone {
		a.log.Debug("maintenance in progress; ignoring grant_server notify", "op", a.maintenance.Load())
		return
	}

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
	if floeApp != FloeAppRedevenAgent && floeApp != FloeAppRedevenCode && floeApp != FloeAppRedevenPortForward {
		a.log.Warn("unsupported floe_app; ignoring session", "floe_app", floeApp, "channel_id", channelID)
		return
	}

	// Clamp control-plane granted permissions using the local endpoint cap.
	declared := config.PermissionSet{
		Read:    meta.CanRead,
		Write:   meta.CanWrite,
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
	meta.CanRead = effective.Read
	meta.CanWrite = effective.Write
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
		if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			a.log.Warn("insufficient permissions for code app session; ignoring",
				"channel_id", channelID,
				"user_public_id", meta.UserPublicID,
				"code_space_id", csID,
				"can_read", meta.CanRead,
				"can_write", meta.CanWrite,
				"can_execute", meta.CanExecute,
			)
			return
		}
	}

	// Port Forward security: forwarding arbitrary HTTP traffic is an execute-like capability.
	if meta.FloeApp == FloeAppRedevenPortForward {
		forwardID := strings.TrimSpace(meta.CodeSpaceID)
		if forwardID == "" {
			a.log.Warn("missing forward_id for port forward session", "channel_id", channelID)
			return
		}
		if !portforward.IsValidForwardID(forwardID) {
			a.log.Warn("invalid forward_id for port forward session", "forward_id", forwardID, "channel_id", channelID)
			return
		}
		if !meta.CanExecute {
			a.log.Warn("insufficient permissions for port forward session; ignoring",
				"channel_id", channelID,
				"user_public_id", meta.UserPublicID,
				"forward_id", forwardID,
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

	if a.accessGate != nil && a.accessGate.Enabled() {
		a.accessGate.RegisterChannel(metaCopy)
	}

	go func(meta *session.Meta) {
		defer func() {
			if a.accessGate != nil && a.accessGate.Enabled() {
				a.accessGate.UnregisterChannel(channelID)
			}
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
	connectedAtUnixMs := int64(0)
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	floeApp := strings.TrimSpace(meta.FloeApp)
	codeSpaceID := strings.TrimSpace(meta.CodeSpaceID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	userEmail := strings.TrimSpace(meta.UserEmail)
	tunnelURL := strings.TrimSpace(grant.TunnelUrl)
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
		} else {
			a.log.Info("data session closed", attrs...)
		}

		if a != nil && a.audit != nil {
			status := "success"
			if reason == "error" || reason == "connect_failed" {
				status = "failure"
			}
			action := "session_closed"
			if !opened {
				if reason == "canceled" {
					action = "session_open_canceled"
				} else {
					action = "session_open_failed"
				}
			}
			errText := ""
			if status == "failure" && err != nil {
				errText = strings.TrimSpace(err.Error())
				errText = strings.ReplaceAll(errText, "\r", " ")
				errText = strings.ReplaceAll(errText, "\n", " ")
				if len(errText) > 240 {
					errText = errText[:240] + "..."
				}
			}

			detail := map[string]any{
				"reason":      reason,
				"duration_ms": time.Since(startedAt).Milliseconds(),
			}
			if connectedAtUnixMs > 0 {
				detail["connected_at_unix_ms"] = connectedAtUnixMs
			}

			a.audit.Append(auditlog.Entry{
				Action:            action,
				Status:            status,
				Error:             errText,
				ChannelID:         channelID,
				EnvPublicID:       endpointID,
				NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
				UserPublicID:      userPublicID,
				UserEmail:         userEmail,
				FloeApp:           floeApp,
				SessionKind:       strings.TrimSpace(meta.SessionKind),
				CodeSpaceID:       codeSpaceID,
				TunnelURL:         tunnelURL,
				CanRead:           meta.CanRead,
				CanWrite:          meta.CanWrite,
				CanExecute:        meta.CanExecute,
				CanAdmin:          meta.CanAdmin,
				Detail:            detail,
			})
		}
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

	connectedAtUnixMs = time.Now().UnixMilli()
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

	if a != nil && a.audit != nil {
		a.audit.Append(auditlog.Entry{
			Action:            "session_opened",
			Status:            "success",
			ChannelID:         channelID,
			EnvPublicID:       endpointID,
			NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
			UserPublicID:      userPublicID,
			UserEmail:         userEmail,
			FloeApp:           floeApp,
			SessionKind:       strings.TrimSpace(meta.SessionKind),
			CodeSpaceID:       codeSpaceID,
			TunnelURL:         tunnelURL,
			CanRead:           meta.CanRead,
			CanWrite:          meta.CanWrite,
			CanExecute:        meta.CanExecute,
			CanAdmin:          meta.CanAdmin,
			Detail: map[string]any{
				"connected_at_unix_ms": connectedAtUnixMs,
			},
		})
	}
	defer sess.Close()

	switch strings.TrimSpace(meta.FloeApp) {
	case FloeAppRedevenCode:
		return a.serveCodeAppSession(ctx, sess, meta)
	case FloeAppRedevenPortForward:
		return a.servePortForwardSession(ctx, sess, meta)
	default:
		return a.serveRedevenAgentSession(ctx, sess, meta)
	}
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

	up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
	if err != nil {
		return err
	}
	defer cleanupUpstream()

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

	proxyOpts := fsproxyprofile.Apply(fsproxy.Options{
		Upstream:       up,
		UpstreamOrigin: origin,
	}, fsproxyprofile.ProfileCodeServer)
	if err := fsproxy.Register(srv, proxyOpts); err != nil {
		return err
	}

	return srv.ServeSession(ctx, sess)
}

func (a *Agent) servePortForwardSession(ctx context.Context, sess endpoint.Session, meta *session.Meta) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}
	if a.code == nil {
		return errors.New("codeapp not initialized")
	}
	if !meta.CanExecute {
		return errors.New("execute permission required")
	}

	forwardID := strings.TrimSpace(meta.CodeSpaceID)
	if forwardID == "" {
		return errors.New("missing forward_id")
	}

	origin, err := a.code.ExternalOriginForPortForward(forwardID)
	if err != nil {
		return err
	}

	up := strings.TrimSpace(a.code.GatewayURL())
	if up == "" {
		return errors.New("codeapp gateway not ready")
	}

	up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
	if err != nil {
		return err
	}
	defer cleanupUpstream()

	srv, err := serve.New(serve.Options{
		OnError: func(err error) {
			if err == nil {
				return
			}
			a.log.Warn("portforward stream error", "channel_id", meta.ChannelID, "forward_id", forwardID, "error", err)
		},
	})
	if err != nil {
		return err
	}

	proxyOpts := fsproxyprofile.Apply(fsproxy.Options{
		Upstream:       up,
		UpstreamOrigin: origin,
	}, fsproxyprofile.ProfileCodeServer)
	if err := fsproxy.Register(srv, proxyOpts); err != nil {
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

	fsSvc := fs.NewService(a.agentHomeAbs)
	gitRepoSvc := gitrepo.NewService(a.agentHomeAbs)

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
		a.serveRPCStream(ctx, stream, meta, fsSvc, gitRepoSvc)
	})

	// FS read-file stream (binary, chunked)
	srv.Handle("fs/read_file", func(ctx context.Context, stream io.ReadWriteCloser) {
		fsSvc.ServeReadFileStreamWithAccessGate(ctx, stream, meta, a.accessGate)
	})

	// Env App UI static assets are delivered over flowersec-proxy (Standard Mode only).
	// Only enable the proxy handler for the reserved Env App code_space_id, and only when the
	// session targets the bootstrapped Region environment.
	//
	// Local UI uses a fixed env_public_id (env_local) and serves assets over the local HTTP server.
	envID := ""
	if a.cfg != nil {
		envID = strings.TrimSpace(a.cfg.EnvironmentID)
	}
	if strings.TrimSpace(meta.CodeSpaceID) == "env-ui" && envID != "" && strings.TrimSpace(meta.EndpointID) == envID {
		up := strings.TrimSpace(a.code.GatewayURL())
		if up == "" {
			return errors.New("codeapp gateway not ready")
		}
		up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
		if err != nil {
			return err
		}
		defer cleanupUpstream()
		baseOrigin, err := a.code.ExternalOriginForEnvApp(meta.EndpointID)
		if err != nil {
			return err
		}
		origin, err := originWithChannelLabel(baseOrigin, meta.ChannelID)
		if err != nil {
			return err
		}
		proxyOpts := fsproxyprofile.Apply(fsproxy.Options{
			Upstream:       up,
			UpstreamOrigin: origin,
		}, fsproxyprofile.ProfileCodeServer)
		if err := fsproxy.Register(srv, proxyOpts); err != nil {
			return err
		}
	}

	return srv.ServeSession(ctx, sess)
}

func (a *Agent) serveRPCStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, fsSvc *fs.Service, gitRepoSvc *gitrepo.Service) {
	router := rpc.NewRouter()
	srv := rpc.NewServer(stream, router)
	defer a.term.DetachSink(srv)

	accessrpc.New(a.accessGate).Register(router, meta)

	// Sys domain (health checks).
	a.sys.RegisterWithAccessGate(router, meta, a.accessGate)

	// FS domain
	fsSvc.RegisterWithAccessGate(router, meta, a.accessGate)

	// Git repository domain
	gitRepoSvc.RegisterWithAccessGate(router, meta, a.accessGate)

	// Terminal domain
	a.term.RegisterWithAccessGate(router, meta, srv, a.accessGate)

	// Monitor domain
	a.mon.RegisterWithAccessGate(router, meta, a.accessGate)

	if a.code != nil {
		if aiSvc := a.code.AI(); aiSvc != nil {
			defer aiSvc.DetachRealtimeSink(srv)
			aiSvc.RegisterRPCWithAccessGate(router, meta, srv, a.accessGate)
		}
	}

	// Sessions domain (active Flowersec channel sessions).
	a.registerSessionsRPCWithAccessGate(router, meta, a.accessGate)

	_ = srv.Serve(ctx)
}

func (a *Agent) prepareAccessProxyUpstream(ctx context.Context, meta *session.Meta, upstream string) (string, func(), error) {
	if a == nil {
		return upstream, func() {}, nil
	}
	proxy, err := accessproxy.New(accessproxy.Options{
		Logger:   a.log,
		Gate:     a.accessGate,
		Meta:     *meta,
		Upstream: upstream,
	})
	if err != nil {
		return "", nil, err
	}
	if err := proxy.Start(ctx); err != nil {
		return "", nil, err
	}
	return strings.TrimSpace(proxy.URL()), func() { _ = proxy.Close() }, nil
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
