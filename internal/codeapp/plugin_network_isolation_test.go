package codeapp

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestPluginProxyFailureKeepsRuntimeAndNotesAvailable(t *testing.T) {
	for _, test := range []struct{ name, proxy string }{
		{"unavailable", "http://127.0.0.1:1"},
		{"invalid", "http://bad proxy:8080"},
	} {
		t.Run(test.name, func(t *testing.T) { testPluginProxyFailure(t, test.proxy) })
	}
}
func testPluginProxyFailure(t *testing.T, proxy string) {
	// Startup must not resolve proxies, dial them, or turn a request failure
	// into a host failure, even when network configuration itself is invalid.
	t.Setenv("HTTPS_PROXY", proxy)
	t.Setenv("https_proxy", proxy)
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	root := t.TempDir()
	service, err := New(t.Context(), Options{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir: root, StateRoot: root, ConfigPath: filepath.Join(root, "config.json"),
		PermissionPolicy: testCodeappPermissionPolicy(t), ReDevPluginRuntimePath: testReDevPluginRuntimePath(t, root),
		AgentHomeDir: root, Shell: "/bin/sh",
		ResolveSessionMeta:   func(string) (*session.Meta, bool) { return nil, false },
		AcquirePluginSession: func(id string) (*session.Meta, func(), bool) { return &session.Meta{ChannelID: id}, func() {}, true },
	})
	if err != nil {
		t.Fatalf("network policy blocked Runtime construction: %v", err)
	}
	defer service.Close()
	if service.pluginIntegration == nil {
		t.Fatal("offline network policy rejected plugin initialization")
	}
	if _, err := service.notes.Snapshot(t.Context()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if _, err := service.pluginIntegration.RefreshMarket(ctx); err == nil {
		t.Fatal("unavailable proxy unexpectedly refreshed market")
	}
	if _, err := service.notes.Snapshot(t.Context()); err != nil {
		t.Fatalf("plugin network error disabled Notes: %v", err)
	}
	if service.AppServerURL() == "" || service.reg == nil || service.pf == nil {
		t.Fatal("core service lost after network failure")
	}
}
