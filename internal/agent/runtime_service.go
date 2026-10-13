package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"

	"github.com/floegence/redeven/internal/runtimegateway/security"
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
		publicKey, err := base64.RawURLEncoding.DecodeString(member.GatewayPublicKey)
		if err != nil || len(publicKey) != ed25519.PublicKeySize {
			continue
		}
		publicDER, err := x509.MarshalPKIXPublicKey(ed25519.PublicKey(publicKey))
		if err != nil {
			continue
		}
		publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
		fingerprint, err := security.PublicKeyFingerprint(publicPEM)
		if err != nil {
			continue
		}
		summary := runtimeservice.GatewayMembership{GatewayID: member.GatewayID, GatewayName: member.GatewayName, IdentityFingerprint: fingerprint, MemberID: member.MemberID, RuntimePublicID: member.RuntimePublicID, Phase: item.Phase}
		for _, endpoint := range member.ConnectionEndpoints() {
			summary.Endpoints = append(summary.Endpoints, runtimeservice.GatewayAddress{Address: endpoint.Address})
		}
		out = append(out, summary)
	}
	return out
}
