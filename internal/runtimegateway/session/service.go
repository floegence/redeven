package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

type ErrorCode string

const (
	ErrorCodeInvalidRequest        ErrorCode = "INVALID_REQUEST"
	ErrorCodeNotFound              ErrorCode = "NOT_FOUND"
	ErrorCodeCapabilityUnsupported ErrorCode = "CAPABILITY_UNSUPPORTED"
	ErrorCodeNotImplemented        ErrorCode = "NOT_IMPLEMENTED"
)

type GatewayError struct {
	Code    ErrorCode
	Message string
}

func (e *GatewayError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

type ConnectArtifactIssuer interface {
	IssueGatewayConnectArtifact(ctx context.Context, req protocol.OpenSessionRequest) (GatewayConnectArtifactIssue, error)
}

type GatewayConnectArtifactIssue struct {
	GatewayID        string
	GatewaySessionID string
	ConnectArtifact  protocol.GatewayConnectArtifact
	DiagnosticsHint  *protocol.DiagnosticsHint
}

type Service struct {
	issuer ConnectArtifactIssuer
}

type ServiceOption func(*Service)

func WithConnectArtifactIssuer(issuer ConnectArtifactIssuer) ServiceOption {
	return func(s *Service) {
		s.issuer = issuer
	}
}

func NewService(options ...ServiceOption) *Service {
	service := &Service{}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) OpenSession(ctx context.Context, req protocol.OpenSessionRequest) (*protocol.OpenSessionResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	req = protocol.NormalizeOpenSessionRequest(req)
	if err := protocol.ValidateProtocolVersion(req.ProtocolVersion); err != nil {
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: "protocol_version is not supported.",
		}
	}
	if err := protocol.ValidateOpenSessionRequest(req); err != nil {
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: openSessionValidationMessage(err),
		}
	}
	if req.GatewayEnvID == protocol.ReservedLocalEnvironmentID {
		return nil, &GatewayError{
			Code:    ErrorCodeNotFound,
			Message: "Gateway environment was not found.",
		}
	}
	if s == nil || s.issuer == nil {
		return nil, &GatewayError{
			Code:    ErrorCodeNotImplemented,
			Message: "Gateway session opening is not configured in this service.",
		}
	}
	issue, err := s.issuer.IssueGatewayConnectArtifact(ctx, req)
	if err != nil {
		var gatewayErr *GatewayError
		if errors.As(err, &gatewayErr) {
			return nil, err
		}
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: sanitizeGatewayErrorMessage(err),
		}
	}
	if strings.TrimSpace(issue.GatewaySessionID) == "" || strings.TrimSpace(issue.GatewayID) == "" {
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: "Gateway session artifact is incomplete.",
		}
	}
	response := &protocol.OpenSessionResponse{
		ProtocolVersion:  protocol.Version,
		GatewaySessionID: strings.TrimSpace(issue.GatewaySessionID),
		GatewayEnvID:     req.GatewayEnvID,
		ConnectArtifact:  issue.ConnectArtifact,
		DiagnosticsHint:  issue.DiagnosticsHint,
	}
	if response.ConnectArtifact.ExpiresAtUnixMS <= time.Now().UnixMilli() ||
		strings.TrimSpace(response.ConnectArtifact.ArtifactNonce) == "" ||
		strings.TrimSpace(response.ConnectArtifact.Proof) == "" ||
		!connectArtifactShapeValid(response.ConnectArtifact) {
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: "Gateway session artifact is invalid.",
		}
	}
	return response, nil
}

func openSessionValidationMessage(err error) string {
	switch {
	case errors.Is(err, protocol.ErrMissingGatewayEnvID):
		return "gateway_env_id is required."
	case errors.Is(err, protocol.ErrMissingRequestedCapability):
		return "requested_capability is required."
	case errors.Is(err, protocol.ErrMissingClientNonce):
		return "client_nonce is required."
	default:
		return "Gateway open-session request is invalid."
	}
}

func connectArtifactShapeValid(artifact protocol.GatewayConnectArtifact) bool {
	switch artifact.Kind {
	case protocol.ConnectArtifactKindLocalDirect:
		return strings.TrimSpace(artifact.URL) != ""
	case protocol.ConnectArtifactKindDesktopBridge:
		return strings.TrimSpace(artifact.BridgeSessionID) != "" && strings.TrimSpace(artifact.RouteID) != ""
	default:
		return false
	}
}

