package agent

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

type ControlPlaneSetup struct {
	ProviderOrigin    string
	AccessPointOrigin string
	EnvironmentID     string
	BootstrapTicket   string
}

type ControlPlaneRuntimeStatus struct {
	Enabled        bool
	Connected      bool
	Connectable    bool
	Label          string
	DisabledReason string
}

func (a *Agent) ControlPlaneRuntimeStatus() ControlPlaneRuntimeStatus {
	if a == nil {
		return ControlPlaneRuntimeStatus{
			Label:          "control plane unavailable",
			DisabledReason: "runtime is not initialized",
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	baseURL := ""
	if a.cfg != nil {
		baseURL = strings.TrimSpace(a.cfg.ControlplaneBaseURL)
	}
	connectable := a.cfg != nil && a.cfg.ValidateRemoteStrict() == nil
	enabled := a.controlChannelEnabled
	connected := enabled && a.controlRPC != nil
	status := ControlPlaneRuntimeStatus{
		Enabled:     enabled,
		Connected:   connected,
		Connectable: connectable,
	}
	switch {
	case connected:
		status.Label = "connected to " + baseURL
	case enabled && baseURL != "":
		status.Label = "connecting to " + baseURL
	case connectable && baseURL != "":
		status.Label = "available for " + baseURL
	case baseURL == "":
		status.Label = "disabled for local mode"
		status.DisabledReason = "Run redeven bootstrap or start with remote bootstrap flags before connecting the control plane."
	default:
		status.Label = "not bootstrapped"
		status.DisabledReason = "The saved remote bootstrap config is incomplete."
	}
	return status
}

func (a *Agent) ConnectControlPlane(ctx context.Context) error {
	if a == nil {
		return errors.New("runtime is not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	a.mu.Lock()
	if a.cfg == nil {
		a.mu.Unlock()
		return errors.New("runtime config is missing")
	}
	if err := a.cfg.ValidateRemoteStrict(); err != nil {
		a.mu.Unlock()
		return err
	}
	a.controlChannelEnabled = true
	a.remoteEnabled = true
	if a.localUIEnabled {
		a.effectiveRunMode = "hybrid"
	} else {
		a.effectiveRunMode = "remote"
	}
	a.mu.Unlock()

	a.startOrRestartControlChannel()
	return nil
}

func (a *Agent) ConfigureControlPlane(ctx context.Context, setup ControlPlaneSetup) (ControlPlaneRuntimeStatus, error) {
	if a == nil {
		return ControlPlaneRuntimeStatus{}, errors.New("runtime is not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	cfg, err := config.BootstrapProviderLink(ctx, config.ProviderLinkBootstrapArgs{
		ConfigPath:               a.configPath,
		ProviderOrigin:           strings.TrimSpace(setup.ProviderOrigin),
		ControlplaneBaseURL:      strings.TrimSpace(setup.AccessPointOrigin),
		EnvironmentID:            strings.TrimSpace(setup.EnvironmentID),
		BootstrapTicket:          strings.TrimSpace(setup.BootstrapTicket),
		RuntimeVersion:           a.version,
		LogFormat:                a.cfg.LogFormat,
		LogLevel:                 a.cfg.LogLevel,
		AgentHomeDir:             a.cfg.AgentHomeDir,
		Shell:                    a.cfg.Shell,
		PreservePermissionPolicy: true,
	})
	if err != nil {
		return ControlPlaneRuntimeStatus{}, err
	}

	a.mu.Lock()
	a.cfg = cfg
	a.controlChannelEnabled = true
	a.remoteEnabled = true
	if a.localUIEnabled {
		a.effectiveRunMode = "hybrid"
	} else {
		a.effectiveRunMode = "remote"
	}
	a.mu.Unlock()

	a.startOrRestartControlChannel()
	return a.ControlPlaneRuntimeStatus(), nil
}

func (a *Agent) DisconnectControlPlane(ctx context.Context) error {
	if a == nil {
		return errors.New("runtime is not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	a.mu.Lock()
	a.controlChannelEnabled = false
	a.remoteEnabled = false
	if a.localUIEnabled {
		a.effectiveRunMode = "local"
	}
	a.mu.Unlock()

	a.stopControlChannel()
	if a.onControlDisabled != nil {
		a.onControlDisabled()
	}
	return nil
}
