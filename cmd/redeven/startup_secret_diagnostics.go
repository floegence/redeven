package main

import (
	"io"
	"log/slog"
	"strings"

	"github.com/floegence/redeven/internal/diagnostics"
)

func recordStartupSecretSources(stateDir string, secrets resolvedStartupSecrets) {
	detail := make(map[string]any, 2)
	if secrets.localUIPassword.source != startupSecretSourceNone {
		detail["local_ui_access_source"] = string(secrets.localUIPassword.source)
	}
	if secrets.bootstrapTicket.source != startupSecretSourceNone {
		detail["provider_bootstrap_source"] = string(secrets.bootstrapTicket.source)
	}
	if len(detail) == 0 || strings.TrimSpace(stateDir) == "" {
		return
	}
	store, err := diagnostics.New(diagnostics.Options{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir: stateDir,
		Source:   diagnostics.SourceAgent,
	})
	if err != nil {
		return
	}
	store.Append(diagnostics.Event{
		Scope:  diagnostics.ScopeDesktopLifecycle,
		Kind:   "startup_secret_sources",
		Detail: detail,
	})
}
