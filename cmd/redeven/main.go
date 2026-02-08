package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven-agent/internal/agent"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/localui"
	"github.com/floegence/redeven-agent/internal/lockfile"
)

var (
	// Version is set via -ldflags at build time.
	Version = "dev"
	// Commit is set via -ldflags at build time.
	Commit = "unknown"
	// BuildTime is set via -ldflags at build time.
	BuildTime = "unknown"
)

func main() {
	cleanupLegacyHomeDir()

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "bootstrap":
		bootstrapCmd(os.Args[2:])
	case "run":
		runCmd(os.Args[2:])
	case "version":
		fmt.Printf("redeven %s (%s) %s\n", Version, Commit, BuildTime)
	default:
		printUsage()
		os.Exit(2)
	}
}

func cleanupLegacyHomeDir() {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return
	}

	// NOTE: We renamed the default config/state directory from ~/.redeven-agent to ~/.redeven.
	// During development, remove the legacy directory proactively to avoid stale state surprises.
	_ = os.RemoveAll(filepath.Join(home, ".redeven-agent"))
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `redeven

Usage:
  redeven bootstrap [flags]
  redeven run [flags]
  redeven version

Commands:
  bootstrap   Exchange an environment token for Flowersec direct control-channel credentials and write config.
  run         Run the agent (uses local config by default; can also bootstrap via flags).
  version     Print build information.

`)
}

