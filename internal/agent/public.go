package agent

import (
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/diagnostics"
)

func (a *Agent) CodeGateway() *gateway.Gateway {
	if a == nil || a.code == nil {
		return nil
	}
	return a.code.Gateway()
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
