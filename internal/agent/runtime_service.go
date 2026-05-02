package agent

import (
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
	})
}

func (a *Agent) CurrentRuntimeServiceSnapshot() runtimeservice.Snapshot {
	return a.RuntimeServiceSnapshot()
}
