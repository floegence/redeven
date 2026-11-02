package main

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewayhost"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestHostMemberCommandsUseCurrentMemberAuthority(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: root, HostAdminToken: token, PublicURL: "https://gateway.internal:7443", PublicListen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	server, listeners, err := owner.Start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if err := gatewaystate.Write(gatewayhost.TokenPath(root), token); err != nil {
		t.Fatal(err)
	}
	shared, err := gatewayhost.New(root, listeners[0].Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer shared.Close()
	client := hostAdminClient{client: shared}
	var invitation gp.InvitationCodeDelivery
	if err := client.request(context.Background(), "/gateway/v6/invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &invitation); err != nil {
		t.Fatal(err)
	}
	if err := invitation.Verify(invitation.GatewayID, invitation.GatewayPublicKey, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := client.request(context.Background(), "/gateway/v6/invitations", gp.InvitationRequest{ProtocolVersion: gp.Version}, nil); err == nil {
		t.Fatal("retired file endpoint accepted")
	}
	var catalog gp.CatalogResponse
	if err := client.request(context.Background(), "/gateway/v6/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog); err != nil {
		t.Fatal(err)
	}
	if !catalog.Gateway.Permissions.ManageAttachments || catalog.Policy.DefaultEgressAllowed || len(catalog.Attachments) != 0 {
		t.Fatal("invitation changed attachment or Cloud authorization")
	}
	policy := catalog.Policy
	policy.DefaultEgressAllowed = true
	request := gp.UpdatePolicyRequest{ProtocolVersion: gp.Version, ExpectedRevision: policy.Revision, Policy: policy}
	if err := client.request(context.Background(), "/gateway/v6/policy", request, nil); err != nil {
		t.Fatal(err)
	}
	if err := client.request(context.Background(), "/gateway/v6/policy", request, nil); err == nil {
		t.Fatal("stale policy revision accepted")
	}
}

func TestPolicyPreviewIncludesDestinationChanges(t *testing.T) {
	before := gp.GatewayPolicy{DefaultEgressAllowed: true, Destinations: []string{"old.example:443"}}
	after := gp.GatewayPolicy{DefaultEgressAllowed: true, Destinations: []string{"new.example:443"}}
	for _, permission := range []gp.EgressPermission{gp.EgressInherit, gp.EgressAllow, gp.EgressDeny} {
		if got := policyAffectsAttachment(gp.RuntimeAttachment{State: "active", EgressPermission: permission}, before, after); got != (permission != gp.EgressDeny) {
			t.Fatalf("wrong destination impact for %s", permission)
		}
	}
}

func TestCLIOperationQueryRecoversOriginalAccessPackage(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: root, HostAdminToken: token, PublicListen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	server, listeners, err := owner.Start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if err := gatewaystate.Write(gatewayhost.TokenPath(root), token); err != nil {
		t.Fatal(err)
	}
	if err := writePIDFile(root, os.Getpid(), listeners[0].Addr().String(), "127.0.0.1:7443"); err != nil {
		t.Fatal(err)
	}

	var first, recovered, stderr bytes.Buffer
	args := []string{"clients", "access-code", "--state-root", root, "--operation-id", "cli_recovery_12345678"}
	if result := runCLI(args, strings.NewReader(""), &first, &stderr); result != 0 {
		t.Fatal(stderr.String())
	}
	args = []string{"operations", "query", "--state-root", root, "--operation-id", "cli_recovery_12345678"}
	if result := runCLI(args, strings.NewReader(""), &recovered, &stderr); result != 0 {
		t.Fatal(stderr.String())
	}
	if first.String() != recovered.String() {
		t.Fatal("CLI query did not recover the original response")
	}
}
