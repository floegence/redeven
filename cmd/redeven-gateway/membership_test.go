package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewayservice"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestHostMemberCommandsUseCurrentMemberAuthority(t *testing.T) {
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: t.TempDir(), HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(owner.Handler())
	defer server.Close()
	client := hostAdminClient{endpoint: server.URL, token: token, transport: &http.Transport{Proxy: nil}}
	defer client.transport.CloseIdleConnections()
	var invitation gp.MemberInvitation
	if err := client.request(context.Background(), "/gateway/v4/invitations", gp.InvitationRequest{ProtocolVersion: gp.Version}, &invitation); err != nil {
		t.Fatal(err)
	}
	if err := gatewaymembership.VerifyInvitation(invitation, time.Now()); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "invitation.json")
	if err := writeInvitationFile(file, invitation); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var saved gp.MemberInvitation
	if json.Unmarshal(before, &saved) != nil || saved != invitation {
		t.Fatal("invitation delivery changed")
	}
	info, err := os.Stat(file)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("invitation is not private")
	}
	if err := writeInvitationFile(file, gp.MemberInvitation{}); err == nil {
		t.Fatal("existing invitation overwritten")
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(before) {
		t.Fatal("existing invitation changed")
	}
	var catalog gp.CatalogResponse
	if err := client.request(context.Background(), "/gateway/v4/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog); err != nil {
		t.Fatal(err)
	}
	if !catalog.Gateway.Permissions.ManageMembers || catalog.Policy.DefaultCloudAllowed || len(catalog.Members) != 0 {
		t.Fatal("invitation changed membership or Cloud authorization")
	}
	policy := catalog.Policy
	policy.DefaultCloudAllowed = true
	request := gp.UpdatePolicyRequest{ProtocolVersion: gp.Version, ExpectedRevision: policy.Revision, Policy: policy}
	if err := client.request(context.Background(), "/gateway/v4/policy", request, nil); err != nil {
		t.Fatal(err)
	}
	if err := client.request(context.Background(), "/gateway/v4/policy", request, nil); err == nil {
		t.Fatal("stale policy revision accepted")
	}
}
