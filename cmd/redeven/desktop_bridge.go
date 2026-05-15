package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/localui"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

type bridgeRuntime struct {
	localUI     *localui.Server
	localUILn   net.Listener
	controlLn   net.Listener
	localUIURL  string
	controlURL  string
	closeCancel context.CancelFunc
}

func (c *cli) desktopBridgeCmd(args []string) int {
	fs := newCLIFlagSet("desktop-bridge")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	password := fs.String("password", "", "Access password for the Local UI.")
	passwordEnv := fs.String("password-env", "", "Environment variable name holding the access password.")
	passwordFile := fs.String("password-file", "", "File path holding the access password.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flagErrHelp()) {
			writeText(c.stdout, desktopBridgeHelpText())
			return 0
		}
		message, details := translateFlagParseError("desktop-bridge", err)
		writeErrorWithHelp(c.stderr, message, details, desktopBridgeHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-bridge` does not accept positional arguments", nil, desktopBridgeHelpText())
		return 2
	}
	runtime, err := c.prepareDesktopBridgeRuntime(*stateRoot, *password, *passwordEnv, *passwordFile)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	defer runtime.close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime.closeCancel = cancel

	controlEndpoint := runtime.localUI.RuntimeControlEndpointForDesktopBridge()
	bridge := desktopbridge.Server{
		DialSurface: desktopbridge.NewURLSurfaceDialer(runtime.localUIURL, runtime.controlURL),
		Hello: desktopbridge.Hello{
			RuntimeVersion: Version,
			RuntimeCommit:  Commit,
			LocalUI: desktopbridge.HelloLocalUI{
				Available: true,
				BasePath:  "/",
			},
			RuntimeControl: desktopbridge.RuntimeControl{
				Available:       controlEndpoint != nil,
				ProtocolVersion: endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.ProtocolVersion }),
				BaseURL:         "bridge://runtime-control",
				Token:           endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.Token }),
				DesktopOwnerID:  endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.DesktopOwnerID }),
			},
			RuntimeService: runtime.localUI.RuntimeServiceSnapshotForDesktopBridge(),
		},
		OnShutdown: cancel,
	}
	if err := bridge.Serve(ctx, c.stdin, c.stdout); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	return 0
}

func endpointString(endpoint *localuiruntime.RuntimeControlEndpoint, read func(localuiruntime.RuntimeControlEndpoint) string) string {
	if endpoint == nil {
		return ""
	}
	return strings.TrimSpace(read(*endpoint))
}

func (c *cli) prepareDesktopBridgeRuntime(stateRoot string, password string, passwordEnv string, passwordFile string) (*bridgeRuntime, error) {
	stateLayout, err := resolveRunStateLayout(stateRoot)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(stateLayout.StateDir, 0o700); err != nil {
		return nil, fmt.Errorf("init state dir: %w", err)
	}
	cfg, err := config.Load(stateLayout.ConfigPath)
	if err != nil {
		if os.IsNotExist(err) {
			p, parseErr := config.ParsePermissionPolicyPreset("")
			if parseErr != nil {
				return nil, parseErr
			}
			cfg = &config.Config{
				PermissionPolicy: p,
				LogFormat:        "json",
				LogLevel:         "info",
			}
			if err := config.Save(stateLayout.ConfigPath, cfg); err != nil {
				return nil, fmt.Errorf("init default config: %w", err)
			}
		} else {
			return nil, fmt.Errorf("load config: %w", err)
		}
	}
	runPassword, err := resolveRunPassword(runPasswordOptions{
		password:     password,
		passwordEnv:  passwordEnv,
		passwordFile: passwordFile,
		stdin:        strings.NewReader(""),
	})
	if err != nil {
		return nil, err
	}
	if runPassword.requireStartupVerification {
		return nil, errors.New("desktop-bridge cannot verify password-env or password-file in a non-interactive bridge stream")
	}
	accessGate := newAccessGate(runPassword.password)
	desktopOwnerID := strings.TrimSpace(os.Getenv(desktopOwnerIDEnvName))
	if desktopOwnerID == "" {
		return nil, errors.New("missing Desktop owner id; set REDEVEN_DESKTOP_OWNER_ID")
	}
	a, err := agent.New(agent.Options{
		Config:                cfg,
		ConfigPath:            stateLayout.ConfigPath,
		StateRoot:             stateLayout.StateRoot,
		LocalUIEnabled:        true,
		ControlChannelEnabled: false,
		DesktopManaged:        true,
		EffectiveRunMode:      "local",
		RemoteEnabled:         false,
		Version:               Version,
		Commit:                Commit,
		BuildTime:             BuildTime,
		AccessGate:            accessGate,
	})
	if err != nil {
		return nil, fmt.Errorf("init runtime: %w", err)
	}
	gw := a.CodeGateway()
	if gw == nil {
		return nil, errors.New("local ui unavailable: gateway not initialized")
	}
	localUILn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen local ui bridge surface: %w", err)
	}
	controlLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = localUILn.Close()
		return nil, fmt.Errorf("listen runtime-control bridge surface: %w", err)
	}
	bind, err := localui.ParseBind("127.0.0.1:0")
	if err != nil {
		_ = localUILn.Close()
		_ = controlLn.Close()
		return nil, err
	}
	srv, err := localui.New(localui.Options{
		Logger:                 slog.New(slog.NewTextHandler(c.stderr, &slog.HandlerOptions{Level: slog.LevelInfo})),
		Bind:                   bind,
		DesktopManaged:         true,
		DesktopOwnerID:         desktopOwnerID,
		EffectiveRunMode:       "local",
		RemoteEnabled:          false,
		ControlplaneBaseURL:    cfg.ControlplaneBaseURL,
		ControlplaneProviderID: cfg.ControlplaneProviderID,
		EnvPublicID:            cfg.EnvironmentID,
		Gateway:                gw,
		Agent:                  a,
		ConfigPath:             stateLayout.ConfigPath,
		Version:                Version,
		AccessGate:             accessGate,
	})
	if err != nil {
		_ = localUILn.Close()
		_ = controlLn.Close()
		return nil, fmt.Errorf("init local ui: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.StartBackgroundServices(ctx)
	if err := srv.StartOnListeners(ctx, []net.Listener{localUILn}, controlLn); err != nil {
		cancel()
		return nil, err
	}
	localUIURL := listenerHTTPURL(localUILn)
	controlURL := listenerHTTPURL(controlLn)
	if localUIURL == "" || controlURL == "" {
		cancel()
		return nil, errors.New("bridge listeners did not expose loopback URLs")
	}
	return &bridgeRuntime{
		localUI:     srv,
		localUILn:   localUILn,
		controlLn:   controlLn,
		localUIURL:  localUIURL,
		controlURL:  controlURL,
		closeCancel: cancel,
	}, nil
}

func (r *bridgeRuntime) close() {
	if r == nil {
		return
	}
	if r.closeCancel != nil {
		r.closeCancel()
	}
	if r.localUI != nil {
		_ = r.localUI.Close()
	}
	if r.localUILn != nil {
		_ = r.localUILn.Close()
	}
	if r.controlLn != nil {
		_ = r.controlLn.Close()
	}
}

func listenerHTTPURL(ln net.Listener) string {
	if ln == nil {
		return ""
	}
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || addr.Port <= 0 {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d/", addr.Port)
}

func flagErrHelp() error { return flag.ErrHelp }
