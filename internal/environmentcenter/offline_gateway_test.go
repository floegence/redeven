package environmentcenter

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewayhost"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestFreshOfflineGatewayPairingUsesScopedTrustAndRevocation(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("private-host-token", 3)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: root, PublicURL: "https://127.0.0.1", PublicListen: "127.0.0.1:0", HostAdminToken: token})
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
	if err := gatewaystate.Write(filepath.Join(root, "gateway-host-admin.json"), token); err != nil {
		t.Fatal(err)
	}
	host, err := gatewayhost.New(root, listeners[0].Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	var issued gp.ClientAccessCodeResponse
	if err := host.Request(ctx, "/gateway/v6/clients/access-codes", gp.ClientAccessCodeRequest{ProtocolVersion: gp.Version}, &issued); err != nil {
		t.Fatal(err)
	}
	access, err := gp.DecodeClientAccessPackage(issued.AccessCode, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	address := "https://" + listeners[1].Addr().String()
	plain := newGatewayClient(GatewayRecord{URL: address})
	defer plain.close()
	if err := plain.request(ctx, "pairing/challenge", gp.PairingChallengeRequest{}, new(any), false); err == nil {
		t.Fatal("untrusted TLS root accepted")
	}
	pair, err := beginPair(ctx, address, "Offline Gateway", issued.AccessCode, "center-session")
	if err != nil {
		t.Fatal(err)
	}
	record, err := pair.complete(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if record.TLSRoot != access.TLSRootPEM || record.GatewayID != access.GatewayID {
		t.Fatal("scoped trust not retained")
	}
	client := newGatewayClient(record)
	defer client.close()
	catalog, err := client.catalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !catalog.Gateway.Permissions.Access || catalog.Gateway.Permissions.ManageAttachments || catalog.Gateway.Permissions.ManageNetwork {
		t.Fatal("client acquired host authority")
	}
	if _, err := beginPair(ctx, address, "Another device", issued.AccessCode, "other"); err == nil {
		t.Fatal("consumed package paired another device")
	}
	for _, route := range []string{"clients/access-codes", "attachments/remove", "network-settings", "cloud/configure"} {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, address+"/gateway/v6/"+route, strings.NewReader("{}"))
		req.Header.Set(gatewayservice.HostAdminHeader, token)
		response, err := client.http.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("management route exposed: %s", route)
		}
	}
	if err := host.Request(ctx, "/gateway/v6/clients/revoke", gp.ClientRevokeRequest{ProtocolVersion: gp.Version, ClientKeyID: record.ClientKeyID}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.catalog(ctx); err == nil {
		t.Fatal("revoked device retained admission")
	}
}
