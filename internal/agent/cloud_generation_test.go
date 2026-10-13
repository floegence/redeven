package agent

import (
	"context"
	"testing"
)

func TestGatewayClosureLeavesLocalAndNewlyApprovedSessionsRunning(t *testing.T) {
	old, cancelOld := context.WithCancel(context.Background())
	defer cancelOld()
	newer, cancelNew := context.WithCancel(context.Background())
	defer cancelNew()
	local, cancelLocal := context.WithCancel(context.Background())
	defer cancelLocal()
	a := &Agent{sessions: map[string]*activeSession{
		"old":   {cancel: cancelOld, cloudBindingPublicID: "binding", cloudBindingGeneration: 1},
		"new":   {cancel: cancelNew, cloudBindingPublicID: "binding", cloudBindingGeneration: 3},
		"local": {cancel: cancelLocal},
	}}
	if a.closeCloudSessions("binding", 1) {
		t.Fatal("reported closed before session cleanup")
	}
	if old.Err() == nil || newer.Err() != nil || local.Err() != nil {
		t.Fatal("closure crossed its binding generation")
	}
	delete(a.sessions, "old")
	if !a.closeCloudSessions("binding", 1) {
		t.Fatal("unrelated sessions blocked acknowledgement")
	}
}
