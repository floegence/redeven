package gatewayservice

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGatewayDoesNotExposeRuntimeLifecycleRoutes(t *testing.T) {
	server, err := New(Options{StateRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v2/runtime-operations/prepare", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("runtime lifecycle route status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestGatewayStartsWithoutRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	server, err := New(Options{StateRoot: stateRoot})
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