func NewSignedLocalDirectIssue(input struct {
	GatewayID           string
	GatewayEnvID        string
	BindingAudience     string
	RequestedCapability protocol.RequestedCapability
	ClientNonce         string
	URL                 string
	GatewayPrivateKey   string
	TTL                 time.Duration
}) (GatewayConnectArtifactIssue, error) {
	gatewayID := strings.TrimSpace(input.GatewayID)
	gatewayEnvID := strings.TrimSpace(input.GatewayEnvID)
	bindingAudience := strings.TrimSpace(input.BindingAudience)
	url := strings.TrimSpace(input.URL)
	if gatewayID == "" || gatewayEnvID == "" || bindingAudience == "" || url == "" {
		return GatewayConnectArtifactIssue{}, errors.New("Gateway local direct artifact input is incomplete")
	}
	gatewaySessionID, err := randomID("gws", 24)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	artifactNonce, err := randomID("ga", 18)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	ttl := input.TTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	expiresAt := time.Now().Add(ttl).UnixMilli()
	payload, err := security.CanonicalJSON(map[string]any{
		"artifact_kind":        string(protocol.ConnectArtifactKindLocalDirect),
		"artifact_nonce":       artifactNonce,
		"artifact_url":         url,
		"binding_audience":     bindingAudience,
		"bridge_session_id":    "",
		"client_nonce":         strings.TrimSpace(input.ClientNonce),
		"expires_at_unix_ms":   expiresAt,
		"gateway_env_id":       gatewayEnvID,
		"gateway_id":           gatewayID,
		"gateway_session_id":   gatewaySessionID,
		"protocol_version":     protocol.Version,
		"requested_capability": string(input.RequestedCapability),
		"route_id":             "",
	})
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	proof, err := security.SignPayload(input.GatewayPrivateKey, payload)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	return GatewayConnectArtifactIssue{
		GatewayID:        gatewayID,
		GatewaySessionID: gatewaySessionID,
		ConnectArtifact: protocol.GatewayConnectArtifact{
			Kind:            protocol.ConnectArtifactKindLocalDirect,
			URL:             url,
			ExpiresAtUnixMS: expiresAt,
			ArtifactNonce:   artifactNonce,
			Proof:           proof,
		},
		DiagnosticsHint: &protocol.DiagnosticsHint{
			GatewayEnvID:   gatewayEnvID,
			ConnectionKind: "gateway_url",
		},
	}, nil
}

func NewSignedDesktopBridgeIssue(input struct {
	GatewayID           string
	GatewayEnvID        string
	BindingAudience     string
	RequestedCapability protocol.RequestedCapability
	ClientNonce         string
	BridgeSessionID     string
	RouteID             string
	GatewayPrivateKey   string
	TTL                 time.Duration
}) (GatewayConnectArtifactIssue, error) {
	gatewayID := strings.TrimSpace(input.GatewayID)
	gatewayEnvID := strings.TrimSpace(input.GatewayEnvID)
	bindingAudience := strings.TrimSpace(input.BindingAudience)
	bridgeSessionID := strings.TrimSpace(input.BridgeSessionID)
	routeID := strings.TrimSpace(input.RouteID)
	if gatewayID == "" || gatewayEnvID == "" || bindingAudience == "" || bridgeSessionID == "" || routeID == "" {
		return GatewayConnectArtifactIssue{}, errors.New("Gateway desktop bridge artifact input is incomplete")
	}
	gatewaySessionID, err := randomID("gws", 24)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	artifactNonce, err := randomID("ga", 18)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	ttl := input.TTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	expiresAt := time.Now().Add(ttl).UnixMilli()
	payload, err := security.CanonicalJSON(map[string]any{
		"artifact_kind":        string(protocol.ConnectArtifactKindDesktopBridge),
		"artifact_nonce":       artifactNonce,
		"artifact_url":         "",
		"binding_audience":     bindingAudience,
		"bridge_session_id":    bridgeSessionID,
		"client_nonce":         strings.TrimSpace(input.ClientNonce),
		"expires_at_unix_ms":   expiresAt,
		"gateway_env_id":       gatewayEnvID,
		"gateway_id":           gatewayID,
		"gateway_session_id":   gatewaySessionID,
		"protocol_version":     protocol.Version,
		"requested_capability": string(input.RequestedCapability),
		"route_id":             routeID,
	})
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	proof, err := security.SignPayload(input.GatewayPrivateKey, payload)
	if err != nil {
		return GatewayConnectArtifactIssue{}, err
	}
	return GatewayConnectArtifactIssue{
		GatewayID:        gatewayID,
		GatewaySessionID: gatewaySessionID,
		ConnectArtifact: protocol.GatewayConnectArtifact{
			Kind:            protocol.ConnectArtifactKindDesktopBridge,
			BridgeSessionID: bridgeSessionID,
			RouteID:         routeID,
			ExpiresAtUnixMS: expiresAt,
			ArtifactNonce:   artifactNonce,
			Proof:           proof,
		},
		DiagnosticsHint: &protocol.DiagnosticsHint{
			GatewayEnvID:   gatewayEnvID,
			ConnectionKind: "desktop_bridge",
		},
	}, nil
}

func sanitizeGatewayErrorMessage(err error) string {
	text := strings.TrimSpace(fmt.Sprint(err))
	if text == "" {
		return "Gateway open-session request is invalid."
	}
	for _, needle := range []string{"token", "secret", "password", "bearer", "signature", "private_key", "proof"} {
		text = strings.ReplaceAll(text, needle, "[redacted]")
		text = strings.ReplaceAll(text, strings.ToUpper(needle), "[redacted]")
	}
	if len(text) > 240 {
		text = text[:240]
	}
	return text
}

func randomID(prefix string, n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid random byte length")
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return strings.TrimSpace(prefix) + "_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

func IsGatewayErrorCode(err error, code ErrorCode) bool {
	var gatewayErr *GatewayError
	return errors.As(err, &gatewayErr) && gatewayErr.Code == code
}
