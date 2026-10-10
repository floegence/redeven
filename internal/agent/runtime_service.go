package agent

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
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
		DesktopModelSource: runtimeservice.Capability{
			Supported:  false,
			ReasonCode: "ai_service_unavailable",
			Message:    "Desktop model source is not available in this runtime service.",
		},
		CloudLink: runtimeservice.Capability{
			Supported:  true,
			BindMethod: runtimeservice.RuntimeControlBindMethodV2,
		},
		RuntimeGateway: runtimeservice.Capability{
			Supported:  true,
			BindMethod: runtimeservice.RuntimeControlBindMethodV2,
		},
	}
	gatewayCloud := a.gatewayPublicationSnapshot()
	cfg := a.remoteConfigSnapshot()
	if gatewayCloud != nil || (cfg != nil && (cfg.CloudGateway() != nil || cfg.GatewayRejoinRequired)) {
		capabilities.CloudLink = runtimeservice.Capability{ReasonCode: "gateway_managed", Message: "Manage the Gateway connection in Runtime settings and its publication in Redeven Cloud."}
	}
	bindings := runtimeservice.Bindings{
		DesktopModelSource: runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported},
		CloudLink:          a.CloudLinkBinding(),
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
		GatewayPublication: gatewayCloud,
		GatewayMemberships: a.gatewayMembershipSummaries(),
		RuntimeVersion:     strings.TrimSpace(a.version),
		RuntimeCommit:      strings.TrimSpace(a.commit),
		RuntimeBuildTime:   strings.TrimSpace(a.buildTime),
		ProtocolVersion:    runtimeservice.ProtocolVersion,
		EffectiveRunMode:   strings.TrimSpace(a.effectiveRunMode),
		RemoteEnabled:      a.remoteEnabled,
		AIReadiness:        aiReadiness,
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

func (a *Agent) gatewayPublicationSnapshot() *runtimeservice.GatewayPublication {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.GatewayPublication == nil {
		return nil
	}
	route := a.cfg.GatewayPublication
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
	return &runtimeservice.GatewayPublication{ProtocolVersion: route.ProtocolVersion, CloudOrigin: route.CloudOrigin, NamespacePublicID: route.NamespacePublicID, GatewayPublicID: route.GatewayPublicID, State: state}
}

func (a *Agent) CurrentRuntimeServiceSnapshot() runtimeservice.Snapshot {
	return a.RuntimeServiceSnapshot()
}

func (a *Agent) gatewayMembershipSummaries() []runtimeservice.GatewayMembership {
	status := a.GatewayMembershipStatus()
	out := make([]runtimeservice.GatewayMembership, 0, len(status.Memberships))
	for _, item := range status.Memberships {
		member := a.GatewayMembership(item.GatewayID)
		if member == nil || member.Leaving {
			continue
		}
		digest := sha256.Sum256([]byte(member.GatewayPublicKey))
		summary := runtimeservice.GatewayMembership{GatewayID: member.GatewayID, GatewayName: member.GatewayName, IdentityFingerprint: "SHA256:" + base64.RawURLEncoding.EncodeToString(digest[:]), MemberID: member.MemberID, RuntimePublicID: member.RuntimePublicID, Phase: item.Phase, CloudPublication: item.CloudPublication}
		for _, endpoint := range member.ConnectionEndpoints() {
			summary.Endpoints = append(summary.Endpoints, runtimeservice.GatewayAddress{Address: endpoint.Address})
		}
		out = append(out, summary)
	}
	return out
}
