package agent

import (
	"context"
	"strings"

	"github.com/floegence/redeven/internal/runtimeservice"
)

func (a *Agent) RuntimeServiceSnapshot() runtimeservice.Snapshot {
	if a == nil {
		return runtimeservice.UnknownSnapshot()
	}

	terminalCount := 0
	if a.term != nil {
		terminalCount = len(a.term.VisibleSessionIDs())
	}
	sessions := a.listActiveSessionsSnapshot()
	portForwardCount := 0
	for _, session := range sessions {
		if session.FloeApp == FloeAppRedevenPortForward {
			portForwardCount++
		}
	}

	capabilities := runtimeservice.Capabilities{
		GatewayCloudJoin: runtimeservice.Capability{Supported: true, BindMethod: runtimeservice.RuntimeControlBindMethodV2},
		DesktopModelSource: runtimeservice.Capability{
			Supported:  false,
			ReasonCode: "ai_service_unavailable",
			Message:    "Desktop model source is not available in this runtime service.",
		},
		ProviderLink: runtimeservice.Capability{
			Supported:  true,
			BindMethod: runtimeservice.RuntimeControlBindMethodV2,
		},
		RuntimeGateway: runtimeservice.Capability{
			Supported:  true,
			BindMethod: runtimeservice.RuntimeControlBindMethodV2,
		},
	}
	gatewayCloud := a.gatewayCloudAccessSnapshot()
	if gatewayCloud != nil {
		capabilities.ProviderLink = runtimeservice.Capability{ReasonCode: "gateway_cloud_managed", Message: "Manage this Namespace-owned connection in Redeven Cloud."}
	}
	bindings := runtimeservice.Bindings{
		DesktopModelSource: runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported},
		ProviderLink:       a.ProviderLinkBinding(),
	}
	var aiTaskCount int
	aiReadiness := runtimeservice.AIReadiness{State: "unavailable"}
	if a.code != nil {
		readiness := a.code.AIReadiness()
		aiReadiness = runtimeservice.AIReadiness{State: string(readiness.State), ReasonCode: readiness.ReasonCode, IssueCount: readiness.IssueCount}
		aiSvc, _, _, release, err := a.code.AcquireAIService(context.Background())
		if err == nil && aiSvc != nil && release != nil {
			defer release()
			capabilities.DesktopModelSource = runtimeservice.Capability{
				Supported:  true,
				BindMethod: runtimeservice.RuntimeControlBindMethodV2,
			}
			bindings.DesktopModelSource = aiSvc.DesktopModelSourceBindingSnapshot()
			aiTaskCount = aiSvc.ActiveRunCount("")
		}
	}
	if !capabilities.DesktopModelSource.Supported {
		bindings.DesktopModelSource = runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}

	return runtimeservice.ApplyCompatibilityContract(runtimeservice.Snapshot{
		GatewayCloud:     gatewayCloud,
		RuntimeVersion:   strings.TrimSpace(a.version),
		RuntimeCommit:    strings.TrimSpace(a.commit),
		RuntimeBuildTime: strings.TrimSpace(a.buildTime),
		ProtocolVersion:  runtimeservice.ProtocolVersion,
		EffectiveRunMode: strings.TrimSpace(a.effectiveRunMode),
		RemoteEnabled:    a.remoteEnabled,
		AIReadiness:      aiReadiness,
		ActiveWorkload: runtimeservice.Workload{
			TerminalCount:    terminalCount,
			SessionCount:     len(sessions),
			TaskCount:        aiTaskCount,
			PortForwardCount: portForwardCount,
		},
		Capabilities: capabilities,
		Bindings:     bindings,
	})
}

func (a *Agent) gatewayCloudAccessSnapshot() *runtimeservice.GatewayCloudAccess {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.GatewayCloud == nil {
		return nil
	}
	route := a.cfg.GatewayCloud
	state := "connecting"
	switch {
	case route.Revoked:
		state = "revoked"
	case route.Binding == nil:
		state = "pending"
	case !a.remoteEnabled:
		state = "disabled"
	case a.controlRegistered:
		state = "connected"
	}
	return &runtimeservice.GatewayCloudAccess{ProtocolVersion: route.ProtocolVersion, CloudOrigin: route.CloudOrigin, NamespacePublicID: route.NamespacePublicID, GatewayPublicID: route.GatewayPublicID, State: state}
}

func (a *Agent) CurrentRuntimeServiceSnapshot() runtimeservice.Snapshot {
	return a.RuntimeServiceSnapshot()
}
