package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

func TestFloretEffectAuthorizationRejectsDeleteIntentBeforeDispatch(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_delete_intent")
	if _, err := runThreadStoreForTest(t, r).PrepareThreadDeleteOperation(context.Background(), r.endpointID, r.threadID, true); err != nil {
		t.Fatal(err)
	}
	snapshot := r.currentPermissionSnapshot()
	dispatched := false
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_delete_intent", RequestFingerprint: "fingerprint_delete_intent",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_delete_intent", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_delete_intent", LeaseGeneration: 1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
		},
	}, func(context.Context, flruntime.EffectAuthorizationProof) error {
		dispatched = true
		return nil
	})
	if !errors.Is(err, threadstore.ErrThreadIDRetired) {
		t.Fatalf("authorization error=%v, want %v", err, threadstore.ErrThreadIDRetired)
	}
	if dispatched {
		t.Fatal("effect dispatched after durable delete intent")
	}
}

func TestFloretEffectAuthorizationRejectsDispatchAfterRunExecutionCloses(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_stop_gate")
	snapshot := r.currentPermissionSnapshot()
	r.closeExecution()
	dispatched := false
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_stop_gate", RequestFingerprint: "fingerprint_stop_gate",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_stop_gate", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_stop_gate", LeaseGeneration: 1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
		},
	}, func(context.Context, flruntime.EffectAuthorizationProof) error {
		dispatched = true
		return nil
	})
	if !errors.Is(err, ErrRunExecutionClosed) {
		t.Fatalf("authorization error=%v, want %v", err, ErrRunExecutionClosed)
	}
	if dispatched {
		t.Fatal("effect dispatched after run execution closed")
	}
}

