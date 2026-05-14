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

	capabilities := runtimeservice.Capabilities{
		DesktopAIBroker: runtimeservice.Capability{
			Supported:  false,
			ReasonCode: "ai_service_unavailable",
			Message:    "Desktop AI Broker binding is not available in this runtime service.",
		},
		ProviderLink: runtimeservice.Capability{
			Supported:  a.desktopManaged,
			BindMethod: runtimeservice.RuntimeControlBindMethodV1,
		},
	}
	if !a.desktopManaged {
		capabilities.ProviderLink = runtimeservice.Capability{
			Supported:  false,
			ReasonCode: "runtime_not_desktop_managed",
			Message:    "Provider linking is only available for Desktop-managed runtimes.",
		}
	}
	bindings := runtimeservice.Bindings{
		DesktopAIBroker: runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported},
		ProviderLink:    a.ProviderLinkBinding(),
	}
	if a.code != nil {
		if aiSvc := a.code.AI(); aiSvc != nil {
			capabilities.DesktopAIBroker = runtimeservice.Capability{
				Supported:  true,
				BindMethod: runtimeservice.RuntimeControlBindMethodV1,
			}
			ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
			bindings.DesktopAIBroker = aiSvc.DesktopBrokerBindingStatus(ctx)
			cancel()
		}
	}

	return runtimeservice.ApplyCompatibilityContract(runtimeservice.Snapshot{
		RuntimeVersion:   strings.TrimSpace(a.version),
		RuntimeCommit:    strings.TrimSpace(a.commit),
		RuntimeBuildTime: strings.TrimSpace(a.buildTime),
		ProtocolVersion:  runtimeservice.ProtocolVersion,
		ServiceOwner: func() runtimeservice.Owner {
			if a.desktopManaged {
				return runtimeservice.OwnerDesktop
			}
			return runtimeservice.OwnerExternal
		}(),
		DesktopManaged:   a.desktopManaged,
		EffectiveRunMode: strings.TrimSpace(a.effectiveRunMode),
		RemoteEnabled:    a.remoteEnabled,
		ActiveWorkload: runtimeservice.Workload{
			TerminalCount:    terminalCount,
			SessionCount:     len(a.listActiveSessionsSnapshot()),
			TaskCount:        0,
			PortForwardCount: 0,
		},
		Capabilities: capabilities,
		Bindings:     bindings,
	})
}

func (a *Agent) CurrentRuntimeServiceSnapshot() runtimeservice.Snapshot {
	return a.RuntimeServiceSnapshot()
}
