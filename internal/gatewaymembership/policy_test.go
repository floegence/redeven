package gatewaymembership

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestPolicyUpdatePreservesOverridesWithoutTransientRevocation(t *testing.T) {
	ctx := context.Background()
	store, _ := membershipStore(t)
	ids := make(map[gp.CloudPermission]string)
	for _, permission := range []gp.CloudPermission{gp.CloudInherit, gp.CloudAllow, gp.CloudDeny} {
		invitation, err := store.Invite("admin")
		if err != nil {
			t.Fatal(err)
		}
		request, _ := memberRequest(t, invitation, "runtime_"+string(permission))
		response, err := store.Join(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		ids[permission] = response.MemberID
		if err := store.UpdateMemberPolicy(ctx, gp.MemberPolicyUpdate{MemberID: response.MemberID, ExpectedMemberVersion: 1, CloudPermission: permission}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.SetCloudNamespace(ctx, "namespace_a"); err != nil {
		t.Fatal(err)
	}
	// Observe every persisted transaction, including any accidental intermediate
	// invalidation that would close existing explicitly allowed Cloud sessions.
	store.SetCommitHandler(func(members []MemberRecord, policy gp.GatewayPolicy) {
		for _, member := range members {
			if member.Member.MemberID == ids[gp.CloudAllow] && (!EffectiveCloudAllowed(member, policy) || member.Member.CloudRevocationPending) {
				t.Error("default edit revoked an explicitly allowed member")
			}
			if member.Member.MemberID == ids[gp.CloudDeny] && EffectiveCloudAllowed(member, policy) {
				t.Error("default edit widened an explicitly denied member")
			}
		}
	})
	for _, allow := range []bool{true, false, true} {
		_, policy, _ := store.Snapshot()
		policy.DefaultCloudAllowed = allow
		if err := store.UpdatePolicy(ctx, policy.Revision, policy); err != nil {
			t.Fatal(err)
		}
		members, current, _ := store.Snapshot()
		for _, member := range members {
			if member.Member.MemberID == ids[gp.CloudInherit] && (cloudPolicyAllows(member, current) != allow || EffectiveCloudAllowed(member, current) != (allow && !member.Member.CloudRevocationPending)) {
				t.Fatal("inherited member did not follow the committed default")
			}
		}
		if err := store.AcknowledgeCloudDirectory("namespace_a", current.Revision, members); err != nil {
			t.Fatal(err)
		}
	}
	_, policy, _ := store.Snapshot()
	policy.PublicationMode = gp.PublicationAutomatic
	if err := store.UpdatePolicy(ctx, policy.Revision, policy); err != nil {
		t.Fatal(err)
	}
	// Choosing the same effective override must not revoke a live member either.
	if err := store.UpdateMemberPolicy(ctx, gp.MemberPolicyUpdate{MemberID: ids[gp.CloudAllow], ExpectedMemberVersion: 1, CloudPermission: gp.CloudInherit}); err != nil {
		t.Fatal(err)
	}
}

func TestCanceledPolicyUpdateCommitsNothing(t *testing.T) {
	store, _ := membershipStore(t)
	_, policy, revision := store.Snapshot()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	policy.DefaultCloudAllowed = true
	if err := store.UpdatePolicy(ctx, policy.Revision, policy); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled update: %v", err)
	}
	_, current, after := store.Snapshot()
	if current.DefaultCloudAllowed || after != revision {
		t.Fatal("canceled request modified policy")
	}
}

func TestReevaluationRequiresCurrentMemberVersion(t *testing.T) {
	store, _ := membershipStore(t)
	invite, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invite, "runtime")
	response, err := store.Join(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	_, _, before := store.Snapshot()
	if err := store.ReevaluateCloud(t.Context(), response.MemberID, 2); !errors.Is(err, ErrConflict) {
		t.Fatal("stale member version accepted", err)
	}
	_, _, after := store.Snapshot()
	if before != after {
		t.Fatal("rejected reevaluation changed policy")
	}
	if err := store.ReevaluateCloud(t.Context(), response.MemberID, 1); err != nil {
		t.Fatal(err)
	}
}

func TestMemberSnapshotCannotMutateRotationDelivery(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invitation, "runtime_snapshot")
	response, err := store.Join(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	member := store.state.Members[response.MemberID]
	member.Rotation = &rotationDelivery{RequestSHA256: "original"}
	store.state.Members[response.MemberID] = member
	store.mu.Unlock()
	members, _, _ := store.Snapshot()
	members[0].Rotation.RequestSHA256 = "mutated"
	next, _, _ := store.Snapshot()
	if next[0].Rotation.RequestSHA256 != "original" {
		t.Fatal("snapshot exposed the authoritative rotation delivery")
	}
}

func TestHookRefreshStorageFailureClosesOldCloudGrants(t *testing.T) {
	for _, invalidate := range []bool{false, true} {
		t.Run(map[bool]string{false: "refresh", true: "invalidate"}[invalidate], func(t *testing.T) {
			store, _ := membershipStore(t)
			if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
				t.Fatal(err)
			}
			invitation, err := store.Invite("admin")
			if err != nil {
				t.Fatal(err)
			}
			request, _ := memberRequest(t, invitation, "runtime")
			response, err := store.Join(t.Context(), request)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: response.MemberID, ExpectedMemberVersion: 1, CloudPermission: gp.CloudAllow}); err != nil {
				t.Fatal(err)
			}
			var applied []MemberRecord
			var appliedPolicy gp.GatewayPolicy
			store.SetCommitHandler(func(records []MemberRecord, policy gp.GatewayPolicy) { applied, appliedPolicy = records, policy })
			original := store.path
			// A regular-file parent deterministically rejects writes, even as root.
			blocked := filepath.Join(t.TempDir(), "not-a-directory")
			if err := os.WriteFile(blocked, nil, 0600); err != nil {
				t.Fatal(err)
			}
			store.path = filepath.Join(blocked, "members.json")
			if invalidate {
				err = store.InvalidateHooks()
			} else {
				err = store.RefreshHooks(HookConfig{})
			}
			if err == nil {
				t.Fatal("expected persistence failure")
			}
			records, policy, _ := store.Snapshot()
			if EffectiveCloudAllowed(records[0], policy) || !records[0].Member.CloudRevocationPending {
				t.Fatal("storage failure preserved the old directory grant")
			}
			if EffectiveCloudAllowed(applied[0], appliedPolicy) {
				t.Fatal("storage failure preserved the installed egress grant")
			}
			if _, _, _, err := store.DurableSnapshot(); err == nil {
				t.Fatal("Cloud snapshot exposed an unpersisted policy revision")
			}
			store.path = original
			_, durablePolicy, _, err := store.DurableSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			reopened, err := NewStore(original, store.identity, "", "", store.hooks)
			if err != nil {
				t.Fatal(err)
			}
			_, recoveredPolicy, _ := reopened.Snapshot()
			if recoveredPolicy.Revision < durablePolicy.Revision {
				t.Fatal("restart rolled back a policy exposed to Cloud")
			}
			if err := store.RefreshHooks(HookConfig{}); err != nil {
				t.Fatal(err)
			}
			if err := store.ReevaluateCloud(t.Context(), response.MemberID, 1); err != nil {
				t.Fatal(err)
			}
			records, policy, _ = store.Snapshot()
			if !records[0].HookCloudAllowed || EffectiveCloudAllowed(records[0], policy) {
				t.Fatal("storage recovery erased the undelivered denial")
			}
			if err := store.AcknowledgeCloudDirectory("namespace", policy.Revision, records); err != nil {
				t.Fatal(err)
			}
			records, policy, _ = store.Snapshot()
			if !EffectiveCloudAllowed(records[0], policy) {
				t.Fatal("confirmed denial did not allow reevaluated policy")
			}
		})
	}
}
