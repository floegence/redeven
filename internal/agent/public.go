package agent

import (
	"strings"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/diagnostics"
)

func (a *Agent) CodeAppServer() *appserver.Server {
	if a == nil || a.code == nil {
		return nil
	}
	return a.code.AppServer()
}

func (a *Agent) DiagnosticsStore() *diagnostics.Store {
	if a == nil {
		return nil
	}
	return a.diag
}

func (a *Agent) DiagnosticsEnabled() bool {
	return a != nil && a.diag != nil && a.diag.Enabled()
}

func (a *Agent) InstanceID() string {
	if a == nil {
		return ""
	}
	return strings.TrimSpace(a.instanceID)
}

func (a *Agent) ProcessStartedAtUnixMS() int64 {
	if a == nil {
		return 0
	}
	return a.processStartedAtMs
}

func (a *Agent) Version() string {
	if a == nil {
		return ""
	}
	return strings.TrimSpace(a.version)
}

func (a *Agent) Commit() string {
	if a == nil {
		return ""
	}
	return strings.TrimSpace(a.commit)
}

func (a *Agent) BinaryPath() string {
	if a == nil {
		return ""
	}
	return strings.TrimSpace(a.binaryPath)
}

func (a *Agent) SetLocalUIBind(bind string) {
	if a == nil {
		return
	}
	a.localUIBind = strings.TrimSpace(bind)
}
