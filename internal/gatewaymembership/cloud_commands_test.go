package gatewaymembership

import (
	"context"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestCloudCommandDeliveryIsAtomicAndSurvivesRestart(t *testing.T) {
	store, identity := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invitation, "runtime_command")
	joined, err := store.Join(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: joined.MemberID, ExpectedMemberVersion: 1, CloudPermission: gp.CloudAllow}); err != nil {
		t.Fatal(err)
	}
	command := CloudCommand{ID: "command_evaluate", Kind: "reevaluate", MemberID: joined.MemberID, MemberVersion: 1, ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	if code, err := store.ApplyCloudCommand(t.Context(), command); err != nil || code != "" {
		t.Fatal(code, err)
	}
	records, _, revision := store.Snapshot()
	if !records[0].HookCloudAllowed {
		t.Fatal("Cloud policy was not evaluated")
	}
	store.hooks.Invalidate()
	restarted, err := NewStore(store.path, identity, store.Endpoint().URL, store.Endpoint().ListenAddress, store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	if code, err := restarted.ApplyCloudCommand(t.Context(), command); err != nil || code != "" {
		t.Fatal(code, err)
	}
	records, _, after := restarted.Snapshot()
	if after != revision || !records[0].HookCloudAllowed {
		t.Fatal("lost response retried an already committed policy decision")
	}
	changed := command
	changed.MemberVersion++
	if code, err := restarted.ApplyCloudCommand(t.Context(), changed); err != nil || code != "MEMBER_COMMAND_CONFLICT" {
		t.Fatal(code, err)
	}
	command.ID = "command_stale"
	command.MemberVersion++
	if code, err := restarted.ApplyCloudCommand(t.Context(), command); err != nil || code != "MEMBER_VERSION_CONFLICT" {
		t.Fatal(code, err)
	}
	command.ID, command.MemberVersion = "command_new", 1
	if code, err := restarted.ApplyCloudCommand(t.Context(), command); err != nil || code != "" {
		t.Fatal(code, err)
	}
	records, _, _ = restarted.Snapshot()
	if records[0].HookCloudAllowed {
		t.Fatal("explicit new reevaluation ignored changed hook policy")
	}
	command.ID, command.Kind = "command_remove", "remove_member"
	if code, err := restarted.ApplyCloudCommand(context.Background(), command); err != nil || code != "" {
		t.Fatal(code, err)
	}
	records, _, revision = restarted.Snapshot()
	if records[0].Member.State != "removed" || records[0].Member.MemberVersion != 2 {
		t.Fatal("removal did not advance member fence")
	}
	if code, err := restarted.ApplyCloudCommand(t.Context(), command); err != nil || code != "" {
		t.Fatal(code, err)
	}
	_, _, after = restarted.Snapshot()
	if after != revision {
		t.Fatal("removal replay changed authorization")
	}
}
