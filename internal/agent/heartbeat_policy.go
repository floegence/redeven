package agent

import (
	"errors"
	"time"
)

// heartbeatPolicy is scoped to one registered control session.
type heartbeatPolicy struct {
	Revision         int64 `json:"revision"`
	IntervalMS       int64 `json:"interval_ms"`
	OfflineTimeoutMS int64 `json:"offline_timeout_ms"`
}

func (p heartbeatPolicy) valid() bool {
	timeout := 3*p.IntervalMS + 30000
	if timeout < 90000 {
		timeout = 90000
	}
	return p.Revision > 0 && p.IntervalMS >= 5000 && p.IntervalMS <= 60000 && p.OfflineTimeoutMS == timeout
}
func (p heartbeatPolicy) interval() time.Duration {
	return time.Duration(p.IntervalMS) * time.Millisecond
}
func applyHeartbeatPolicy(current, next heartbeatPolicy) (heartbeatPolicy, error) {
	if !next.valid() {
		return current, errors.New("invalid control heartbeat policy")
	}
	if next.Revision < current.Revision {
		return current, nil
	}
	if next.Revision == current.Revision && next != current {
		return current, errors.New("conflicting control heartbeat policy revision")
	}
	return next, nil
}
