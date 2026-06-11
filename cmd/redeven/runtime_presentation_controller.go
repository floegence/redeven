package main

import (
	"context"
	"strings"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/runtimepresentation"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type runtimePresentationController struct {
	agent *agent.Agent
}

func (c *runtimePresentationController) ConnectControlPlane(ctx context.Context) error {
	if c == nil || c.agent == nil {
		return nil
	}
	return c.agent.ConnectControlPlane(ctx)
}

func (c *runtimePresentationController) DisconnectControlPlane(ctx context.Context) error {
	if c == nil || c.agent == nil {
		return nil
	}
	return c.agent.DisconnectControlPlane(ctx)
}

func (c *runtimePresentationController) ConfigureControlPlane(ctx context.Context, setup runtimepresentation.ControlPlaneSetup) (runtimepresentation.ControlPlaneStatus, error) {
	if c == nil || c.agent == nil {
		return runtimepresentation.ControlPlaneStatus{
			Label:          "control plane unavailable",
			DisabledReason: "runtime is not initialized",
		}, nil
	}
	status, err := c.agent.ConfigureControlPlane(ctx, agent.ControlPlaneSetup{
		ProviderOrigin:    setup.ProviderOrigin,
		AccessPointOrigin: setup.AccessPointOrigin,
		EnvironmentID:     setup.EnvironmentID,
		BootstrapTicket:   setup.BootstrapTicket,
	})
	if err != nil {
		return runtimepresentation.ControlPlaneStatus{}, err
	}
	return runtimepresentation.ControlPlaneStatus{
		Enabled:        status.Enabled,
		Connected:      status.Connected,
		Connectable:    status.Connectable,
		Label:          status.Label,
		DisabledReason: status.DisabledReason,
	}, nil
}

func (c *runtimePresentationController) ControlPlaneStatus() runtimepresentation.ControlPlaneStatus {
	if c == nil || c.agent == nil {
		return runtimepresentation.ControlPlaneStatus{
			Label:          "control plane unavailable",
			DisabledReason: "runtime is not initialized",
		}
	}
	status := c.agent.ControlPlaneRuntimeStatus()
	action := ""
	switch {
	case status.Connected || status.Enabled:
		action = "disconnect"
	case status.Connectable:
		action = "connect"
	}
	return runtimepresentation.ControlPlaneStatus{
		Enabled:        status.Enabled,
		Connected:      status.Connected,
		Connectable:    status.Connectable,
		Label:          status.Label,
		ActionLabel:    action,
		DisabledReason: status.DisabledReason,
	}
}

func (c *runtimePresentationController) RuntimeOverview() runtimepresentation.RuntimeOverview {
	if c == nil || c.agent == nil {
		return runtimepresentation.RuntimeOverview{}
	}
	snapshot := runtimeservice.NormalizeSnapshot(c.agent.RuntimeServiceSnapshot())
	sessions := c.agent.RuntimePresentationSessions()
	overview := runtimepresentation.RuntimeOverview{
		Version:                 snapshot.RuntimeVersion,
		Commit:                  snapshot.RuntimeCommit,
		BuildTime:               snapshot.RuntimeBuildTime,
		ProtocolVersion:         snapshot.ProtocolVersion,
		Compatibility:           string(snapshot.Compatibility),
		CompatibilityMessage:    snapshot.CompatibilityMessage,
		MinimumDesktopVersion:   snapshot.MinimumDesktopVersion,
		MinimumRuntimeVersion:   snapshot.MinimumRuntimeVersion,
		ServiceOwner:            string(snapshot.ServiceOwner),
		DesktopManaged:          snapshot.DesktopManaged,
		EffectiveRunMode:        snapshot.EffectiveRunMode,
		RemoteEnabled:           snapshot.RemoteEnabled,
		OpenReadinessState:      string(snapshot.OpenReadiness.State),
		OpenReadinessReasonCode: snapshot.OpenReadiness.ReasonCode,
		OpenReadinessMessage:    snapshot.OpenReadiness.Message,
		Workload: runtimepresentation.RuntimeWorkload{
			ActiveSessions:      snapshot.ActiveWorkload.SessionCount,
			TerminalSessions:    snapshot.ActiveWorkload.TerminalCount,
			ActiveTasks:         snapshot.ActiveWorkload.TaskCount,
			PortForwardSessions: snapshot.ActiveWorkload.PortForwardCount,
		},
		ProviderLink: runtimepresentation.RuntimeProviderLink{
			State:                    string(snapshot.Bindings.ProviderLink.State),
			ProviderOrigin:           snapshot.Bindings.ProviderLink.ProviderOrigin,
			ProviderID:               snapshot.Bindings.ProviderLink.ProviderID,
			EnvPublicID:              snapshot.Bindings.ProviderLink.EnvPublicID,
			AccessPointOrigin:        snapshot.Bindings.ProviderLink.AccessPointOrigin,
			LocalEnvironmentPublicID: snapshot.Bindings.ProviderLink.LocalEnvironmentPublicID,
			RemoteEnabled:            snapshot.Bindings.ProviderLink.RemoteEnabled,
			LastErrorCode:            snapshot.Bindings.ProviderLink.LastErrorCode,
			LastErrorMessage:         snapshot.Bindings.ProviderLink.LastErrorMessage,
		},
	}
	if overview.Workload.ActiveSessions == 0 && len(sessions) > 0 {
		overview.Workload.ActiveSessions = len(sessions)
	}
	portForwardSessions := 0
	for _, session := range sessions {
		switch strings.TrimSpace(session.FloeApp) {
		case agent.FloeAppRedevenAgent:
			overview.Workload.AgentSessions++
		case agent.FloeAppRedevenCode:
			overview.Workload.CodeSessions++
		case agent.FloeAppRedevenPortForward:
			portForwardSessions++
		}
	}
	if portForwardSessions > overview.Workload.PortForwardSessions {
		overview.Workload.PortForwardSessions = portForwardSessions
	}
	return overview
}

func (c *runtimePresentationController) RuntimeSessions() []runtimepresentation.RuntimeSession {
	if c == nil || c.agent == nil {
		return nil
	}
	sessions := c.agent.RuntimePresentationSessions()
	out := make([]runtimepresentation.RuntimeSession, 0, len(sessions))
	for _, session := range sessions {
		out = append(out, runtimepresentation.RuntimeSession{
			ChannelID:         session.ChannelID,
			UserPublicID:      session.UserPublicID,
			UserEmail:         session.UserEmail,
			FloeApp:           session.FloeApp,
			AppLabel:          runtimePresentationAppLabel(session.FloeApp),
			CodeSpaceID:       session.CodeSpaceID,
			SessionKind:       session.SessionKind,
			TunnelURL:         session.TunnelURL,
			CreatedAtUnixMs:   session.CreatedAtUnixMs,
			ConnectedAtUnixMs: session.ConnectedAtUnixMs,
			CanRead:           session.CanRead,
			CanWrite:          session.CanWrite,
			CanExecute:        session.CanExecute,
		})
	}
	return out
}

func runtimePresentationAppLabel(floeApp string) string {
	switch strings.TrimSpace(floeApp) {
	case agent.FloeAppRedevenAgent:
		return "Env App"
	case agent.FloeAppRedevenCode:
		return "Code"
	case agent.FloeAppRedevenPortForward:
		return "Port Forward"
	default:
		return "Session"
	}
}
