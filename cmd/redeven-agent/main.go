package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/floegence/redeven-agent/internal/agent"
	"github.com/floegence/redeven-agent/internal/config"
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
		fmt.Printf("redeven-agent %s (%s) %s\n", Version, Commit, BuildTime)
	default:
		printUsage()
		os.Exit(2)
	}
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `redeven-agent

Usage:
  redeven-agent bootstrap [flags]
  redeven-agent run [flags]
  redeven-agent version

Commands:
  bootstrap   Exchange an environment token for Flowersec direct control-channel credentials and write config.
  run         Run the agent using the local config file.
  version     Print build information.

`)
}

func bootstrapCmd(args []string) {
	fs := flag.NewFlagSet("bootstrap", flag.ExitOnError)

	controlplane := fs.String("controlplane", "", "Controlplane base URL (e.g. https://sg.example.invalid)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	envToken := fs.String("env-token", "", "Environment token (raw; do not include 'Bearer ' prefix)")
	cfgPath := fs.String("config", config.DefaultConfigPath(), "Config file path")

	rootDir := fs.String("root-dir", "", "Filesystem root dir (default: user home dir)")
	shell := fs.String("shell", "", "Shell command (default: $SHELL or /bin/bash)")

	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (empty: keep existing; default: execute_read)")

	logFormat := fs.String("log-format", "json", "Log format: json|text")
	logLevel := fs.String("log-level", "info", "Log level: debug|info|warn|error")

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
		ConfigPath:             *cfgPath,
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

	fmt.Printf("Config written: %s\n", filepath.Clean(out))
}

func runCmd(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	cfgPath := fs.String("config", config.DefaultConfigPath(), "Config file path")
	_ = fs.Parse(args)

	cfgPathClean := filepath.Clean(*cfgPath)

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

	cfg, err := config.Load(cfgPathClean)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	a, err := agent.New(agent.Options{
		Config:     cfg,
		ConfigPath: cfgPathClean,
		Version:    Version,
		Commit:     Commit,
		BuildTime:  BuildTime,
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

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "agent exited with error: %v\n", err)
		os.Exit(1)
	}
}
