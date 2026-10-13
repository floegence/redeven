package gatewaymembership

import (
	"crypto/x509"
	"encoding/pem"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestLocalEgressIntentIsIndependentOfCloudAcknowledgement(t *testing.T) {
	store, identity := membershipStore(t)
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	invite, _ := store.Invite("admin")
	request, _ := memberRequest(t, invite, "runtime")
	response, err := store.Join(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	set := func(permission gp.CloudPermission) {
		t.Helper()
		if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: response.MemberID, ExpectedMemberVersion: 1, CloudPermission: permission}); err != nil {
			t.Fatal(err)
		}
	}
	set(gp.CloudAllow)
	old, policy, _ := store.Snapshot()
	set(gp.CloudDeny)
	if err := store.AcknowledgeCloudDirectory("namespace", policy.Revision, old); err != nil {
		t.Fatal(err)
	}
	denied, current, _ := store.Snapshot()
	if EffectiveCloudAllowed(denied[0], current) {
		t.Fatal("Cloud acknowledgement overrode local denial")
	}
	set(gp.CloudAllow)
	reopened, err := NewStore(store.path, identity, "", "", store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	allowed, current, _ := reopened.Snapshot()
	if !EffectiveCloudAllowed(allowed[0], current) {
		t.Fatal("Cloud synchronization blocked explicit local allow after restart")
	}
	if err := reopened.AcknowledgeCloudDirectory("namespace", policy.Revision, denied); err != nil {
		t.Fatal(err)
	}
	allowed, current, _ = reopened.Snapshot()
	if !EffectiveCloudAllowed(allowed[0], current) {
		t.Fatal("old denial acknowledgement changed current local intent")
	}
}

func TestCloudHookIsReevaluatedBeforeReopenedStoreCanAuthorize(t *testing.T) {
	store, identity := membershipStore(t)
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	invite, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invite, "runtime")
	response, err := store.Join(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: response.MemberID, ExpectedMemberVersion: 1, CloudPermission: gp.CloudAllow}); err != nil {
		t.Fatal(err)
	}
	hooks, err := NewPolicyHooks(HookConfig{gp.HookCloudPublish: {Path: "/missing/denying-hook"}})
	if err != nil {
		t.Fatal(err)
	}
	store, err = NewStore(store.path, identity, "", "", hooks)
	if err != nil {
		t.Fatal(err)
	}
	members, policy, _ := store.Snapshot()
	if EffectiveCloudAllowed(members[0], policy) || members[0].HookCloudAllowed {
		t.Fatal("restart installed a persisted grant without evaluating the current hook")
	}
}

func TestNewMemberEvaluatesCurrentCloudPolicy(t *testing.T) {
	store, _ := membershipStore(t)
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	_, policy, _ := store.Snapshot()
	policy.DefaultCloudAllowed = true
	if err := store.UpdatePolicy(t.Context(), policy.Revision, policy); err != nil {
		t.Fatal(err)
	}
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invitation, "new_runtime")
	if _, err := store.Join(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	records, policy, _ := store.Snapshot()
	if len(records) != 1 || !EffectiveCloudAllowed(records[0], policy) {
		t.Fatal("new member needs an unnecessary manual policy reevaluation")
	}
}

func TestCloudDirectoryAcknowledgementCannotChangeLocalPolicyOrReviveRemovedMember(t *testing.T) {
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
	setPermission := func(permission gp.CloudPermission) {
		t.Helper()
		if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: response.MemberID, ExpectedMemberVersion: 1, CloudPermission: permission}); err != nil {
			t.Fatal(err)
		}
	}
	setPermission(gp.CloudAllow)
	observed, policy, _ := store.Snapshot()
	setPermission(gp.CloudDeny)
	if err := store.AcknowledgeCloudDirectory("namespace", policy.Revision, observed); err != nil {
		t.Fatal(err)
	}
	current, currentPolicy, _ := store.Snapshot()
	if EffectiveCloudAllowed(current[0], currentPolicy) {
		t.Fatal("stale sync acknowledged an unsent local denial")
	}
	if err := store.AcknowledgeCloudDirectory("namespace", policy.Revision, current); err != nil {
		t.Fatal(err)
	}
	current, currentPolicy, _ = store.Snapshot()
	if EffectiveCloudAllowed(current[0], currentPolicy) {
		t.Fatal("Cloud readback overrode local denial")
	}
	if err := store.Remove(response.MemberID, 1); err != nil {
		t.Fatal(err)
	}
	removed, _, _ := store.Snapshot()
	if err := store.AcknowledgeCloudDirectory("namespace", policy.Revision, removed); err != nil {
		t.Fatal(err)
	}
	remaining, _, _ := store.Snapshot()
	if len(remaining) != 0 {
		t.Fatal("acknowledged tombstone still consumes directory capacity")
	}
	if _, err := store.Join(t.Context(), request); err == nil {
		t.Fatal("removed member replay restored a consumed invitation")
	}
	block, _ := pem.Decode([]byte(response.ClientCertificatePEM))
	if block == nil {
		t.Fatal("missing member certificate")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Leave(leaf, gp.RemoveMemberRequest{ProtocolVersion: gp.Version, MemberID: response.MemberID, ExpectedMemberVersion: 1}); err != nil {
		t.Fatal("lost removal response cannot recover after tombstone compaction", err)
	}
	if _, err := store.Authenticate(leaf); err == nil {
		t.Fatal("compacted member regained general access")
	}
}
