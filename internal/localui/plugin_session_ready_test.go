package localui

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/sessionhop"
)

func newPluginSessionReadyTestServer(credential string, timeout time.Duration) *Server {
	return &Server{
		pluginAccess: map[string]*pluginAccessSession{
			"access": {state: pluginAccessActive, pending: make(map[string]struct{})},
		},
		activePluginSession: map[string]activePluginSessionBinding{
			"channel": {
				accessSessionID: "access",
				credentialHash:  sha256.Sum256([]byte(credential)),
				state:           pluginSessionBindingInitializing,
				settled:         make(chan struct{}),
			},
		},
		pluginSessionReadyTimeout: timeout,
	}
}

func newPluginSessionReadyHTTPRequest(credential string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "http://localhost/api/local/plugin/session/ready", bytes.NewBufferString(`{"channel_id":"channel"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(sessionhop.HeaderPluginSessionCredential, credential)
	return request
}

func TestPluginSessionReadyWaitsForExactBinding(t *testing.T) {
	server := newPluginSessionReadyTestServer("credential", time.Second)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		response := httptest.NewRecorder()
		server.handlePluginSessionReady(response, newPluginSessionReadyHTTPRequest("credential"))
		done <- response
	}()

	select {
	case <-done:
		t.Fatal("readiness request completed before the plugin session became ready")
	case <-time.After(20 * time.Millisecond):
	}
	server.markAcceptedPluginSessionReady("channel")

	select {
	case response := <-done:
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body=%q", response.Code, response.Body.String())
		}
	case <-time.After(time.Second):
		t.Fatal("readiness request did not complete after activation")
	}
}

func TestPluginSessionReadyRejectsWrongCredentialImmediately(t *testing.T) {
	server := newPluginSessionReadyTestServer("credential", time.Second)
	response := httptest.NewRecorder()
	server.handlePluginSessionReady(response, newPluginSessionReadyHTTPRequest("wrong"))
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%q", response.Code, response.Body.String())
	}
}

func TestPluginSessionReadyWakesWhenBindingCloses(t *testing.T) {
	server := newPluginSessionReadyTestServer("credential", time.Second)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		response := httptest.NewRecorder()
		server.handlePluginSessionReady(response, newPluginSessionReadyHTTPRequest("credential"))
		done <- response
	}()
	time.Sleep(20 * time.Millisecond)
	server.removeActivePluginSessionBinding("channel")

	select {
	case response := <-done:
		if response.Code != http.StatusGone {
			t.Fatalf("status = %d, want 410; body=%q", response.Code, response.Body.String())
		}
	case <-time.After(time.Second):
		t.Fatal("readiness request remained blocked after session close")
	}
}

func TestPluginSessionReadyTimesOutAsRetryableServiceFailure(t *testing.T) {
	server := newPluginSessionReadyTestServer("credential", 10*time.Millisecond)
	response := httptest.NewRecorder()
	server.handlePluginSessionReady(response, newPluginSessionReadyHTTPRequest("credential"))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%q", response.Code, response.Body.String())
	}
	var body apiResp
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error == nil || !body.Error.Retryable {
		t.Fatalf("timeout error = %#v, want retryable", body.Error)
	}
}
