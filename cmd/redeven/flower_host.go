package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/flowerhost"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/threadreadstate"
)

func (c *cli) flowerHostCmd(args []string) int {
	fs := newCLIFlagSet("flower-host")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")
	bind := fs.String("bind", "127.0.0.1:0", "Flower Host loopback bind address")
	startupReportFile := fs.String("startup-report-file", "", "Write Flower Host readiness JSON to the given file")
	authToken := fs.String("auth-token", "", "Bearer token for the Flower Host loopback API")
	secretResolverURL := fs.String("secret-resolver-url", "", "Desktop carrier secret resolver base URL")
	secretResolverTokenEnv := fs.String("secret-resolver-token-env", "", "Environment variable name holding the secret resolver token")
	agentHomeDir := fs.String("agent-home-dir", "", "Host-local working directory for Flower Host tools")
	shell := fs.String("shell", "", "Shell command for host-local terminal tools")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(c.stdout, "Usage: redeven flower-host [--state-root PATH] [--bind 127.0.0.1:0] [--startup-report-file PATH]")
			return 0
		}
		message, details := translateFlagParseError("flower-host", err)
		writeErrorWithHelp(c.stderr, message, details, "")
		return 2
	}

	resolverToken, err := resolveSecretResolverToken(*secretResolverTokenEnv)
	if err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed: %v\n", err)
		return 2
	}
	paths, err := flowerhost.DefaultPaths(*stateRoot)
	if err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to resolve state layout: %v\n", err)
		return 1
	}
	if err := os.MkdirAll(paths.StateDir, 0o700); err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to create state dir: %v\n", err)
		return 1
	}
	lk, err := lockfile.Acquire(paths.LockPath)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			_ = writeFlowerHostLockedReport(*startupReportFile, paths.LockPath)
			fmt.Fprintln(c.stderr, "flower-host is already running")
			return 1
		}
		fmt.Fprintf(c.stderr, "flower-host failed to acquire lock: %v\n", err)
		return 1
	}
	defer func() { _ = lk.Release() }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		cancel()
	}()

	store := flowerhost.NewConfigStore(paths)
	identity, err := store.LoadIdentity(ctx)
	if err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to load identity: %v\n", err)
		return 1
	}
	resolver := flowerhost.HTTPSecretResolver{
		BaseURL: strings.TrimSpace(*secretResolverURL),
		Token:   resolverToken,
	}
	readState, err := threadreadstate.OpenResettingInvalidSchema(filepath.Join(paths.StateRoot, "gateway", "thread_read_state.sqlite"))
	if err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to open thread read state: %v\n", err)
		return 1
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelWarn}))
	svc, err := flowerhost.NewService(ctx, flowerhost.ServiceOptions{
		Logger:         logger,
		Paths:          paths,
		Identity:       identity,
		SecretResolver: resolver,
		ReadState:      readState,
		AgentHomeDir:   *agentHomeDir,
		Shell:          *shell,
	})
	if err != nil {
		_ = readState.Close()
		fmt.Fprintf(c.stderr, "flower-host failed to start service: %v\n", err)
		return 1
	}
	defer func() { _ = svc.Close() }()

	token := strings.TrimSpace(*authToken)
	server, err := flowerhost.StartServer(flowerhost.ServerOptions{
		Service: svc,
		Token:   token,
		Bind:    *bind,
	})
	if err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to bind: %v\n", err)
		return 1
	}
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = server.Shutdown(shutdownCtx)
		shutdownCancel()
	}()

	snapshot, _ := svc.LoadSettings(ctx)
	report := flowerhost.StartupReport{
		Status:          "ready",
		HostID:          identity.HostID,
		HostKind:        identity.HostKind,
		CarrierKind:     identity.CarrierKind,
		BaseURL:         server.BaseURL(),
		Token:           server.Token(),
		PID:             os.Getpid(),
		StartedAtUnixMs: time.Now().UnixMilli(),
		StateDir:        paths.StateDir,
		ThreadstorePath: paths.ThreadstorePath,
		ConfigPath:      paths.ConfigPath,
		Configured:      snapshot.Config.Enabled && len(snapshot.Config.Providers) > 0,
		ModelCount:      countFlowerHostModels(snapshot.Config),
		Capabilities:    []string{"flower_threads", "model_runtime", "settings", "router_decision"},
	}
	if err := writeFlowerHostStartupReport(*startupReportFile, report); err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to write startup report: %v\n", err)
		return 1
	}
	if err := writeFlowerHostLockMetadata(lk, report); err != nil {
		fmt.Fprintf(c.stderr, "flower-host failed to write lock metadata: %v\n", err)
		return 1
	}
	<-ctx.Done()
	return 0
}

func resolveSecretResolverToken(tokenEnv string) (string, error) {
	tokenEnv = strings.TrimSpace(tokenEnv)
	if tokenEnv != "" {
		value := strings.TrimSpace(os.Getenv(tokenEnv))
		if value == "" {
			return "", fmt.Errorf("environment variable %s is empty", tokenEnv)
		}
		return value, nil
	}
	return "", nil
}

func writeFlowerHostStartupReport(path string, report flowerhost.StartupReport) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	return writeFlowerHostReport(path, report)
}

func writeFlowerHostBlockedReport(path string, code string, message string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	return writeFlowerHostReport(path, flowerhost.BlockedStartupReport{
		Status:  "blocked",
		Code:    strings.TrimSpace(code),
		Message: strings.TrimSpace(message),
	})
}

func writeFlowerHostLockedReport(path string, lockPath string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	var metadata flowerhost.LockMetadata
	if body, err := lockfile.ReadContent(lockPath); err == nil && len(strings.TrimSpace(string(body))) > 0 {
		_ = json.Unmarshal(body, &metadata)
	}
	if strings.TrimSpace(metadata.BaseURL) != "" && strings.TrimSpace(metadata.Token) != "" && processAlive(metadata.PID) {
		return writeFlowerHostReport(path, map[string]any{
			"status":             "ready",
			"host_id":            metadata.HostID,
			"host_kind":          metadata.HostKind,
			"carrier_kind":       metadata.CarrierKind,
			"base_url":           metadata.BaseURL,
			"token":              metadata.Token,
			"pid":                metadata.PID,
			"started_at_unix_ms": metadata.StartedAtUnixMs,
			"state_dir":          metadata.StateDir,
			"threadstore_path":   metadata.ThreadstorePath,
			"config_path":        metadata.ConfigPath,
			"attached":           true,
		})
	}
	return writeFlowerHostBlockedReport(path, "flower_host_locked", "Flower Host is already running but cannot be attached.")
}

func writeFlowerHostLockMetadata(lk *lockfile.Lock, report flowerhost.StartupReport) error {
	body, err := json.MarshalIndent(flowerhost.LockMetadata{
		SchemaVersion:   flowerhost.SchemaVersion,
		HostID:          report.HostID,
		HostKind:        report.HostKind,
		CarrierKind:     report.CarrierKind,
		BaseURL:         report.BaseURL,
		Token:           report.Token,
		PID:             report.PID,
		StartedAtUnixMs: report.StartedAtUnixMs,
		StateDir:        report.StateDir,
		ThreadstorePath: report.ThreadstorePath,
		ConfigPath:      report.ConfigPath,
	}, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	return lk.SetContent(body)
}

func writeFlowerHostReport(path string, report any) error {
	path = strings.TrimSpace(path)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func countFlowerHostModels(doc flowerhost.ConfigDocument) int {
	count := 0
	for _, provider := range doc.Providers {
		count += len(provider.Models)
	}
	return count
}
