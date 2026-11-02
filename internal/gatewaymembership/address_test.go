package gatewaymembership

import (
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"testing"
)

func TestListenerRecoveryWithoutPublishedEndpoints(t *testing.T) {
	store, identity := membershipStore(t)
	settings := store.NetworkSettings()
	settings.Endpoints = nil
	if err := store.UpdateNetworkSettings(settings); err != nil {
		t.Fatal(err)
	}
	before := store.Endpoint()
	if err := store.Readdress("", "127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(store.path, identity, "", "", store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Endpoints()) != 0 || reopened.Endpoint().RootPEM != before.RootPEM || reopened.Endpoint().ListenAddress != "127.0.0.1:0" {
		t.Fatal("listener recovery changed published endpoints or trust")
	}
}

func TestFreshEndpointAcceptsMultipleListenerBindings(t *testing.T) {
	endpoint, err := newEndpoint("https://localhost:7443", "127.0.0.1:0,[::1]:0")
	if err != nil {
		t.Fatal(err)
	}
	if len(endpoint.ListenAddresses) != 2 || endpoint.ListenAddresses[0] != "127.0.0.1:0" || endpoint.ListenAddresses[1] != "[::1]:0" {
		t.Fatal("fresh endpoint did not preserve explicit listener bindings")
	}
}

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
	member.AttachmentVersion, member.ClientCertificatePEM, member.ClientExpiresAtUnixMS = joined.AttachmentVersion, joined.ClientCertificatePEM, joined.ClientExpiresAtUnixMS
	member.PendingJoin = nil
	old := member.Clone()
	if err := store.Readdress("https://moved.internal:9443", "127.0.0.1:9443"); err != nil {
		t.Fatal(err)
	}
	invitation, err = store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := member.PrepareConnectionEndpoints(invitation)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.GatewayEndpoints) != 1 || updated.GatewayEndpoints[0].Address != "https://moved.internal:9443" || updated.AttachmentID != old.AttachmentID || updated.AttachmentVersion != old.AttachmentVersion || updated.ClientCertificatePEM != old.ClientCertificatePEM || updated.Delegation != old.Delegation || member.ConnectionEndpoints()[0].Address != old.ConnectionEndpoints()[0].Address {
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
	if _, err := member.PrepareConnectionEndpoints(foreign); err == nil {
		t.Fatal("address update inherited a different machine key")
	}
	invitation.Endpoints[0].Address = "https://forged.internal:9443"
	if _, err := member.PrepareConnectionEndpoints(invitation); err == nil {
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
			if len(invitation.Endpoints) != 1 || invitation.Endpoints[0].Address != want || store.Endpoint().URL != want {
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
