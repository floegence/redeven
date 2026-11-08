package codeapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/storagecontract"
)

func TestPluginInitializationPanicDoesNotEscapeHostBoundary(t *testing.T) {
	value, err := openPluginIntegration(t.Context(), func(context.Context) (*redevpluginintegration.Integration, error) { panic("plugin init failed") })
	if value != nil || err == nil || !strings.Contains(err.Error(), "plugin init failed") {
		t.Fatalf("unexpected result: %v %v", value, err)
	}
}

func TestUnavailablePluginHandlerNeverDispatchesMutations(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		response := httptest.NewRecorder()
		pluginPlatformHandler(nil).ServeHTTP(response, httptest.NewRequest(method, "/_redevplugin/api/plugins/install", nil))
		var result struct {
			OK    bool
			Error struct {
				Code    string
				Details map[string]any
				Outcome string `json:"mutation_outcome"`
			}
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if response.Code != 503 || result.OK || result.Error.Code != "PLUGIN_RUNTIME_UNAVAILABLE" || result.Error.Details == nil {
			t.Fatalf("invalid response: %s", response.Body.String())
		}
		if method != http.MethodGet && result.Error.Outcome != "not_committed" {
			t.Fatal("unavailable subsystem did not reject mutation before dispatch")
		}
	}
}

func TestPluginInitializationFailureKeepsProductAvailable(t *testing.T) {
	for _, failure := range []string{"control.sqlite", "observability.sqlite", "secrets.sqlite", "legacy-placement", "runtime-missing", "market-origin"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			runtimePath := testReDevPluginRuntimePath(t, root)
			var damagedPath string
			before := []byte("unrecognized plugin state: preserve these bytes")
			switch failure {
			case "runtime-missing":
				runtimePath = filepath.Join(root, "missing-plugin-runtime")
			case "market-origin":
				t.Setenv("REDEVEN_PLUGIN_MARKET_ORIGIN", "not a valid URL")
			case "legacy-placement":
				damagedPath = filepath.Join(root, "control.sqlite")
			default:
				damagedPath = filepath.Join(storagecontract.PluginRoot(root), failure)
			}
			if damagedPath != "" {
				if err := os.MkdirAll(filepath.Dir(damagedPath), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(damagedPath, before, 0600); err != nil {
					t.Fatal(err)
				}
			}
			svc, err := New(t.Context(), Options{
				Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
				StateDir: root, StateRoot: root, ConfigPath: testCodeappConfigPath(t, root),
				PermissionPolicy: testCodeappPermissionPolicy(t), ReDevPluginRuntimePath: runtimePath,
				AgentHomeDir: root, Shell: "/bin/sh",
				ResolveSessionMeta:   func(string) (*session.Meta, bool) { return nil, false },
				AcquirePluginSession: func(id string) (*session.Meta, func(), bool) { return &session.Meta{ChannelID: id}, func() {}, true },
			})
			if err != nil {
				t.Fatalf("plugin failure stopped core runtime: %v", err)
			}
			defer svc.Close()
			if svc.pluginIntegration != nil {
				t.Fatal("failed plugin subsystem retained execution authority")
			}
			if _, err := svc.notes.Snapshot(t.Context()); err != nil {
				t.Fatalf("Notes unavailable: %v", err)
			}
			if svc.AppServerURL() == "" || svc.reg == nil || svc.pf == nil {
				t.Fatal("core product services unavailable")
			}
			meta := &session.Meta{ChannelID: "local-ui", EndpointID: "env_local", UserPublicID: "user_local"}
			for _, lifecycle := range []func(context.Context, *session.Meta, string, string) error{svc.BindPluginSessionGeneration, svc.RecordPluginSessionTerminalIntent, svc.MaintainTerminalPluginSession} {
				if err := lifecycle(t.Context(), meta, "process", "session"); err != nil {
					t.Fatalf("absent plugin subsystem blocked host session: %v", err)
				}
			}
			request := appserver.WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil))
			response := httptest.NewRecorder()
			svc.appSrv.ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "PLUGIN_RUNTIME_UNAVAILABLE") {
				t.Fatalf("plugin failure response: %d %s", response.Code, response.Body.String())
			}
			if damagedPath != "" {
				after, err := os.ReadFile(damagedPath)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("damaged plugin state changed: %v", err)
				}
			}
		})
	}
}

func TestPluginInitializationDeadlineDoesNotWaitForStuckConstructor(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	release := make(chan struct{})
	finished := make(chan struct{})
	defer func() { close(release); <-finished }()
	started := time.Now()
	value, err := openPluginIntegration(ctx, func(context.Context) (*redevpluginintegration.Integration, error) {
		defer close(finished)
		<-release
		return nil, errors.New("late plugin failure")
	})
	if value != nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected startup result: %v %v", value, err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("host waited for stuck plugin startup")
	}
}

func TestCanceledPluginInitializationDoesNotInvokeConstructor(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := openPluginIntegration(ctx, func(context.Context) (*redevpluginintegration.Integration, error) {
		t.Error("constructor ran after cancellation")
		return nil, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error: %v", err)
	}
}
