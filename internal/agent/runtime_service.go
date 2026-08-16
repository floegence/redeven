package agent

import (
	"context"
	"strings"
	"time"

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
		ProviderLink: runtimeservice.Capability{
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
		ProviderLink:       a.ProviderLinkBinding(),
	}
	var aiSvcAvailable bool
	var aiTaskCount int
	aiReadiness := runtimeservice.AIReadiness{State: "unavailable"}
	if a.code != nil {
		readiness := a.code.AIReadiness()
		aiReadiness = runtimeservice.AIReadiness{State: string(readiness.State), ReasonCode: readiness.ReasonCode, IssueCount: readiness.IssueCount}
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		aiSvc, leaseCtx, _, release, err := a.code.AcquireAIService(ctx)
		if err == nil && aiSvc != nil && release != nil {
			aiSvcAvailable = true
			defer release()
			capabilities.DesktopModelSource = runtimeservice.Capability{
				Supported:  true,
				BindMethod: runtimeservice.RuntimeControlBindMethodV2,
			}
			bindings.DesktopModelSource = aiSvc.DesktopModelSourceBindingStatus(leaseCtx)
			aiTaskCount = aiSvc.ActiveRunCount("")
		}
		cancel()
	}
	if !aiSvcAvailable {
		bindings.DesktopModelSource = runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}

	return runtimeservice.ApplyCompatibilityContract(runtimeservice.Snapshot{
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

func (a *Agent) CurrentRuntimeServiceSnapshot() runtimeservice.Snapshot {
	return a.RuntimeServiceSnapshot()
}