func TestFloretEffectAuthorizationRegistryConsumesExactProofOnce(t *testing.T) {
	registry := newFloretEffectAuthorizationRegistry()
	snapshot := PermissionSnapshot{
		Version: permissionSnapshotVersionCurrent, SnapshotID: "snapshot_once", SnapshotHash: "hash_once",
		PermissionType: FlowerPermissionFullAccess,
	}
	req := flruntime.EffectAuthorizationRequest{
		ThreadID: "thread_once", TurnID: "turn_once", RunID: "run_once", ToolCallID: "call_once",
		EffectAttemptID: "effect_once",
		ArgumentHash:    floretEffectArgumentHash(`{"command":"pwd"}`),
	}
	release, err := registry.authorize(req, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	invocation := fltools.Invocation[map[string]any]{
		ThreadID: "thread_once", TurnID: "turn_once", RunID: "run_once", CallID: "call_once",
		RawArgs: `{"command":"pwd"}`,
	}
	if _, effectAttemptID, err := registry.snapshotForInvocation(invocation); err != nil {
		t.Fatalf("consume exact proof: %v", err)
	} else {
		if effectAttemptID != req.EffectAttemptID {
			t.Fatalf("effect attempt id=%q, want %q", effectAttemptID, req.EffectAttemptID)
		}
	}
	if _, _, err := registry.snapshotForInvocation(invocation); err == nil || !strings.Contains(err.Error(), "proof is unavailable") {
		t.Fatalf("second proof consumption error=%v", err)
	}
}

func TestFloretEffectJoinRequiresExplicitChildScopes(t *testing.T) {
	join, err := floretEffectJoin(flruntime.EffectAuthorizationRequest{
		ToolName: "subagents",
		Resources: []fltools.ResourceRef{
			{Kind: "subagent", Value: subagentActionWait},
			{Kind: "subagent_thread", Value: "child_wait_a"},
			{Kind: "subagent_thread", Value: " child_wait_b "},
			{Kind: "subagent_thread", Value: "child_wait_a"},
		},
	})
	if err != nil || join.allChildren || !reflect.DeepEqual(join.childThreadIDs, []string{"child_wait_a", "child_wait_b"}) {
		t.Fatalf("wait join=%#v err=%v", join, err)
	}
	if passiveSubagentEffectRequest(flruntime.EffectAuthorizationRequest{
		ToolName:  "subagents",
		Resources: []fltools.ResourceRef{{Kind: "subagent", Value: subagentActionWait}},
	}) {
		t.Fatal("SubAgent wait must not release lifecycle authority before dispatch")
	}
	if _, err := floretEffectJoin(flruntime.EffectAuthorizationRequest{
		ToolName:  "subagents",
		Resources: []fltools.ResourceRef{{Kind: "subagent", Value: subagentActionWait}},
	}); err == nil || !strings.Contains(err.Error(), "missing its child authority scope") {
		t.Fatalf("missing wait scope error=%v", err)
	}

	join, err = floretEffectJoin(flruntime.EffectAuthorizationRequest{
		ToolName: "subagents",
		Resources: []fltools.ResourceRef{
			{Kind: "subagent", Value: subagentActionClose},
			{Kind: "subagent_thread", Value: "child_exact"},
		},
	})
	if err != nil || !reflect.DeepEqual(join.childThreadIDs, []string{"child_exact"}) || join.allChildren {
		t.Fatalf("close join=%#v err=%v", join, err)
	}
	if _, err := floretEffectJoin(flruntime.EffectAuthorizationRequest{
		ToolName:  "subagents",
		Resources: []fltools.ResourceRef{{Kind: "subagent", Value: subagentActionClose}},
	}); err == nil || !strings.Contains(err.Error(), "missing its child authority scope") {
		t.Fatalf("missing close scope error=%v", err)
	}
	join, err = floretEffectJoin(flruntime.EffectAuthorizationRequest{
		ToolName:  "subagents",
		Resources: []fltools.ResourceRef{{Kind: "subagent", Value: subagentActionCloseAll}},
	})
	if err != nil || !join.allChildren || len(join.childThreadIDs) != 0 {
		t.Fatalf("close-all join=%#v err=%v", join, err)
	}
}

func TestFloretEffectAuthorizationKeepsSubagentWaitInsideLifecycleGate(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_subagent_wait")
	svc := testServiceForRun(t, r)
	snapshot := r.currentPermissionSnapshot()
	dispatched := make(chan struct{})
	finish := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
			EffectAttemptID: "effect_subagent_wait", RequestFingerprint: "fingerprint_subagent_wait",
			ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
			ToolCallID: "call_subagent_wait", ToolName: "subagents", ArgumentHash: floretEffectArgumentHash(`{"action":"wait"}`),
			Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_subagent_wait", LeaseGeneration: 1,
			Resources: []fltools.ResourceRef{
				{Kind: "subagent", Value: subagentActionWait},
				{Kind: "subagent_thread", Value: "child_wait_admission"},
			},
			HostContext: map[string]string{
				floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
				floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
				floretToolHostContextAuthorityThreadIDKey:    r.threadID,
			},
		}, func(context.Context, flruntime.EffectAuthorizationProof) error {
			close(dispatched)
			<-finish
			return nil
		})
	}()
	select {
	case <-dispatched:
	case <-time.After(time.Second):
		t.Fatal("SubAgent wait did not reach dispatch")
	}

	writerAcquired := make(chan func(), 1)
	go func() {
		unlock, err := svc.threadMgr.lockThreadLifecycle(r.endpointID, r.threadID)
		if err != nil {
			writerAcquired <- nil
			return
		}
		writerAcquired <- unlock
	}()
	key := runThreadKey(r.endpointID, r.threadID)
	deadline := time.Now().Add(time.Second)
	for {
		svc.threadMgr.mu.Lock()
		gate := svc.threadMgr.lifecycleGates[key]
		svc.threadMgr.mu.Unlock()
		queued := false
		if gate != nil {
			gate.mu.Lock()
			queued = gate.waitingWriters > 0
			gate.mu.Unlock()
		}
		if queued {
			break
		}
		if time.Now().After(deadline) {
			close(finish)
			<-done
			t.Fatal("lifecycle writer did not queue behind SubAgent wait")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case unlock := <-writerAcquired:
		if unlock != nil {
			unlock()
		}
		t.Fatal("lifecycle writer crossed SubAgent wait dispatch")
	case <-time.After(25 * time.Millisecond):
	}
	childAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadEffect(r.endpointID, r.threadID, "child_wait_admission", threadEffectJoin{})
		if lockErr != nil {
			childAcquired <- nil
			return
		}
		childAcquired <- release
	}()
	var childRelease func()
	select {
	case childRelease = <-childAcquired:
		if childRelease == nil {
			close(finish)
			<-done
			if release := <-writerAcquired; release != nil {
				release()
			}
			t.Fatal("child work required by SubAgent wait failed to join its active cohort")
		}
	case <-time.After(time.Second):
		close(finish)
		<-done
		if release := <-writerAcquired; release != nil {
			release()
		}
		if release := <-childAcquired; release != nil {
			release()
		}
		t.Fatal("lifecycle writer blocked child work required by SubAgent wait")
	}
	childRelease()
	siblingAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadEffect(r.endpointID, r.threadID, "child_wait_sibling", threadEffectJoin{})
		if lockErr != nil {
			siblingAcquired <- nil
			return
		}
		siblingAcquired <- release
	}()
	select {
	case release := <-siblingAcquired:
		if release != nil {
			release()
		}
		close(finish)
		<-done
		if writerRelease := <-writerAcquired; writerRelease != nil {
			writerRelease()
		}
		t.Fatal("unrequested sibling joined the SubAgent wait cohort")
	case <-time.After(25 * time.Millisecond):
	}

	close(finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var writerRelease func()
	select {
	case writerRelease = <-writerAcquired:
		if writerRelease == nil {
			t.Fatal("lifecycle writer failed after SubAgent wait completed")
		}
	case <-time.After(time.Second):
		t.Fatal("lifecycle writer did not resume after SubAgent wait completed")
	}
	select {
	case release := <-siblingAcquired:
		if release != nil {
			release()
		}
		writerRelease()
		t.Fatal("unrequested sibling crossed the lifecycle writer after SubAgent wait")
	case <-time.After(25 * time.Millisecond):
	}
	writerRelease()
	select {
	case release := <-siblingAcquired:
		if release == nil {
			t.Fatal("unrequested sibling failed after the lifecycle writer completed")
		}
		release()
	case <-time.After(time.Second):
		t.Fatal("unrequested sibling did not resume after the lifecycle writer completed")
	}
}

