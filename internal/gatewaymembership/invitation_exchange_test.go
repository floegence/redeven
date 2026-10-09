package gatewaymembership

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
)

func TestInvitationCodePreviewDoesNotConsumeOrMutateStore(t *testing.T) {
	store, identity := membershipStore(t)
	delivery, err := store.IssueInvitationCode("administrator")
	if err != nil {
		t.Fatal(err)
	}
	if err := delivery.Verify(identity.ID, delivery.GatewayPublicKey, time.Now()); err != nil {
		t.Fatal(err)
	}
	code, err := flowersec.ParseInvitationCode(delivery.Code)
	if err != nil {
		t.Fatal(err)
	}
	before := store.clone()
	for range 2 {
		if _, err := store.describeInvitation(context.Background(), code.LookupID()); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(before, store.state) {
		t.Fatal("preview changed durable membership state")
	}
	descriptor, err := store.enrollmentDescriptor(code.LookupID())
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, descriptor, "runtime_first")
	if _, err := store.Join(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	if _, err := store.describeInvitation(context.Background(), code.LookupID()); !errors.Is(err, ErrInvitationUsed) {
		t.Fatalf("used code must be actionable: %v", err)
	}
	other, _ := memberRequest(t, descriptor, "runtime_other")
	if _, err := store.Join(t.Context(), other); err == nil {
		t.Fatal("code reused by another Runtime")
	}
}

func TestRegeneratingInvitationCodeRevokesPreviousUnconsumedCode(t *testing.T) {
	store, _ := membershipStore(t)
	first, err := store.IssueInvitationCode("administrator")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.IssueInvitationCode("administrator")
	if err != nil {
		t.Fatal(err)
	}
	if first.InvitationID == second.InvitationID || first.Code == second.Code {
		t.Fatal("regeneration reused the previous invitation")
	}
	oldCode, err := flowersec.ParseInvitationCode(first.Code)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.describeInvitation(context.Background(), oldCode.LookupID()); !errors.Is(err, ErrInvitationInvalid) {
		t.Fatalf("previous code remained redeemable: %v", err)
	}
}
