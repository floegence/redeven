package agent

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"syscall"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const (
	CloudLinkErrorActiveWork         = "CLOUD_LINK_ACTIVE_WORK"
	CloudLinkErrorExchangeFailed     = "CLOUD_LINK_EXCHANGE_FAILED"
	CloudLinkErrorAlreadyLinked      = "CLOUD_LINK_ALREADY_CONNECTED"
	CloudLinkErrorDisconnectFailed   = "CLOUD_LINK_DISCONNECT_FAILED"
	CloudLinkErrorDisconnectRejected = "CLOUD_LINK_DISCONNECT_REJECTED"
	CloudLinkErrorBindingNotCurrent  = "CLOUD_LINK_NOT_CURRENT"
	CloudLinkErrorAuthorization      = "CLOUD_LINK_AUTHORIZATION_REQUIRED"
	CloudLinkErrorPermissionRevoked  = "CLOUD_LINK_PERMISSION_REVOKED"
	CloudLinkErrorUnavailable        = "CLOUD_LINK_UNAVAILABLE"
	CloudLinkErrorBindingChanged     = "CLOUD_LINK_BINDING_CHANGED"
)

func normalizeCloudOrigin(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("provider origin is required")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "https" {
		return "", fmt.Errorf("provider origin must use https, got %q", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" || strings.TrimSpace(parsed.Hostname()) == "" {
		return "", errors.New("provider origin host is required")
	}
	if strings.TrimSpace(parsed.Path) != "" && parsed.Path != "/" {
		return "", errors.New("provider origin must not include a path")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", errors.New("provider origin must not include user info, query, or fragment")
	}
	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	parsed.Path = ""
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.User = nil
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

type CloudLinkError struct {
	Code    string
	Message string
	Err     error
}

func (e *CloudLinkError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Message) != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return strings.TrimSpace(e.Code)
}

func (e *CloudLinkError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type CloudLinkRequest struct {
	CloudOrigin               string
	CloudID                   string
	EnvPublicID               string
	RuntimeLinkTicket         string
	ExpectedCloudOrigin       string
	ExpectedCloudID           string
	ExpectedEnvPublicID       string
	ExpectedAccessPointOrigin string
	ExpectedGeneration        int64
	AllowRelinkWhenIdle       bool
	RenewCurrentBinding       bool
	runtimeLinkHTTPClient     *http.Client
}

type CloudLinkResponse struct {
	Binding runtimeservice.CloudLinkBinding
}

func (a *Agent) enableProviderControlChannelLocked() runtimeservice.CloudLinkBinding {
	a.controlChannelEnabled = true
	a.remoteEnabled = true
	a.effectiveRunMode = "hybrid"
	if !a.localUIEnabled {
		a.effectiveRunMode = "remote"
	}
	return a.cloudLinkBindingLocked("")
}

func (a *Agent) providerControlChannelActiveLocked() bool {
	return a.controlChannelEnabled && a.remoteEnabled
}

func (a *Agent) CloudLinkBinding() runtimeservice.CloudLinkBinding {
	if a == nil {
		return runtimeservice.CloudLinkBinding{State: runtimeservice.CloudLinkStateUnbound}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cloudLinkBindingLocked("")
}

func (a *Agent) cloudLinkBindingLocked(errorCode string) runtimeservice.CloudLinkBinding {
	if a == nil || a.cfg == nil {
		return runtimeservice.CloudLinkBinding{State: runtimeservice.CloudLinkStateUnbound}
	}
	if association := a.cfg.CloudAssociation; association != nil {
		connectionState, code, message := a.providerConnectionLocked()
		state := runtimeservice.CloudLinkStateLinked
		if !association.Enabled {
			state, connectionState = runtimeservice.CloudLinkStateUnbound, "disabled"
		}
		if association.ApprovalState != "approved" && association.Enabled {
			connectionState, code = "authorization_required", association.ReasonCode
		}
		status := &rc.Status{AssociationRevision: association.Revision, Enabled: association.Enabled, ApprovalState: association.ApprovalState, ReasonCode: association.ReasonCode, ConnectionState: connectionState}
		if route := a.cfg.CloudRoute; route != nil {
			status.Route = rc.RouteSelection{Kind: string(route.Kind), MemberID: route.MemberID}
			status.RouteRevision = route.Revision
		}
		if controller := a.controlController; controller != nil {
			snapshot := controller.Snapshot()
			if snapshot.Diagnostic().RetryDisposition != nil {
				status.NextAttemptAtUnixMS = snapshot.Diagnostic().RetryDisposition.RetryAtUnixMilliseconds
			}
		}
		return runtimeservice.CloudLinkBinding{Cloud: status, State: state, ConnectionState: connectionState, LastErrorCode: code, LastErrorMessage: message, CloudOrigin: association.CloudOrigin, CloudID: association.CloudID, EnvPublicID: a.cfg.EnvironmentID, AccessPointOrigin: association.RegionOrigin, LocalEnvironmentPublicID: association.RuntimePublicID, BindingGeneration: a.cfg.BindingGeneration, RemoteEnabled: association.Enabled && a.remoteEnabled}
	}
	return runtimeservice.CloudLinkBinding{State: runtimeservice.CloudLinkStateUnbound, ConnectionState: "unlinked", LastErrorCode: strings.TrimSpace(errorCode)}
}

func (a *Agent) hasActiveProviderWorkLocked() bool {
	if a == nil {
		return false
	}
	for _, s := range a.sessions {
		if s == nil || s.connectedAtUnixMs <= 0 {
			continue
		}
		if strings.TrimSpace(s.meta.EndpointID) != LocalEnvPublicIDForAgent() {
			return true
		}
	}
	return false
}

// LocalEnvPublicIDForAgent avoids an import cycle with internal/localui.
func LocalEnvPublicIDForAgent() string {
	return "env_local"
}

func cloudLinkMatches(binding runtimeservice.CloudLinkBinding, req CloudLinkRequest) bool {
	return strings.TrimSpace(binding.CloudOrigin) == strings.TrimSpace(req.CloudOrigin) &&
		(strings.TrimSpace(req.CloudID) == "" || strings.TrimSpace(binding.CloudID) == strings.TrimSpace(req.CloudID)) &&
		strings.TrimSpace(binding.EnvPublicID) == strings.TrimSpace(req.EnvPublicID)
}

func requestedExpectedCloudLinkMatches(binding runtimeservice.CloudLinkBinding, req CloudLinkRequest) bool {
	expectedOrigin := strings.TrimSpace(req.ExpectedCloudOrigin)
	expectedProviderID := strings.TrimSpace(req.ExpectedCloudID)
	expectedEnvID := strings.TrimSpace(req.ExpectedEnvPublicID)
	expectedAccessPointOrigin := strings.TrimSpace(req.ExpectedAccessPointOrigin)
	expectedGeneration := req.ExpectedGeneration
	if expectedOrigin == "" && expectedProviderID == "" && expectedEnvID == "" && expectedAccessPointOrigin == "" && expectedGeneration <= 0 {
		return true
	}
	return strings.TrimSpace(binding.CloudOrigin) == expectedOrigin &&
		strings.TrimSpace(binding.CloudID) == expectedProviderID &&
		strings.TrimSpace(binding.EnvPublicID) == expectedEnvID &&
		strings.TrimSpace(binding.AccessPointOrigin) == expectedAccessPointOrigin &&
		(expectedGeneration <= 0 || binding.BindingGeneration == expectedGeneration)
}

func (a *Agent) cloudLinkCanReplaceCurrentLocked(req CloudLinkRequest) *CloudLinkError {
	current := a.cloudLinkBindingLocked("")
	if !requestedExpectedCloudLinkMatches(current, req) {
		return &CloudLinkError{
			Code:    CloudLinkErrorAlreadyLinked,
			Message: "Local Runtime is already connected to another provider Environment.",
		}
	}
	if current.State == runtimeservice.CloudLinkStateLinked && cloudLinkMatches(current, req) {
		return nil
	}
	if current.State == runtimeservice.CloudLinkStateLinked && !req.AllowRelinkWhenIdle {
		return &CloudLinkError{
			Code:    CloudLinkErrorAlreadyLinked,
			Message: "Local Runtime is already connected to a provider Environment.",
		}
	}
	if current.State == runtimeservice.CloudLinkStateLinked && a.hasActiveProviderWorkLocked() {
		return &CloudLinkError{
			Code:    CloudLinkErrorActiveWork,
			Message: "Local Runtime has active provider-originated work. Disconnect that work before relinking.",
		}
	}
	return nil
}

func (a *Agent) ConnectCloud(ctx context.Context, req CloudLinkRequest) (*CloudLinkResponse, error) {
	if a == nil {
		return nil, errors.New("nil agent")
	}
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()

	cloudOrigin := strings.TrimSpace(req.CloudOrigin)
	envPublicID := strings.TrimSpace(req.EnvPublicID)
	runtimeLinkTicket := strings.TrimSpace(req.RuntimeLinkTicket)
	if cloudOrigin == "" || envPublicID == "" || runtimeLinkTicket == "" {
		return nil, &CloudLinkError{
			Code:    "CLOUD_LINK_INVALID_REQUEST",
			Message: "Cloud origin, environment id, and Runtime link ticket are required.",
		}
	}
	normalizedCloudOrigin, err := normalizeCloudOrigin(cloudOrigin)
	if err != nil {
		return nil, &CloudLinkError{
			Code:    "CLOUD_LINK_INVALID_REQUEST",
			Message: fmt.Sprintf("Cloud origin is invalid: %v", err),
			Err:     err,
		}
	}
	req.CloudOrigin = normalizedCloudOrigin
	req.CloudID = strings.TrimSpace(req.CloudID)
	req.EnvPublicID = envPublicID
	cloudOrigin = normalizedCloudOrigin

	a.mu.Lock()
	current := a.cloudLinkBindingLocked("")
	matchingCurrent := current.State == runtimeservice.CloudLinkStateLinked && cloudLinkMatches(current, req)
	if req.RenewCurrentBinding && (!matchingCurrent || req.ExpectedGeneration <= 0 || !requestedExpectedCloudLinkMatches(current, req)) {
		a.mu.Unlock()
		return nil, &CloudLinkError{Code: "CLOUD_LINK_BINDING_CHANGED", Message: "The saved Redeven Cloud connection has changed. Review the current connection before reconnecting."}
	}
	if linkErr := a.cloudLinkCanReplaceCurrentLocked(req); linkErr != nil {
		a.mu.Unlock()
		return nil, linkErr
	}
	// IMPORTANT: A persisted provider link is explicit user authorization for
	// runtime startup to restore the provider control channel. This
	// idempotent path exists for explicit refreshes, not as normal UI repair.
	if matchingCurrent && a.providerControlChannelActiveLocked() && a.controlRegistered {
		a.mu.Unlock()
		return &CloudLinkResponse{Binding: current}, nil
	}
	a.mu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}
	expectedGeneration := int64(0)
	if req.RenewCurrentBinding {
		expectedGeneration = req.ExpectedGeneration
	}
	cfg, err := config.ResolveCloudLinkConfig(ctx, config.CloudLinkBootstrapArgs{
		ExpectedBindingGeneration: expectedGeneration,
		ConfigPath:                a.configPath,
		CloudOrigin:               cloudOrigin,
		CloudID:                   strings.TrimSpace(req.CloudID),
		EnvironmentID:             envPublicID,
		RuntimeLinkTicket:         runtimeLinkTicket,
		RuntimeVersion:            strings.TrimSpace(a.version),
		RuntimeGOOS:               runtime.GOOS,
		RuntimeGOARCH:             runtime.GOARCH,
		RuntimeHostname:           hostnameBestEffort(),
		PreservePermissionPolicy:  true,
		HTTPClient:                req.runtimeLinkHTTPClient,
	})
	if err != nil {
		code := CloudLinkErrorExchangeFailed
		var exchangeErr *config.RuntimeLinkExchangeError
		var cloudErr *runtimecloud.Error
		var networkErr net.Error
		var dnsErr *net.DNSError
		if errors.As(err, &cloudErr) {
			switch {
			case cloudErr.Status == 401:
				code = CloudLinkErrorAuthorization
			case cloudErr.Status == 403:
				code = CloudLinkErrorPermissionRevoked
			case cloudErr.Status == 429 || cloudErr.Status >= 500:
				code = CloudLinkErrorUnavailable
			}
		} else if errors.As(err, &exchangeErr) {
			switch {
			case exchangeErr.Code == "RUNTIME_LINK_BINDING_STALE":
				code = CloudLinkErrorBindingChanged
			case exchangeErr.Code == "NOT_AUTHORIZED" || exchangeErr.StatusCode == http.StatusForbidden:
				// A valid Cloud account can lose namespace administration without
				// losing its sign-in session. Keep this distinct from expired
				// credentials so recovery asks for permission review instead of
				// sending the user through a needless sign-in loop.
				code = CloudLinkErrorPermissionRevoked
			case exchangeErr.StatusCode == http.StatusUnauthorized:
				code = CloudLinkErrorAuthorization
			case exchangeErr.StatusCode == 429 || exchangeErr.StatusCode >= 500:
				code = CloudLinkErrorUnavailable
			}
		} else if errors.As(err, &networkErr) && networkErr.Timeout() ||
			errors.As(err, &dnsErr) && (dnsErr.IsTimeout || dnsErr.IsTemporary) ||
			errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET) ||
			errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.EHOSTUNREACH) {
			// A Region that is not listening yet must not permanently stop Desktop recovery.
			// Certificate and protocol failures remain terminal.
			code = CloudLinkErrorUnavailable
		}
		return nil, &CloudLinkError{Code: code, Message: fmt.Sprintf("Cloud link exchange failed: %v", err), Err: err}
	}

	a.mu.Lock()
	if linkErr := a.cloudLinkCanReplaceCurrentLocked(req); linkErr != nil {
		a.mu.Unlock()
		return nil, linkErr
	}
	// Independent reconnect progress may advance during the Cloud exchange.
	if a.cfg != nil {
		cfg.Gateways = a.cfg.CloneGateways()
		cfg.GatewayRemovalOutbox = append([]gatewaymembership.RemovalDelivery(nil), a.cfg.GatewayRemovalOutbox...)
	}
	if err := config.SaveCloudLinkConnectionConfig(a.configPath, cfg); err != nil {
		a.mu.Unlock()
		return nil, &CloudLinkError{
			Code:    CloudLinkErrorExchangeFailed,
			Message: fmt.Sprintf("Persist Cloud link config failed: %v", err),
			Err:     err,
		}
	}
	a.setRemoteConfigLocked(cfg)
	binding := a.enableProviderControlChannelLocked()
	a.mu.Unlock()
	if a.code != nil {
		_ = a.code.SetAccessPointOrigin(cfg.AccessPointOrigin)
	}
	a.startOrRestartControlChannel()

	return &CloudLinkResponse{Binding: binding}, nil
}

func (a *Agent) DisconnectCloud(ctx context.Context) (*CloudLinkResponse, error) {
	if a == nil {
		return nil, errors.New("nil agent")
	}
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	return a.disconnectCloudAssociation(ctx)
}
