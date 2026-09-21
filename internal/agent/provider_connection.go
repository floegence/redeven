package agent

import (
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
)

// The saved binding is intent; only successful control registration proves a
// live connection. Reserve exhaustion does not disconnect an existing session.
func (a *Agent) providerConnectionLocked() (state, code, message string) {
	if !a.controlChannelEnabled || !a.remoteEnabled {
		return "disabled", "", "Redeven Cloud access is disabled. Local work remains available."
	}
	if a.controlRegistered && a.controlRPC != nil {
		return "connected", "", ""
	}
	if a.controlBusinessRejected {
		return "authorization_required", "CONTROL_RELINK_REQUIRED", "Redeven Cloud rejected this connection. Review account access and the saved association before reconnecting. Local work remains available."
	}
	// A consumed last reserve may already be establishing a valid session.
	// Never renew credentials while Flowersec owns a live attempt or retry.
	if a.controlController != nil {
		switch a.controlController.Snapshot().State {
		case flowersec.ConnectionConnecting, flowersec.ConnectionConnected:
			return "connecting", "", "Connecting to Redeven Cloud."
		case flowersec.ConnectionWaiting:
			return "retrying", "", "Redeven Cloud is temporarily unavailable. Reconnecting automatically."
		}
	}
	if a.controlFailure != nil && !a.controlCredentialsUnavailable {
		return "error", "CONTROL_CONNECTION_FAILED", "The Redeven Cloud connection failed. Review the connection details before retrying."
	}
	pool := a.cfg.ControlArtifactPool
	if pool == nil || pool.RecoveryState == config.ControlArtifactRecoveryRelink ||
		(pool.PendingTopUp != nil && pool.PendingTopUp.State == config.ControlArtifactTopUpTerminal) {
		return "authorization_required", "CONTROL_RELINK_REQUIRED", "Reconnect this Runtime to Redeven Cloud. Local work remains available."
	}
	now := time.Now().Unix()
	if usableControlArtifactCount(pool, now) == 0 {
		code = "CONTROL_CREDENTIALS_EXHAUSTED"
		for _, entry := range pool.Entries {
			if !entry.Spent && !entry.Revoked && entry.ExpiresAtUnixS <= now+pool.RefreshHorizonSeconds {
				code = "CONTROL_CREDENTIALS_EXPIRED"
				break
			}
		}
		return "authorization_required", code, "Renew this Runtime's Redeven Cloud connection using an authorized Desktop, or run redeven bootstrap with a new setup ticket. Local work remains available."
	}
	return "connecting", "", "Connecting to Redeven Cloud."
}
