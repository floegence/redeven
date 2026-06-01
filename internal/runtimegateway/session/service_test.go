package session

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestOpenSessionValidatesRequest(t *testing.T) {
	_, err := NewService().OpenSession(context.Background(), protocol.OpenSessionRequest{})
	if !IsGatewayErrorCode(err, ErrorCodeInvalidRequest) {
		t.Fatalf("OpenSession() error = %v, want %s", err, ErrorCodeInvalidRequest)
	}
	if ErrorContainsCredentialWord(err) {
		t.Fatalf("OpenSession() error leaks credential-shaped wording: %v", err)
	}
}

func TestOpenSessionReturnsTypedNotImplementedWithoutCredentialLeak(t *testing.T) {
	_, err := NewService().OpenSession(context.Background(), protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        " env_demo ",
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         " nonce_demo ",
	})
	if !IsGatewayErrorCode(err, ErrorCodeNotImplemented) {
		t.Fatalf("OpenSession() error = %v, want %s", err, ErrorCodeNotImplemented)
	}
	if ErrorContainsCredentialWord(err) {
		t.Fatalf("OpenSession() error leaks credential-shaped wording: %v", err)
	}
}

func TestOpenSessionRejectsUnsupportedProtocolVersion(t *testing.T) {
	_, err := NewService().OpenSession(context.Background(), protocol.OpenSessionRequest{
		ProtocolVersion:     "v0",
		GatewayEnvID:        "env_demo",
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         "nonce_demo",
	})
	if !IsGatewayErrorCode(err, ErrorCodeInvalidRequest) {
		t.Fatalf("OpenSession() error = %v, want %s", err, ErrorCodeInvalidRequest)
	}
	if !strings.Contains(fmt.Sprint(err), "protocol_version") {
		t.Fatalf("OpenSession() error = %v, want protocol_version message", err)
	}
}

func TestOpenSessionReturnsSignedLocalDirectArtifact(t *testing.T) {
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	service := NewService(WithConnectArtifactIssuer(ConnectArtifactIssuerFunc(func(_ context.Context, req protocol.OpenSessionRequest) (GatewayConnectArtifactIssue, error) {
		return NewSignedLocalDirectIssue(struct {
			GatewayID           string
			GatewayEnvID        string
			BindingAudience     string
			RequestedCapability protocol.RequestedCapability
			ClientNonce         string
			URL                 string
			GatewayPrivateKey   string
			TTL                 time.Duration
		}{
			GatewayID:           "gw_demo",
			GatewayEnvID:        req.GatewayEnvID,
			BindingAudience:     "http://127.0.0.1:24000/",
			RequestedCapability: req.RequestedCapability,
			ClientNonce:         req.ClientNonce,
			URL:                 "http://127.0.0.1:24000/_redeven_proxy/env/",
			GatewayPrivateKey:   keys.PrivateKeyPEM,
			TTL:                 time.Minute,
		})
	})))

	resp, err := service.OpenSession(context.Background(), protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        " env_local ",
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         " client-nonce ",
	})
	if err != nil {
		t.Fatalf("OpenSession() error = %v", err)
	}
	if resp.GatewayEnvID != "env_local" || resp.ConnectArtifact.Kind != protocol.ConnectArtifactKindLocalDirect || resp.ConnectArtifact.URL == "" {
		t.Fatalf("OpenSession() response = %#v", resp)
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"artifact_kind":        string(protocol.ConnectArtifactKindLocalDirect),
		"artifact_nonce":       resp.ConnectArtifact.ArtifactNonce,
		"artifact_url":         resp.ConnectArtifact.URL,
		"binding_audience":     "http://127.0.0.1:24000/",
		"bridge_session_id":    "",
		"client_nonce":         "client-nonce",
		"expires_at_unix_ms":   resp.ConnectArtifact.ExpiresAtUnixMS,
		"gateway_env_id":       "env_local",
		"gateway_id":           "gw_demo",
		"gateway_session_id":   resp.GatewaySessionID,
		"protocol_version":     protocol.Version,
		"requested_capability": string(protocol.RequestedCapabilityEnvApp),
		"route_id":             "",
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	if !security.VerifySignature(keys.PublicKeyPEM, payload, resp.ConnectArtifact.Proof) {
		t.Fatalf("artifact proof did not verify")
	}
}

func TestOpenSessionReturnsSignedDesktopBridgeArtifact(t *testing.T) {
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	service := NewService(WithConnectArtifactIssuer(ConnectArtifactIssuerFunc(func(_ context.Context, req protocol.OpenSessionRequest) (GatewayConnectArtifactIssue, error) {
		return NewSignedDesktopBridgeIssue(struct {
			GatewayID           string
			GatewayEnvID        string
			BindingAudience     string
			RequestedCapability protocol.RequestedCapability
			ClientNonce         string
			BridgeSessionID     string
			RouteID             string
			GatewayPrivateKey   string
			TTL                 time.Duration
		}{
			GatewayID:           "gw_demo",
			GatewayEnvID:        req.GatewayEnvID,
			BindingAudience:     "ssh://bastion:22/opt/redeven",
			RequestedCapability: req.RequestedCapability,
			ClientNonce:         req.ClientNonce,
			BridgeSessionID:     req.BridgeSessionID,
			RouteID:             req.RouteID,
			GatewayPrivateKey:   keys.PrivateKeyPEM,
			TTL:                 time.Minute,
		})
	})))

	resp, err := service.OpenSession(context.Background(), protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        " env_local ",
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         " client-nonce ",
		BridgeSessionID:     " bridge-demo ",
		RouteID:             " route-demo ",
	})
	if err != nil {
		t.Fatalf("OpenSession() error = %v", err)
	}
	if resp.GatewayEnvID != "env_local" || resp.ConnectArtifact.Kind != protocol.ConnectArtifactKindDesktopBridge {
		t.Fatalf("OpenSession() response = %#v", resp)
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"artifact_kind":        string(protocol.ConnectArtifactKindDesktopBridge),
		"artifact_nonce":       resp.ConnectArtifact.ArtifactNonce,
		"artifact_url":         "",
		"binding_audience":     "ssh://bastion:22/opt/redeven",
		"bridge_session_id":    "bridge-demo",
		"client_nonce":         "client-nonce",
		"expires_at_unix_ms":   resp.ConnectArtifact.ExpiresAtUnixMS,
		"gateway_env_id":       "env_local",
		"gateway_id":           "gw_demo",
		"gateway_session_id":   resp.GatewaySessionID,
		"protocol_version":     protocol.Version,
		"requested_capability": string(protocol.RequestedCapabilityEnvApp),
		"route_id":             "route-demo",
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	if !security.VerifySignature(keys.PublicKeyPEM, payload, resp.ConnectArtifact.Proof) {
		t.Fatalf("artifact proof did not verify")
	}
}

type ConnectArtifactIssuerFunc func(context.Context, protocol.OpenSessionRequest) (GatewayConnectArtifactIssue, error)

func (fn ConnectArtifactIssuerFunc) IssueGatewayConnectArtifact(ctx context.Context, req protocol.OpenSessionRequest) (GatewayConnectArtifactIssue, error) {
	return fn(ctx, req)
}

func ErrorContainsCredentialWord(err error) bool {
	msg := strings.ToLower(fmt.Sprint(err))
	return strings.Contains(msg, "bearer") || strings.Contains(msg, "token")
}
