package main

import (
	"os"
	"testing"
)

func TestDesktopAIBrokerEndpointFromEnv(t *testing.T) {
	endpoint := desktopAIBrokerEndpointFromEnv([]string{
		"REDEVEN_DESKTOP_AI_BROKER_URL=http://127.0.0.1:44123",
		"REDEVEN_DESKTOP_AI_BROKER_TOKEN=broker-token",
		"REDEVEN_DESKTOP_AI_BROKER_SESSION_ID=broker_session",
		"REDEVEN_DESKTOP_AI_BROKER_SSH_RUNTIME_KEY=ssh:devbox:22:key_agent:remote_default",
		"REDEVEN_DESKTOP_AI_BROKER_EXPIRES_AT_UNIX_MS=1770000000000",
	})
	if endpoint == nil {
		t.Fatalf("desktopAIBrokerEndpointFromEnv returned nil")
	}
	if endpoint.URL != "http://127.0.0.1:44123" {
		t.Fatalf("URL=%q", endpoint.URL)
	}
	if endpoint.Token != "broker-token" {
		t.Fatalf("Token=%q", endpoint.Token)
	}
	if endpoint.SessionID != "broker_session" {
		t.Fatalf("SessionID=%q", endpoint.SessionID)
	}
	if endpoint.SSHRuntimeKey != "ssh:devbox:22:key_agent:remote_default" {
		t.Fatalf("SSHRuntimeKey=%q", endpoint.SSHRuntimeKey)
	}
	if endpoint.ExpiresAtUnixMS != 1770000000000 {
		t.Fatalf("ExpiresAtUnixMS=%d", endpoint.ExpiresAtUnixMS)
	}
	if endpoint.ModelSource != "desktop_local_environment" {
		t.Fatalf("ModelSource=%q", endpoint.ModelSource)
	}
}

func TestDesktopAIBrokerEndpointFromEnvRequiresURLAndToken(t *testing.T) {
	if got := desktopAIBrokerEndpointFromEnv([]string{
		"REDEVEN_DESKTOP_AI_BROKER_URL=http://127.0.0.1:44123",
	}); got != nil {
		t.Fatalf("endpoint without token=%#v, want nil", got)
	}
	if got := desktopAIBrokerEndpointFromEnv([]string{
		"REDEVEN_DESKTOP_AI_BROKER_TOKEN=broker-token",
	}); got != nil {
		t.Fatalf("endpoint without url=%#v, want nil", got)
	}
}

func TestClearDesktopAIBrokerEndpointEnv(t *testing.T) {
	for _, name := range desktopAIBrokerEndpointEnvNames {
		t.Setenv(name, "secret-value")
	}

	clearDesktopAIBrokerEndpointEnv()

	for _, name := range desktopAIBrokerEndpointEnvNames {
		if got := os.Getenv(name); got != "" {
			t.Fatalf("%s still set to %q", name, got)
		}
	}
}
