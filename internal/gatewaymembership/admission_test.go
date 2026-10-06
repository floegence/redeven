package gatewaymembership

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestMemberConnectionOffersFencePreviousAttempts(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := PrepareRuntime(invitation, "runtime_a", gp.MemberMetadata{Hostname: "A"})
	if err != nil {
		t.Fatal(err)
	}
	response, err := store.Join(context.Background(), *runtime.PendingJoin)
	if err != nil {
		t.Fatal(err)
	}
	pair, err := tls.X509KeyPair([]byte(response.ClientCertificatePEM), []byte(runtime.ClientPrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.MemberOffer(pair.Leaf)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.MemberOffer(pair.Leaf)
	if err != nil {
		t.Fatal(err)
	}
	if second.Generation != first.Generation+1 || second.MemberVersion != first.MemberVersion {
		t.Fatal("connection generation changed authorization version")
	}
	// The opaque authorization record is persisted before the offer is returned.
	store.mu.Lock()
	var saved Admission
	for _, record := range store.state.Admissions {
		if record.ChannelID == second.ChannelID {
			saved = record
		}
	}
	store.mu.Unlock()
	if saved.ChannelID == "" {
		t.Fatal("admission was not persisted")
	}
	if _, err := controlplane.ParseAuthorizationRecord(saved.Authorization); err != nil {
		t.Fatal(err)
	}
	if saved.ExpiresAtUnixMS > time.Now().Add(2*time.Minute).UnixMilli() {
		t.Fatal("redemption exceeds the bounded admission window")
	}
	if err := store.Remove(response.MemberID, response.MemberVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MemberOffer(pair.Leaf); err == nil {
		t.Fatal("removed member acquired another offer")
	}
	if _, err := store.AccessOffer(context.Background(), response.MemberID, "paired_desktop"); err == nil {
		t.Fatal("removed member acquired Desktop access")
	}
}

func TestMemberInvitationsAndOffersRedactDiagnostics(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	changed := invitation
	changed.ExpiresAtUnixMS += 1
	if VerifyInvitation(changed, time.Now()) == nil {
		t.Fatal("modified capability was accepted")
	}
	raw, err := json.Marshal(invitation)
	if err != nil || len(raw) == 0 {
		t.Fatal("wire invitation must remain serializable")
	}
}