func TestFloretSubagentCloseResourcesCarryExactChildScope(t *testing.T) {
	resources, err := floretToolResources(fltools.Invocation[map[string]any]{
		Name: "subagents",
		Args: map[string]any{"action": subagentActionClose, "target": "child_exact"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []fltools.ResourceRef{
		{Kind: "subagent", Value: subagentActionClose},
		{Kind: "subagent_thread", Value: "child_exact"},
	}
	if !reflect.DeepEqual(resources, want) {
		t.Fatalf("resources=%#v, want %#v", resources, want)
	}
}

func TestFloretSubagentWaitResourcesCarryExactChildScopes(t *testing.T) {
	resources, err := floretToolResources(fltools.Invocation[map[string]any]{
		Name: "subagents",
		Args: map[string]any{
			"action": subagentActionWait,
			"ids":    []string{"child_wait_a", " child_wait_b ", "child_wait_a"},
			"target": "unrequested_child",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []fltools.ResourceRef{
		{Kind: "subagent", Value: subagentActionWait},
		{Kind: "subagent_thread", Value: "child_wait_a"},
		{Kind: "subagent_thread", Value: "child_wait_b"},
	}
	if !reflect.DeepEqual(resources, want) {
		t.Fatalf("resources=%#v, want %#v", resources, want)
	}
}

func TestFloretEffectAuthorizationHoldsLifecycleWriterThroughHandler(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_dispatch_boundary")
	svc := testServiceForRun(t, r)
	snapshot := r.currentPermissionSnapshot()
	rawArgs := `{"command":"pwd"}`
	dispatched := make(chan struct{})
	finish := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
			EffectAttemptID: "effect_dispatch_boundary", RequestFingerprint: "fingerprint_dispatch_boundary",
			ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
			ToolCallID: "call_dispatch_boundary", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(rawArgs),
			Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_dispatch_boundary", LeaseGeneration: 1,
			HostContext: map[string]string{
				floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
				floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
				floretToolHostContextAuthorityThreadIDKey:    r.threadID,
			},
		}, func(context.Context, flruntime.EffectAuthorizationProof) error {
			_, _, err := r.effectAuthorizations.snapshotForInvocation(fltools.Invocation[map[string]any]{
				ThreadID: r.threadID, TurnID: r.turnID, RunID: r.id, CallID: "call_dispatch_boundary", RawArgs: rawArgs,
			})
			if err != nil {
				return err
			}
			close(dispatched)
			<-finish
			return nil
		})
	}()
	select {
	case <-dispatched:
	case <-time.After(time.Second):
		t.Fatal("effect did not reach the one-shot dispatch boundary")
	}
	lockAcquired := make(chan func(), 1)
	go func() {
		unlock, err := svc.threadMgr.lockThreadLifecycle(r.endpointID, r.threadID)
		if err != nil {
			lockAcquired <- nil
			return
		}
		lockAcquired <- unlock
	}()
	select {
	case unlock := <-lockAcquired:
		if unlock != nil {
			unlock()
		}
		t.Fatal("lifecycle writer crossed an in-flight authorized handler")
	case <-time.After(25 * time.Millisecond):
	}
	close(finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case unlock := <-lockAcquired:
		if unlock == nil {
			t.Fatal("failed to acquire lifecycle authority after handler completion")
		}
		unlock()
	case <-time.After(time.Second):
		t.Fatal("lifecycle writer did not resume after handler completion")
	}
}

func TestFloretEffectAuthorizationRejectsCrossThreadAuthorityBeforeDispatch(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_cross_authority")
	dispatched := false
	snapshot := r.currentPermissionSnapshot()
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_cross_authority", RequestFingerprint: "fingerprint_cross_authority",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_cross_authority", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_cross_authority", LeaseGeneration: 1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    "other_thread",
		},
	}, func(context.Context, flruntime.EffectAuthorizationProof) error {
		dispatched = true
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "authority mismatch") {
		t.Fatalf("authorization error=%v, want authority mismatch", err)
	}
	if dispatched {
		t.Fatal("cross-thread effect dispatched")
	}
}

func TestFloretEffectAuthorizationDoesNotWaitForSecondProductApproval(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "effect_durable_approval")
	snapshot := r.currentPermissionSnapshot()
	dispatched := false
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_durable_approval", RequestFingerprint: "fingerprint_durable_approval",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_durable_approval", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk}, LeaseOwnerID: "lease_durable_approval", LeaseGeneration: 1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
		},
	}, func(context.Context, flruntime.EffectAuthorizationProof) error {
		dispatched = true
		return nil
	})
	if err != nil {
		t.Fatalf("authorization after durable Floret approval: %v", err)
	}
	if !dispatched {
		t.Fatal("effect was not dispatched after Floret durable approval")
	}
	r.mu.Lock()
	pendingProductApprovals := len(r.toolApprovals)
	r.mu.Unlock()
	if pendingProductApprovals != 0 {
		t.Fatalf("effect gate registered %d second product approvals", pendingProductApprovals)
	}
}

