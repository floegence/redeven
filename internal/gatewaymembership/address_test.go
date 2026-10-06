package gatewaymembership

import (
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"testing"
)

func TestAddressUpdatePreservesMembershipAndRejectsIdentityReplacement(t *testing.T) {
	store, identity := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := PrepareRuntime(invitation, "runtime", gp.MemberMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	joined, err := store.Join(t.Context(), *member.PendingJoin)
	if err != nil {
		t.Fatal(err)
	}
	member.MemberVersion, member.ClientCertificatePEM, member.ClientExpiresAtUnixMS = joined.MemberVersion, joined.ClientCertificatePEM, joined.ClientExpiresAtUnixMS
	member.PendingJoin = nil
	old := member.Clone()
	if err := store.Readdress("https://moved.internal:9443", "127.0.0.1:9443"); err != nil {
		t.Fatal(err)
	}
	invitation, err = store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := member.PrepareAddressUpdate(invitation)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GatewayURL != "https://moved.internal:9443" || updated.MemberID != old.MemberID || updated.MemberVersion != old.MemberVersion || updated.ClientCertificatePEM != old.ClientCertificatePEM || updated.Delegation != old.Delegation || member.GatewayURL != old.GatewayURL {
		t.Fatal("address update mutated authorization or previous state")
	}
	reopened, err := NewStore(store.path, identity, "", "", store.hooks)
	if err != nil || reopened.Endpoint().RootPEM != old.GatewayTLSRootPEM {
		t.Fatal("restart lost pinned identity", err)
	}
	other, _ := membershipStore(t)
	foreign, err := other.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := member.PrepareAddressUpdate(foreign); err == nil {
		t.Fatal("address update inherited a different machine key")
	}
	invitation.GatewayURL = "https://forged.internal:9443"
	if _, err := member.PrepareAddressUpdate(invitation); err == nil {
		t.Fatal("address forgery accepted")
	}
}

func TestGatewayOriginCanonicalizationPrecedesSignedInvitations(t *testing.T) {
	for input, want := range map[string]string{
		"https://MacBook-Pro.local:443": "https://macbook-pro.local",
		"https://LOCALHOST:07443/":      "https://localhost:7443",
		"https://[0:0:0:0:0:0:0:1]:443": "https://[::1]",
	} {
		t.Run(input, func(t *testing.T) {
			store, _ := membershipStore(t)
			if err := store.Readdress(input, "127.0.0.1:7443"); err != nil {
				t.Fatal(err)
			}
			invitation, err := store.Invite("admin")
			if err != nil {
				t.Fatal(err)
			}
			if invitation.GatewayURL != want || store.Endpoint().URL != want {
				t.Fatal("signed endpoint was not canonical")
			}
			if _, err := PrepareRuntime(invitation, "runtime", gp.MemberMetadata{}); err != nil {
				t.Fatal(err)
			}
			endpoint, err := newEndpoint(input, "127.0.0.1:7443")
			if err != nil || endpoint.URL != want {
				t.Fatal("initial endpoint was not canonical", err)
			}
		})
	}
	for _, invalid := range []string{"https://user@host", "https://host/path", "https://host?", "https://host#", "https://host:0", "https://host:65536"} {
		if _, err := canonicalOrigin(invalid); err == nil {
			t.Fatalf("accepted invalid origin %q", invalid)
		}
	}
}