func bootstrapCmd(args []string) {
	fs := flag.NewFlagSet("bootstrap", flag.ExitOnError)

	controlplane := fs.String("controlplane", "", "Controlplane base URL (e.g. https://sg.example.invalid)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	envToken := fs.String("env-token", "", "Environment token (raw token; 'Bearer <token>' is also accepted)")

	rootDir := fs.String("root-dir", "", "Filesystem root dir (default: user home dir)")
	shell := fs.String("shell", "", "Shell command (default: $SHELL or /bin/bash)")

	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (empty: keep existing; default: execute_read_write)")

	logFormat := fs.String("log-format", "", "Log format: json|text (empty: default json)")
	logLevel := fs.String("log-level", "", "Log level: debug|info|warn|error (empty: default info)")

	timeout := fs.Duration("timeout", 15*time.Second, "Bootstrap request timeout")

	_ = fs.Parse(args)

	if *controlplane == "" || *envID == "" || *envToken == "" {
		fs.Usage()
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	out, err := config.BootstrapConfig(ctx, config.BootstrapArgs{
		ControlplaneBaseURL:    *controlplane,
		EnvironmentID:          *envID,
		EnvironmentToken:       *envToken,
		RootDir:                *rootDir,
		Shell:                  *shell,
		LogFormat:              *logFormat,
		LogLevel:               *logLevel,
		PermissionPolicyPreset: *permissionPolicy,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "bootstrap failed: %v\n", err)
		os.Exit(1)
	}

	_ = out
	fmt.Printf("Bootstrap complete. Run `redeven run`.\n")
}

func runCmd(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	controlplane := fs.String("controlplane", "", "Controlplane base URL (optional; when set, bootstraps into an isolated per-environment state dir)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	envToken := fs.String("env-token", "", "Environment token (required when --controlplane/--env-id is set)")
	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (optional; applies when bootstrapping)")
	modeRaw := fs.String("mode", "remote", "Run mode: remote|hybrid|local")
	localUIPort := fs.Int("local-ui-port", defaultLocalUIPort, "Local UI port (default: 23998)")
	_ = fs.Parse(args)

	mode, err := parseRunMode(*modeRaw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid --mode: %v\n\n", err)
		fs.Usage()
		os.Exit(2)
	}

	// Default: use the global config path. This is the recommended single-environment setup:
	//
	//	redeven bootstrap ... && redeven run
	cfgPathClean := filepath.Clean(config.DefaultConfigPath())

	// Multi-environment mode: bootstrap & run using an isolated state directory per env.
	// This avoids overwriting the global ~/.redeven/config.json.
	bootstrapViaFlags := strings.TrimSpace(*controlplane) != "" ||
		strings.TrimSpace(*envID) != "" ||
		strings.TrimSpace(*envToken) != ""
	if bootstrapViaFlags {
		if strings.TrimSpace(*controlplane) == "" || strings.TrimSpace(*envID) == "" || strings.TrimSpace(*envToken) == "" {
			fs.Usage()
			os.Exit(2)
		}
		cfgPathClean = filepath.Clean(config.EnvConfigPath(*envID))
	}

	// Ensure the state/config directory exists before taking the lock.
	// Local mode must work on a clean machine (no bootstrap yet).
	cfgDir := filepath.Dir(cfgPathClean)
	if err := os.MkdirAll(cfgDir, 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "failed to init state dir: %v\n", err)
		os.Exit(1)
	}

	// Prevent multiple agent processes from managing the same local state directory.
	// This avoids control-plane flapping and data-plane races when users start the agent twice.
	lockPath := filepath.Join(filepath.Dir(cfgPathClean), "agent.lock")
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		// Keep the message actionable; users can stop the existing process then retry.
		fmt.Fprintf(os.Stderr, "failed to acquire agent lock (%s): %v\n", lockPath, err)
		os.Exit(1)
	}
	defer func() { _ = lk.Release() }()

	if bootstrapViaFlags {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		_, err := config.BootstrapConfig(ctx, config.BootstrapArgs{
			ControlplaneBaseURL:    *controlplane,
			EnvironmentID:          *envID,
			EnvironmentToken:       *envToken,
			ConfigPath:             cfgPathClean,
			PermissionPolicyPreset: *permissionPolicy,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "bootstrap failed: %v\n", err)
			os.Exit(1)
		}
	}

	cfg, err := config.Load(cfgPathClean)
	if err != nil {
		// Local mode must be able to start from a clean machine (no bootstrap yet).
		if mode == runModeLocal && os.IsNotExist(err) {
			p, _ := config.ParsePermissionPolicyPreset("")
			cfg = &config.Config{
				PermissionPolicy: p,
				LogFormat:        "json",
				LogLevel:         "info",
			}
			if err := config.Save(cfgPathClean, cfg); err != nil {
				fmt.Fprintf(os.Stderr, "failed to init default config: %v\n", err)
				os.Exit(1)
			}
		} else {
			fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
			os.Exit(1)
		}
	}

	remoteErr := cfg.ValidateRemoteStrict()
	remoteEnabled := remoteErr == nil

	controlChannelEnabled := mode != runModeLocal
	localUIEnabled := mode != runModeRemote

	if controlChannelEnabled && !remoteEnabled {
		fmt.Fprintf(os.Stderr, "agent not bootstrapped: %v\n", remoteErr)
		fmt.Fprintf(os.Stderr, "Hint: run `redeven bootstrap` first.\n")
		os.Exit(1)
	}

	localPort := *localUIPort
	announce := func() {
		printWelcomeBanner(os.Stderr, welcomeBannerOptions{
			Version:             Version,
			ControlplaneBaseURL: cfg.ControlplaneBaseURL,
			EnvironmentID:       cfg.EnvironmentID,
			LocalUIEnabled:      localUIEnabled,
			LocalUIPort:         localPort,
		})
	}

	var allowedOrigins []string
	if localUIEnabled {
		allowedOrigins = localui.AllowedOriginsForPort(*localUIPort)
	}

	a, err := agent.New(agent.Options{
		Config:                cfg,
		ConfigPath:            cfgPathClean,
		LocalUIEnabled:        localUIEnabled,
		LocalUIAllowedOrigins: allowedOrigins,
		ControlChannelEnabled: controlChannelEnabled,
		Version:               Version,
		Commit:                Commit,
		BuildTime:             BuildTime,
		OnControlConnected:    announce,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to init agent: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown on SIGINT/SIGTERM.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		cancel()
	}()

	// Start the Local UI server before running the control channel loop so users can open
	// the local page immediately.
	if localUIEnabled {
		cfgPathAbs, err := filepath.Abs(cfgPathClean)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to resolve config path: %v\n", err)
			os.Exit(1)
		}
		gw := a.CodeGateway()
		if gw == nil {
			fmt.Fprintf(os.Stderr, "local ui unavailable: gateway not initialized\n")
			os.Exit(1)
		}

		srv, err := localui.New(localui.Options{
			Port:       *localUIPort,
			Gateway:    gw,
			Agent:      a,
			ConfigPath: cfgPathAbs,
			Version:    Version,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to init local ui: %v\n", err)
			os.Exit(1)
		}
		if err := srv.Start(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "failed to start local ui: %v\n", err)
			os.Exit(1)
		}

		// Keep the port accurate in the banner (srv.Port() is the bound port).
		localPort = srv.Port()

		// In local mode, print after the Local UI is ready.
		// In hybrid mode, print after the control channel connects (so URL is accurate).
		if mode == runModeLocal {
			announce()
		}
	}

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "agent exited with error: %v\n", err)
		os.Exit(1)
	}
}

type runMode string

const (
	runModeRemote runMode = "remote"
	runModeHybrid runMode = "hybrid"
	runModeLocal  runMode = "local"
)

func parseRunMode(raw string) (runMode, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case string(runModeRemote):
		return runModeRemote, nil
	case string(runModeHybrid):
		return runModeHybrid, nil
	case string(runModeLocal):
		return runModeLocal, nil
	default:
		return "", fmt.Errorf("want remote|hybrid|local, got %q", raw)
	}
}
