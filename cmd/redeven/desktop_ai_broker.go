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

func (c *cli) desktopAIBrokerCmd(args []string) int {
	fs := newCLIFlagSet("desktop-ai-broker")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")
	bind := fs.String("bind", "127.0.0.1:0", "Loopback bind address")
	token := fs.String("token", "", "Bearer token")
	tokenEnv := fs.String("token-env", "", "Environment variable name holding the bearer token")
	sessionID := fs.String("session-id", "", "Desktop broker session id")
	sshRuntimeKey := fs.String("ssh-runtime-key", "", "Desktop SSH runtime key")
	expiresAtUnixMS := fs.Int64("expires-at-unix-ms", 0, "Broker token expiry in Unix milliseconds")
	startupReportFile := fs.String("startup-report-file", "", "Write broker readiness JSON to the given file")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(c.stdout, "Usage: redeven desktop-ai-broker --token-env NAME [--state-root PATH] [--bind 127.0.0.1:0]")
			return 0
		}
		message, details := translateFlagParseError("desktop-ai-broker", err)
		writeErrorWithHelp(c.stderr, message, details, "")
		return 2
	}

	resolvedToken, err := resolveDesktopAIBrokerToken(*token, *tokenEnv)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop ai broker failed: %v\n", err)
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop ai broker failed to resolve state layout: %v\n", err)
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
	if err := ai.ServeDesktopAIBroker(ctx, ai.DesktopAIBrokerServerOptions{
		Logger:            logger,
		ConfigPath:        layout.ConfigPath,
		SecretsPath:       layout.SecretsPath,
		Bind:              *bind,
		Token:             resolvedToken,
		SessionID:         *sessionID,
		SSHRuntimeKey:     *sshRuntimeKey,
		ExpiresAtUnixMS:   *expiresAtUnixMS,
		StartupReportFile: *startupReportFile,
	}); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(c.stderr, "desktop ai broker failed: %v\n", err)
		return 1
	}
	return 0
}

func resolveDesktopAIBrokerToken(token string, tokenEnv string) (string, error) {
	token = strings.TrimSpace(token)
	tokenEnv = strings.TrimSpace(tokenEnv)
	if token != "" && tokenEnv != "" {
		return "", errors.New("provide only one of --token or --token-env")
	}
	if tokenEnv != "" {
		v := strings.TrimSpace(os.Getenv(tokenEnv))
		if v == "" {
			return "", fmt.Errorf("environment variable %s is empty", tokenEnv)
		}
		return v, nil
	}
	if token == "" {
		return "", errors.New("missing token")
	}
	return token, nil
}
