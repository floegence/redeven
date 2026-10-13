package agent

import "github.com/floegence/redeven/internal/config"

// The control controller owns transport cancellation. Persisted settings are
// published only after the route/identity CAS succeeds.
func (a *Agent) setRemoteConfigLocked(next *config.Config) {
	if a.cfg != nil && a.cfg.CloudAssociation != nil && !sameCloudOwner(a.cfg, next) && a.controlCancel != nil {
		a.controlCancel()
	}
	a.cfg = next
}
