package agent

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

func TestCloudClosurePersistsOnlyAfterMatchingSessionsExit(t *testing.T) {
	a := routeAgentFixture(t)
	owner := a.remoteConfigSnapshot()
	closed, cancel := context.WithCancel(t.Context())
	newer, cancelNew := context.WithCancel(t.Context())
	defer cancelNew()
	a.sessions["old"] = &activeSession{cancel: cancel, cloudBindingPublicID: "binding", cloudBindingGeneration: 7}
	a.sessions["new"] = &activeSession{cancel: cancelNew, cloudBindingPublicID: "binding", cloudBindingGeneration: 9}
	done := make(chan error, 1)
	closure := rc.Closure{PublicID: "closure", BindingPublicID: "binding", RuntimePublicID: "runtime", Generation: 7, Reason: "authorization_revoked"}
	go func() { done <- a.applyCloudClosure(t.Context(), owner, closure) }()
	select {
	case <-closed.Done():
	case <-time.After(time.Second):
		t.Fatal("revocation did not cancel the matching session")
	}
	if newer.Err() != nil {
		t.Fatal("old closure canceled a newly approved session")
	}
	loaded, err := config.Load(a.configPath)
	if err != nil || len(loaded.CloudAssociation.ClosureOutbox) != 0 {
		t.Fatal("receipt was saved while a matching session was still registered")
	}
	a.mu.Lock()
	delete(a.sessions, "old")
	a.mu.Unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	loaded, err = config.Load(a.configPath)
	if err != nil || len(loaded.CloudAssociation.ClosureOutbox) != 1 || loaded.CloudAssociation.ApprovalState != rc.ApprovalRevoked || loaded.ControlArtifactPool != nil {
		t.Fatalf("closure was not durable: %v", err)
	}
	if err := a.applyCloudClosure(t.Context(), owner, closure); err != nil || len(a.cfg.CloudAssociation.ClosureOutbox) != 1 {
		t.Fatal("duplicate closure was not idempotent")
	}
}

func TestCloudClosureFailureAndLateOwnerNeverRestoreAuthority(t *testing.T) {
	a := routeAgentFixture(t)
	owner := a.remoteConfigSnapshot()
	closure := rc.Closure{PublicID: "closure", BindingPublicID: "binding", RuntimePublicID: "runtime", Generation: 7, Reason: "authorization_revoked"}
	a.configPath = filepath.Join(t.TempDir(), "missing", "config.json")
	// A directory makes the atomic configuration save fail deterministically.
	a.configPath = t.TempDir()
	if err := a.applyCloudClosure(t.Context(), owner, closure); err == nil {
		t.Fatal("closure persistence failure was hidden")
	}
	if !a.controlBusinessRejected || a.cfg.CloudAssociation.ApprovalState != rc.ApprovalRevoked || len(a.cfg.CloudAssociation.ClosureOutbox) != 0 {
		t.Fatal("persistence failure restored access or fabricated a durable receipt")
	}
	a = routeAgentFixture(t)
	owner = a.remoteConfigSnapshot()
	a.cfg.CloudRoute.Revision++
	if err := a.applyCloudClosure(t.Context(), owner, closure); err == nil || a.cfg.CloudAssociation.ApprovalState != rc.ApprovalApproved {
		t.Fatal("late owner mutated the new route")
	}
}

func TestOlderCloudClosureAndDisconnectedIntentRemainRecoverable(t *testing.T) {
	a := routeAgentFixture(t)
	closure := rc.Closure{PublicID: "old-closure", BindingPublicID: "binding", RuntimePublicID: "runtime", Generation: 5, Reason: "authorization_revoked"}
	if err := a.applyCloudClosure(t.Context(), a.remoteConfigSnapshot(), closure); err != nil {
		t.Fatal(err)
	}
	if a.cfg.CloudAssociation.ApprovalState != rc.ApprovalApproved || a.controlBusinessRejected {
		t.Fatal("old closure revoked the new Cloud generation")
	}
	if _, err := a.disconnectCloudAssociation(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := a.disconnectCloudAssociation(t.Context()); err != nil {
		t.Fatal("repeated local disconnect must remain usable")
	}
	if a.cfg.CloudAssociation.Enabled || len(a.cfg.CloudAssociation.ClosureOutbox) != 1 {
		t.Fatal("disconnect discarded identity or pending receipts")
	}
	if _, err := a.RetryCloud(t.Context(), a.cfg.CloudAssociation.Revision); err != nil || !a.cfg.CloudAssociation.Enabled {
		t.Fatal("explicit resume must preserve the Cloud association")
	}
}
