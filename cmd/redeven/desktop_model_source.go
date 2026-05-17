package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
)

func (c *cli) desktopModelSourceCmd(args []string) int {
	fs := newCLIFlagSet("desktop-model-source")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")
	runtimeControlURL := fs.String("runtime-control-url", "", "Runtime-control service root URL")
	runtimeControlToken := fs.String("runtime-control-token", "", "Runtime-control bearer token")
	runtimeControlTokenEnv := fs.String("runtime-control-token-env", "", "Environment variable name holding the runtime-control token")
	desktopOwnerID := fs.String("desktop-owner-id", "", "Desktop owner id expected by the runtime")
	sessionID := fs.String("session-id", "", "Desktop model source session id")
	expiresAtUnixMS := fs.Int64("expires-at-unix-ms", 0, "Desktop model source session expiry in Unix milliseconds")
	startupReportFile := fs.String("startup-report-file", "", "Write connector readiness JSON to the given file")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(c.stdout, "Usage: redeven desktop-model-source --runtime-control-url URL --runtime-control-token-env NAME --desktop-owner-id ID --session-id ID [--state-root PATH]")
			return 0
		}
		message, details := translateFlagParseError("desktop-model-source", err)
		writeErrorWithHelp(c.stderr, message, details, "")
		return 2
	}

	token, err := resolveDesktopModelSourceRuntimeControlToken(*runtimeControlToken, *runtimeControlTokenEnv)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop model source failed: %v\n", err)
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop model source failed to resolve state layout: %v\n", err)
		return 1
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		cancel()
	}()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelWarn}))
	err = ai.RunDesktopModelSourceConnector(ctx, ai.DesktopModelSourceConnectorOptions{
		Logger:                logger,
		ConfigPath:            layout.ConfigPath,
		SecretsPath:           layout.SecretsPath,
		RuntimeControlBaseURL: *runtimeControlURL,
		RuntimeControlToken:   token,
		DesktopOwnerID:        *desktopOwnerID,
		SessionID:             *sessionID,
		Source:                ai.DesktopModelSourceDefaultSource,
		ExpiresAtUnixMS:       *expiresAtUnixMS,
		StartupReportFile:     *startupReportFile,
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(c.stderr, "desktop model source failed: %v\n", err)
		return 1
	}
	return 0
}

func resolveDesktopModelSourceRuntimeControlToken(token string, tokenEnv string) (string, error) {
	token = strings.TrimSpace(token)
	tokenEnv = strings.TrimSpace(tokenEnv)
	if token != "" && tokenEnv != "" {
		return "", errors.New("provide only one of --runtime-control-token or --runtime-control-token-env")
	}
	if tokenEnv != "" {
		v := strings.TrimSpace(os.Getenv(tokenEnv))
		if v == "" {
			return "", fmt.Errorf("environment variable %s is empty", tokenEnv)
		}
		return v, nil
	}
	if token == "" {
		return "", errors.New("missing runtime-control token")
	}
	return token, nil
}