func TestFloretEffectAuthorizationRejectsCurrentPolicyDowngradeAfterDurableApproval(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "effect_policy_downgrade")
	snapshot := r.currentPermissionSnapshot()
	if err := runThreadStoreForTest(t, r).UpdateThreadPermissionType(context.Background(), r.endpointID, r.threadID, config.AIPermissionReadonly); err != nil {
		t.Fatal(err)
	}
	dispatched := false
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_policy_downgrade", RequestFingerprint: "fingerprint_policy_downgrade",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_policy_downgrade", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk}, LeaseOwnerID: "lease_policy_downgrade", LeaseGeneration: 1,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
		},
	}, func(context.Context, flruntime.EffectAuthorizationProof) error {
		dispatched = true
		return nil
	})
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "permission denied") {
		t.Fatalf("authorization error=%v, want current policy denial", err)
	}
	if dispatched {
		t.Fatal("effect dispatched after current product policy downgrade")
	}
}

func TestFloretEffectAuthorizationProofCarriesExactLeaseAndAuditIdentity(t *testing.T) {
	r := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionFullAccess, "effect_proof")
	snapshot := r.currentPermissionSnapshot()
	var proof flruntime.EffectAuthorizationProof
	err := r.withAuthorizedFloretEffect(context.Background(), flruntime.EffectAuthorizationRequest{
		EffectAttemptID: "effect_proof", RequestFingerprint: "fingerprint_proof",
		ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
		ToolCallID: "call_proof", ToolName: "terminal.exec", ArgumentHash: floretEffectArgumentHash(`{"command":"pwd"}`),
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, LeaseOwnerID: "lease_owner_proof", LeaseGeneration: 7,
		HostContext: map[string]string{
			floretToolHostContextPermissionSnapshotIDKey: snapshot.SnapshotID,
			floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
			floretToolHostContextAuthorityThreadIDKey:    r.threadID,
		},
	}, func(_ context.Context, got flruntime.EffectAuthorizationProof) error {
		proof = got
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if proof.EffectAttemptID != "effect_proof" || proof.RequestFingerprint != "fingerprint_proof" ||
		proof.ThreadID != flruntime.ThreadID(r.threadID) || proof.TurnID != flruntime.TurnID(r.turnID) ||
		proof.RunID != flruntime.RunID(r.id) || proof.ToolCallID != "call_proof" ||
		proof.LeaseOwnerID != "lease_owner_proof" || proof.LeaseGeneration != 7 ||
		strings.TrimSpace(proof.PolicyRevision) == "" || strings.TrimSpace(proof.AuditReference) == "" ||
		strings.TrimSpace(proof.AuditHash) == "" || proof.AuthorizedAt.IsZero() {
		t.Fatalf("authorization proof is incomplete: %#v", proof)
	}
}

func TestCurrentThreadPermissionTypeFailsWithoutAuthoritativeSettings(t *testing.T) {
	for _, testCase := range []struct {
		name string
		run  *run
		want string
	}{
		{name: "missing store", run: &run{endpointID: "env", threadID: "thread"}, want: "store is unavailable"},
		{name: "missing identity", run: &run{product: runProductCapabilities{currentSettings: func(context.Context) (*threadstore.ThreadSettings, error) { return nil, nil }}}, want: "identity is incomplete"},
		{name: "missing settings", run: &run{product: runProductCapabilities{currentSettings: func(context.Context) (*threadstore.ThreadSettings, error) { return nil, nil }}, endpointID: "env", threadID: "thread"}, want: "settings are missing"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := testCase.run.currentThreadPermissionType(context.Background()); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("permission error=%v, want %q", err, testCase.want)
			}
		})
	}
}
