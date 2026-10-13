package agent

import "testing"

func TestHeartbeatPolicySessionRevision(t *testing.T) {
	current := heartbeatPolicy{}
	for revision, interval := range []int64{10000, 5000, 30000, 60000, 10000, 5000} {
		timeout := 3*interval + 30000
		if timeout < 90000 {
			timeout = 90000
		}
		next := heartbeatPolicy{Revision: int64(revision + 1), IntervalMS: interval, OfflineTimeoutMS: timeout}
		var err error
		current, err = applyHeartbeatPolicy(current, next)
		if err != nil || current != next {
			t.Fatalf("apply: %v %v", current, err)
		}
		repeat, err := applyHeartbeatPolicy(current, next)
		if err != nil || repeat != current {
			t.Fatalf("repeat: %v", err)
		}
	}
	old := heartbeatPolicy{Revision: 1, IntervalMS: 10000, OfflineTimeoutMS: 90000}
	got, err := applyHeartbeatPolicy(current, old)
	if err != nil || got != current {
		t.Fatalf("old policy applied: %v", err)
	}
	conflict := current
	conflict.IntervalMS = 10000
	if _, err := applyHeartbeatPolicy(current, conflict); err == nil {
		t.Fatal("conflicting revision accepted")
	}
	for _, invalid := range []heartbeatPolicy{{}, {Revision: 1, IntervalMS: 4999, OfflineTimeoutMS: 90000}, {Revision: 1, IntervalMS: 60001, OfflineTimeoutMS: 210003}, {Revision: 1, IntervalMS: 60000, OfflineTimeoutMS: 90000}} {
		if _, err := applyHeartbeatPolicy(current, invalid); err == nil {
			t.Fatal("invalid policy accepted")
		}
	}
	reset, err := applyHeartbeatPolicy(heartbeatPolicy{}, old)
	if err != nil || reset != old {
		t.Fatal("new session retained old revision")
	}
}
