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
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/codeapp"
	"github.com/floegence/redeven/internal/config"
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

const providerDisconnectReasonUser = "user_disconnect"

var errProviderControlChannelNotConnected = errors.New("provider control channel is not connected")

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

func normalizeAccessPointOrigin(raw string) (string, error) {
	origin, err := normalizeCloudOrigin(raw)
	if err != nil {
		return "", err
	}
	if err := codeapp.ValidateAccessPointOrigin(origin); err != nil {
		return "", err
	}
	return origin, nil
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

type providerDisconnectSnapshot struct {
	CloudOrigin              string
	CloudID                  string
	EnvPublicID              string
	AccessPointOrigin        string
	LocalEnvironmentPublicID string
	BindingGeneration        int64
	AgentInstanceID          string
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
	if err := a.cfg.ValidateRemoteStrict(); err != nil {
		return runtimeservice.CloudLinkBinding{
			State:                    runtimeservice.CloudLinkStateUnbound,
			LastErrorCode:            strings.TrimSpace(errorCode),
			LastDisconnectedAtUnixMS: time.Now().UnixMilli(),
		}
	}
	connectionState, connectionCode, connectionMessage := a.providerConnectionLocked()
	return runtimeservice.NormalizeCloudLinkBinding(runtimeservice.CloudLinkBinding{
		State:                    runtimeservice.CloudLinkStateLinked,
		ConnectionState:          connectionState,
		LastErrorCode:            connectionCode,
		LastErrorMessage:         connectionMessage,
		CloudOrigin:              a.cfg.CloudOrigin,
		CloudID:                  a.cfg.CloudID,
		EnvPublicID:              a.cfg.EnvironmentID,
		AccessPointOrigin:        a.cfg.AccessPointOrigin,
		LocalEnvironmentPublicID: a.cfg.LocalEnvironmentPublicID,
		BindingGeneration:        a.cfg.BindingGeneration,
		RemoteEnabled:            a.remoteEnabled,
	}, runtimeservice.Capability{Supported: true, BindMethod: runtimeservice.RuntimeControlBindMethodV2})
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

func providerDisconnectSnapshotFromConfig(cfg *config.Config) (providerDisconnectSnapshot, error) {
	if cfg == nil {
		return providerDisconnectSnapshot{}, errors.New("missing config")
	}
	if err := cfg.ValidateRemoteStrict(); err != nil {
		return providerDisconnectSnapshot{}, err
	}
	snapshot := providerDisconnectSnapshot{
		CloudOrigin:              strings.TrimSpace(cfg.CloudOrigin),
		CloudID:                  strings.TrimSpace(cfg.CloudID),
		EnvPublicID:              strings.TrimSpace(cfg.EnvironmentID),
		AccessPointOrigin:        strings.TrimSpace(cfg.AccessPointOrigin),
		LocalEnvironmentPublicID: strings.TrimSpace(cfg.LocalEnvironmentPublicID),
		BindingGeneration:        cfg.BindingGeneration,
		AgentInstanceID:          strings.TrimSpace(cfg.AgentInstanceID),
	}
	if snapshot.CloudID == "" {
		return providerDisconnectSnapshot{}, errors.New("missing cloud_id")
	}
	return snapshot, nil
}

func (a *Agent) cloudLinkCanReplaceCurrentLocked(req CloudLinkRequest) *CloudLinkError {
	if a.cfg != nil && (a.cfg.Gateway != nil || a.cfg.GatewayPublication != nil || a.cfg.GatewayMigrationEvidence != nil || a.cfg.GatewayRejoinRequired) {
		return &CloudLinkError{Code: CloudLinkErrorAlreadyLinked, Message: "Gateway Cloud access requires explicit migration before changing the provider binding."}
	}
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
		var networkErr net.Error
		var dnsErr *net.DNSError
		if errors.As(err, &exchangeErr) {
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
	if err := config.SaveCloudLinkConfig(a.configPath, cfg); err != nil {
		a.mu.Unlock()
		return nil, &CloudLinkError{
			Code:    CloudLinkErrorExchangeFailed,
			Message: fmt.Sprintf("Persist Cloud link config failed: %v", err),
			Err:     err,
		}
	}
	a.cfg = cfg
	binding := a.enableProviderControlChannelLocked()
	a.mu.Unlock()
	if a.code != nil {
		_ = a.code.SetAccessPointOrigin(cfg.AccessPointOrigin)
	}
	a.startOrRestartControlChannel()

	return &CloudLinkResponse{Binding: binding}, nil
}

func cloudLinkDisconnectError(err error) *CloudLinkError {
	if err == nil {
		return nil
	}
	var rpcErr *flowersec.RPCError
	if errors.As(err, &rpcErr) && rpcErr.Code == 409 {
		return &CloudLinkError{
			Code:    CloudLinkErrorBindingNotCurrent,
			Message: "Provider binding is no longer current. Refresh Desktop, then connect or disconnect again.",
			Err:     err,
		}
	}
	return &CloudLinkError{
		Code:    CloudLinkErrorDisconnectFailed,
		Message: fmt.Sprintf("Provider disconnect failed: %v", err),
		Err:     err,
	}
}

func (a *Agent) providerDisconnectShouldNotifyLocked() bool {
	return a.providerControlChannelActiveLocked() && a.controlRPC != nil
}

func (a *Agent) clearCloudLinkBindingLocked(snapshot providerDisconnectSnapshot) (runtimeservice.CloudLinkBinding, error) {
	if a.cfg == nil ||
		strings.TrimSpace(a.cfg.CloudOrigin) != snapshot.CloudOrigin ||
		strings.TrimSpace(a.cfg.AccessPointOrigin) != snapshot.AccessPointOrigin ||
		strings.TrimSpace(a.cfg.CloudID) != snapshot.CloudID ||
		strings.TrimSpace(a.cfg.EnvironmentID) != snapshot.EnvPublicID ||
		strings.TrimSpace(a.cfg.LocalEnvironmentPublicID) != snapshot.LocalEnvironmentPublicID ||
		a.cfg.BindingGeneration != snapshot.BindingGeneration {
		return runtimeservice.CloudLinkBinding{}, &CloudLinkError{
			Code:    CloudLinkErrorBindingNotCurrent,
			Message: "Provider binding changed while disconnecting. Refresh Desktop, then connect or disconnect again.",
		}
	}
	next := *a.cfg
	next.CloudOrigin = ""
	next.AccessPointOrigin = ""
	next.CloudID = ""
	next.EnvironmentID = ""
	next.LocalEnvironmentPublicID = ""
	next.BindingGeneration = 0
	next.Direct = nil
	next.ControlArtifactPool = nil
	if strings.TrimSpace(next.AgentInstanceID) == "" {
		next.AgentInstanceID = a.cfg.AgentInstanceID
	}
	if err := config.Save(a.configPath, &next); err != nil {
		return runtimeservice.CloudLinkBinding{}, &CloudLinkError{
			Code:    CloudLinkErrorDisconnectFailed,
			Message: fmt.Sprintf("Persist provider disconnect failed: %v", err),
			Err:     err,
		}
	}
	a.cfg = &next
	a.controlChannelEnabled = false
	a.remoteEnabled = false
	a.effectiveRunMode = "local"
	return runtimeservice.CloudLinkBinding{
		State:                    runtimeservice.CloudLinkStateUnbound,
		LastDisconnectedAtUnixMS: time.Now().UnixMilli(),
	}, nil
}

func (a *Agent) DisconnectCloud(ctx context.Context) (*CloudLinkResponse, error) {
	if a == nil {
		return nil, errors.New("nil agent")
	}
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()

	a.mu.Lock()
	cfg := a.cfg
	if cfg == nil {
		a.mu.Unlock()
		return nil, &CloudLinkError{
			Code:    CloudLinkErrorDisconnectRejected,
			Message: "Provider disconnect requires a runtime config.",
		}
	}
	if cfg.GatewayPublication != nil {
		a.mu.Unlock()
		return nil, &CloudLinkError{Code: CloudLinkErrorDisconnectRejected, Message: "Manage this Namespace access from the Gateway page in Redeven Cloud."}
	}
	snapshot, snapshotErr := providerDisconnectSnapshotFromConfig(cfg)
	if snapshotErr != nil {
		a.mu.Unlock()
		return nil, &CloudLinkError{
			Code:    CloudLinkErrorDisconnectRejected,
			Message: fmt.Sprintf("Provider disconnect requires a valid linked provider binding: %v", snapshotErr),
			Err:     snapshotErr,
		}
	}
	notifyProvider := a.providerDisconnectShouldNotifyLocked()
	a.mu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}
	if notifyProvider {
		if err := a.sendRuntimeDisconnect(ctx, snapshot, providerDisconnectReasonUser); err != nil && !errors.Is(err, errProviderControlChannelNotConnected) {
			return nil, cloudLinkDisconnectError(err)
		}
	}

	a.mu.Lock()
	binding, clearErr := a.clearCloudLinkBindingLocked(snapshot)
	a.mu.Unlock()
	if clearErr != nil {
		return nil, clearErr
	}

	if a.code != nil {
		if err := a.code.SetAccessPointOrigin(""); err != nil {
			return nil, &CloudLinkError{
				Code:    CloudLinkErrorDisconnectFailed,
				Message: fmt.Sprintf("Clear provider origin failed: %v", err),
				Err:     err,
			}
		}
	}
	a.stopControlChannel()
	return &CloudLinkResponse{Binding: binding}, nil
}
