package gatewaymembership

import (
	"context"
	"errors"
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
			if member.Member.MemberID == ids[gp.CloudInherit] && EffectiveCloudAllowed(member, current) != allow {
				t.Fatal("inherited member did not follow the committed default")
			}
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
