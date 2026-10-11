package main

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayhost"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestHostMemberCommandsUseCurrentMemberAuthority(t *testing.T) {
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: t.TempDir(), HostAdminToken: token, MemberURL: "https://gateway.internal:7443"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(owner.Handler())
	defer server.Close()
	root := t.TempDir()
	if err := gatewaystate.Write(gatewayhost.TokenPath(root), token); err != nil {
		t.Fatal(err)
	}
	shared, err := gatewayhost.New(root, strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer shared.Close()
	client := hostAdminClient{client: shared}
	var invitation gc.InvitationCodeDelivery
	if err := client.request(context.Background(), "/gateway/v5/invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &invitation); err != nil {
		t.Fatal(err)
	}
	if err := invitation.Verify(invitation.GatewayID, invitation.GatewayPublicKey, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := client.request(context.Background(), "/gateway/v5/invitations", gp.InvitationRequest{ProtocolVersion: gp.Version}, nil); err == nil {
		t.Fatal("retired file endpoint accepted")
	}
	var catalog gp.CatalogResponse
	if err := client.request(context.Background(), "/gateway/v5/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog); err != nil {
		t.Fatal(err)
	}
	if !catalog.Gateway.Permissions.ManageMembers || catalog.Policy.DefaultCloudAllowed || len(catalog.Members) != 0 {
		t.Fatal("invitation changed membership or Cloud authorization")
	}
	policy := catalog.Policy
	policy.DefaultCloudAllowed = true
	request := gp.UpdatePolicyRequest{ProtocolVersion: gp.Version, ExpectedRevision: policy.Revision, Policy: policy}
	if err := client.request(context.Background(), "/gateway/v5/policy", request, nil); err != nil {
		t.Fatal(err)
	}
	if err := client.request(context.Background(), "/gateway/v5/policy", request, nil); err == nil {
		t.Fatal("stale policy revision accepted")
	}
}
