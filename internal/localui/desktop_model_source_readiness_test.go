package localui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/ai"
)

func TestDesktopModelSourceUnavailableUsesRetryableHTTPStatus(t *testing.T) {
	control := &runtimeControlServer{token: "test-owner"}
	for _, endpoint := range []string{"connect", "rpc"} {
		t.Run(endpoint, func(t *testing.T) {
			method := http.MethodPost
			if endpoint == "rpc" {
				method = http.MethodGet
			}
			req := httptest.NewRequest(method, "http://localhost/v2/desktop-model-source/"+endpoint+"?session_id=test", strings.NewReader(`{"session_id":"test","protocol_version":"redeven-desktop-model-source-rpc-v1"}`))
			req.Header.Set("X-Redeven-Desktop-Model-Source-Protocol", ai.DesktopModelSourceProtocolVersion)
			req.RemoteAddr = "127.0.0.1:2345"
			req.Header.Set("Authorization", "Bearer test-owner")
			response := httptest.NewRecorder()
			if endpoint == "connect" {
				control.handleDesktopModelSourceConnect(response, req)
			} else {
				control.handleDesktopModelSourceRPC(response, req)
			}
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "AI_SERVICE_UNAVAILABLE") {
				t.Fatalf("unavailable AI: got %d %s, want retryable 503", response.Code, response.Body.String())
			}
		})
	}
}

func TestDesktopModelSourceReadinessErrorClassification(t *testing.T) {
	for _, test := range []struct {
		blocked bool
		status  int
		code    string
	}{
		{false, http.StatusServiceUnavailable, "AI_SERVICE_UNAVAILABLE"},
		{true, http.StatusConflict, "AI_SERVICE_BLOCKED"},
	} {
		response := httptest.NewRecorder()
		writeDesktopModelSourceError(response, &agent.DesktopModelSourceUnavailable{Blocked: test.blocked})
		if response.Code != test.status || !strings.Contains(response.Body.String(), test.code) {
			t.Fatalf("classification: %d %s", response.Code, response.Body.String())
		}
	}
}

func TestDesktopModelSourceConnectorSurvivesRealHandlerReadiness(t *testing.T) {
	cfgPath := writeTestConfig(t)
	runtime := newRuntimeHealthTestAgent(t, cfgPath, accessgate.New(accessgate.Options{}))
	preparing := &runtimeControlServer{token: "test-owner"}
	ready := &runtimeControlServer{token: "test-owner", agent: runtime}
	var attempts atomic.Int32
	var unavailable atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/desktop-model-source/connect":
			if attempts.Add(1) == 1 {
				unavailable.Add(1)
				preparing.handleDesktopModelSourceConnect(w, r)
			} else {
				ready.handleDesktopModelSourceConnect(w, r)
			}
		case "/v2/desktop-model-source/rpc":
			ready.handleDesktopModelSourceRPC(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	root := t.TempDir()
	report := filepath.Join(root, "connected.json")
	done := make(chan error, 1)
	go func() {
		done <- ai.RunDesktopModelSourceConnector(ctx, ai.DesktopModelSourceConnectorOptions{
			ConfigPath: filepath.Join(root, "config.json"), SecretsPath: filepath.Join(root, "secrets.json"),
			RuntimeControlBaseURL: server.URL + "/", RuntimeControlToken: "test-owner", SessionID: "real-handler-retry",
			ExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli(), StartupReportFile: report,
		})
	}()
	deadline := time.After(15 * time.Second)
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			t.Fatalf("connector exited before readiness: %v", err)
		case <-deadline:
			t.Fatal("same connector never reached ready through real Runtime handlers")
		case <-ticker.C:
			if _, err := os.Stat(report); err == nil {
				if attempts.Load() < 2 || unavailable.Load() != 1 {
					t.Fatalf("readiness transition not exercised: %d", attempts.Load())
				}
				cancel()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Fatal("connector did not release its session")
				}
				return
			}
		}
	}
}
