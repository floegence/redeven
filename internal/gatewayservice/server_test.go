package gatewayservice

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/gatewaystate"
)

func TestGatewayDoesNotExposeRuntimeLifecycleRoutes(t *testing.T) {
	server, err := New(Options{StateRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v3/runtime-operations/prepare", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("runtime lifecycle route status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestRejectedGatewayConfigurationDoesNotCreateOrRewriteState(t *testing.T) {
	for _, name := range []string{"membership-migration.json", "environments.json", "members.json"} {
		root := t.TempDir()
		file := filepath.Join(root, name)
		body := []byte(`{"schema_version":4,"retired_secret":"do-not-expose"}`)
		if err := os.WriteFile(file, body, 0600); err != nil {
			t.Fatal(err)
		}
		_, err := New(Options{StateRoot: root})
		var rejected *gatewaystate.ReadError
		if !errors.As(err, &rejected) || rejected.Code != "gateway_state_unsupported" {
			t.Fatalf("%s: error = %v", name, err)
		}
		entries, _ := os.ReadDir(root)
		after, _ := os.ReadFile(file)
		if len(entries) != 1 || string(after) != string(body) {
			t.Fatalf("%s: rejected configuration changed state", name)
		}
	}
}

func TestGatewayStartsWithoutRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	server, err := New(Options{StateRoot: stateRoot, MemberListen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	httpServer, _, err := server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer httpServer.Close()
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-lifecycle")); !os.IsNotExist(err) {
		t.Fatalf("Gateway created Runtime lifecycle state: %v", err)
	}
}
