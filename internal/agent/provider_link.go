package agent

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/codeapp"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const (
	ProviderLinkErrorActiveWork      = "PROVIDER_LINK_ACTIVE_WORK"
	ProviderLinkErrorBootstrapFailed = "PROVIDER_LINK_BOOTSTRAP_FAILED"
	ProviderLinkErrorAlreadyLinked   = "PROVIDER_LINK_ALREADY_CONNECTED"
)

type ProviderLinkError struct {
	Code    string
	Message string
	Err     error
}

func (e *ProviderLinkError) Error() string {
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

func (e *ProviderLinkError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type ProviderLinkRequest struct {
	ProviderOrigin         string
	ProviderID             string
	EnvPublicID            string
	BootstrapTicket        string
	ExpectedProviderOrigin string
	ExpectedProviderID     string
	ExpectedEnvPublicID    string
	ExpectedGeneration     int64
	AllowRelinkWhenIdle    bool
}

type ProviderLinkResponse struct {
	Binding runtimeservice.ProviderLinkBinding
}

func (a *Agent) ProviderLinkBinding() runtimeservice.ProviderLinkBinding {
	if a == nil || a.cfg == nil {
		return runtimeservice.ProviderLinkBinding{State: runtimeservice.ProviderLinkStateUnbound}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.providerLinkBindingLocked("")
}

func (a *Agent) providerLinkBindingLocked(errorCode string) runtimeservice.ProviderLinkBinding {
	if a == nil || a.cfg == nil {
		return runtimeservice.ProviderLinkBinding{State: runtimeservice.ProviderLinkStateUnbound}
	}
	if err := a.cfg.ValidateRemoteStrict(); err != nil {
		return runtimeservice.ProviderLinkBinding{
			State:                    runtimeservice.ProviderLinkStateUnbound,
			LastErrorCode:            strings.TrimSpace(errorCode),
			LastDisconnectedAtUnixMS: time.Now().UnixMilli(),
		}
	}
	return runtimeservice.NormalizeProviderLinkBinding(runtimeservice.ProviderLinkBinding{
		State:                    runtimeservice.ProviderLinkStateLinked,
		ProviderOrigin:           a.cfg.ControlplaneBaseURL,
		ProviderID:               a.cfg.ControlplaneProviderID,
		EnvPublicID:              a.cfg.EnvironmentID,
		LocalEnvironmentPublicID: a.cfg.LocalEnvironmentPublicID,
		BindingGeneration:        a.cfg.BindingGeneration,
		RemoteEnabled:            a.remoteEnabled,
	}, runtimeservice.Capability{Supported: true, BindMethod: runtimeservice.RuntimeControlBindMethodV1})
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

func providerLinkMatches(binding runtimeservice.ProviderLinkBinding, req ProviderLinkRequest) bool {
	return strings.TrimSpace(binding.ProviderOrigin) == strings.TrimSpace(req.ProviderOrigin) &&
		strings.TrimSpace(binding.ProviderID) == strings.TrimSpace(req.ProviderID) &&
		strings.TrimSpace(binding.EnvPublicID) == strings.TrimSpace(req.EnvPublicID)
}

func requestedExpectedProviderLinkMatches(binding runtimeservice.ProviderLinkBinding, req ProviderLinkRequest) bool {
	expectedOrigin := strings.TrimSpace(req.ExpectedProviderOrigin)
	expectedProviderID := strings.TrimSpace(req.ExpectedProviderID)
	expectedEnvID := strings.TrimSpace(req.ExpectedEnvPublicID)
	expectedGeneration := req.ExpectedGeneration
	if expectedOrigin == "" && expectedProviderID == "" && expectedEnvID == "" && expectedGeneration <= 0 {
		return true
	}
	return strings.TrimSpace(binding.ProviderOrigin) == expectedOrigin &&
		strings.TrimSpace(binding.ProviderID) == expectedProviderID &&
		strings.TrimSpace(binding.EnvPublicID) == expectedEnvID &&
		(expectedGeneration <= 0 || binding.BindingGeneration == expectedGeneration)
}

func (a *Agent) providerLinkCanReplaceCurrentLocked(req ProviderLinkRequest) *ProviderLinkError {
	current := a.providerLinkBindingLocked("")
	if current.State == runtimeservice.ProviderLinkStateLinked && providerLinkMatches(current, req) {
		return nil
	}
	if !requestedExpectedProviderLinkMatches(current, req) {
		return &ProviderLinkError{
			Code:    ProviderLinkErrorAlreadyLinked,
			Message: "Local Runtime is already connected to another provider Environment.",
		}
	}
	if current.State == runtimeservice.ProviderLinkStateLinked && !req.AllowRelinkWhenIdle {
		return &ProviderLinkError{
			Code:    ProviderLinkErrorAlreadyLinked,
			Message: "Local Runtime is already connected to a provider Environment.",
		}
	}
	if current.State == runtimeservice.ProviderLinkStateLinked && a.hasActiveProviderWorkLocked() {
		return &ProviderLinkError{
			Code:    ProviderLinkErrorActiveWork,
			Message: "Local Runtime has active provider-originated work. Disconnect that work before relinking.",
		}
	}
	return nil
}

func (a *Agent) ConnectProvider(ctx context.Context, req ProviderLinkRequest) (*ProviderLinkResponse, error) {
	if a == nil {
		return nil, errors.New("nil agent")
	}
	a.providerLinkMu.Lock()
	defer a.providerLinkMu.Unlock()

	if !a.desktopManaged {
		return nil, &ProviderLinkError{
			Code:    "LOCAL_RUNTIME_NOT_DESKTOP_MANAGED",
			Message: "Provider linking is only available for Desktop-managed runtimes.",
		}
	}
	providerOrigin := strings.TrimSpace(req.ProviderOrigin)
	envPublicID := strings.TrimSpace(req.EnvPublicID)
	bootstrapTicket := strings.TrimSpace(req.BootstrapTicket)
	if providerOrigin == "" || envPublicID == "" || bootstrapTicket == "" {
		return nil, &ProviderLinkError{
			Code:    "PROVIDER_LINK_INVALID_REQUEST",
			Message: "Provider origin, environment id, and bootstrap ticket are required.",
		}
	}
	if err := codeapp.ValidateControlplaneBaseURL(providerOrigin); err != nil {
		return nil, &ProviderLinkError{
			Code:    "PROVIDER_LINK_INVALID_REQUEST",
			Message: fmt.Sprintf("Provider origin is invalid: %v", err),
			Err:     err,
		}
	}

	a.mu.Lock()
	current := a.providerLinkBindingLocked("")
	if current.State == runtimeservice.ProviderLinkStateLinked && providerLinkMatches(current, req) {
		a.mu.Unlock()
		return &ProviderLinkResponse{Binding: current}, nil
	}
	if linkErr := a.providerLinkCanReplaceCurrentLocked(req); linkErr != nil {
		a.mu.Unlock()
		return nil, linkErr
	}
	a.mu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}
	cfg, err := config.ResolveProviderLinkConfig(ctx, config.ProviderLinkBootstrapArgs{
		ConfigPath:               a.configPath,
		ControlplaneBaseURL:      providerOrigin,
		ControlplaneProviderID:   strings.TrimSpace(req.ProviderID),
		EnvironmentID:            envPublicID,
		BootstrapTicket:          bootstrapTicket,
		RuntimeVersion:           strings.TrimSpace(a.version),
		RuntimeGOOS:              runtime.GOOS,
		RuntimeGOARCH:            runtime.GOARCH,
		RuntimeHostname:          hostnameBestEffort(),
		PreservePermissionPolicy: true,
	})
	if err != nil {
		return nil, &ProviderLinkError{
			Code:    ProviderLinkErrorBootstrapFailed,
			Message: fmt.Sprintf("Provider link bootstrap failed: %v", err),
			Err:     err,
		}
	}

	a.mu.Lock()
	if linkErr := a.providerLinkCanReplaceCurrentLocked(req); linkErr != nil {
		a.mu.Unlock()
		return nil, linkErr
	}
	if err := config.Save(a.configPath, cfg); err != nil {
		a.mu.Unlock()
		return nil, &ProviderLinkError{
			Code:    ProviderLinkErrorBootstrapFailed,
			Message: fmt.Sprintf("Persist provider link config failed: %v", err),
			Err:     err,
		}
	}
	a.cfg = cfg
	a.controlChannelEnabled = true
	a.remoteEnabled = true
	a.effectiveRunMode = "hybrid"
	binding := a.providerLinkBindingLocked("")
	a.mu.Unlock()
	if a.code != nil {
		_ = a.code.SetControlplaneBaseURL(providerOrigin)
	}
	a.startOrRestartControlChannel()

	return &ProviderLinkResponse{Binding: binding}, nil
}

func (a *Agent) DisconnectProvider(_ context.Context) (*ProviderLinkResponse, error) {
	if a == nil {
		return nil, errors.New("nil agent")
	}
	a.providerLinkMu.Lock()
	defer a.providerLinkMu.Unlock()

	if !a.desktopManaged {
		return nil, &ProviderLinkError{
			Code:    "LOCAL_RUNTIME_NOT_DESKTOP_MANAGED",
			Message: "Provider linking is only available for Desktop-managed runtimes.",
		}
	}
	a.mu.Lock()
	if a.cfg != nil {
		next := *a.cfg
		next.ControlplaneBaseURL = ""
		next.ControlplaneProviderID = ""
		next.EnvironmentID = ""
		next.LocalEnvironmentPublicID = ""
		next.BindingGeneration = 0
		next.Direct = nil
		if strings.TrimSpace(next.AgentInstanceID) == "" {
			next.AgentInstanceID = a.cfg.AgentInstanceID
		}
		if err := config.Save(a.configPath, &next); err != nil {
			a.mu.Unlock()
			return nil, &ProviderLinkError{
				Code:    "PROVIDER_LINK_DISCONNECT_FAILED",
				Message: fmt.Sprintf("Persist provider disconnect failed: %v", err),
				Err:     err,
			}
		}
		a.cfg = &next
	}
	a.controlChannelEnabled = false
	a.remoteEnabled = false
	a.effectiveRunMode = "local"
	binding := runtimeservice.ProviderLinkBinding{
		State:                    runtimeservice.ProviderLinkStateUnbound,
		LastDisconnectedAtUnixMS: time.Now().UnixMilli(),
	}
	a.mu.Unlock()
	if a.code != nil {
		if err := a.code.SetControlplaneBaseURL(""); err != nil {
			return nil, &ProviderLinkError{
				Code:    "PROVIDER_LINK_DISCONNECT_FAILED",
				Message: fmt.Sprintf("Clear provider origin failed: %v", err),
				Err:     err,
			}
		}
	}
	a.stopControlChannel()
	return &ProviderLinkResponse{Binding: binding}, nil
}
