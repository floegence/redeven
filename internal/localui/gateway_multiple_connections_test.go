package localui

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayservice"
)

func TestRuntimePairsWithTwoGatewaysAndRemovesOnlySelectedMember(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	hostToken := strings.Repeat("a", 43)
	var deliveries []gc.InvitationCodeDelivery
	var gateways []*gatewayservice.Server
	for range 2 {
		reservation, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		address := reservation.Addr().String()
		_ = reservation.Close()
		gateway, err := gatewayservice.New(gatewayservice.Options{StateRoot: filepath.Join(t.TempDir(), "gateway"), HostAdminToken: hostToken, MemberURL: "https://" + address, MemberListen: address})
		if err != nil {
			t.Fatal(err)
		}
		server, _, err := gateway.Start(ctx, "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer server.Close()
		gateways = append(gateways, gateway)
		request := httptest.NewRequest(http.MethodPost, "http://localhost/gateway/v6/invitation-codes", strings.NewReader(`{"protocol_version":"redeven-gateway-v6"}`))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set(gatewayservice.HostAdminHeader, hostToken)
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		var result struct {
			Data gc.InvitationCodeDelivery `json:"data"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal("invitation unavailable", response.Code)
		}
		deliveries = append(deliveries, result.Data)
	}
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	defer gate.Close()
	runtime := newTestServer(t, gate)
	runtime.a = newRuntimeHealthTestAgent(t, runtime.configPath, gate)
	runtime.appServer = runtime.a.CodeAppServer()
	defer runtime.Close()
	if err := runtime.StartGatewayOnly(ctx); err != nil {
		t.Fatal(err)
	}
	for _, delivery := range deliveries {
		preview, err := runtime.a.PreviewGateway(ctx, delivery.ShareAddress, delivery.Code, "join")
		if err != nil {
			t.Fatal(err)
		}
		if err := runtime.a.ConfirmGatewayPreview(preview.PreviewID, "join", ""); err != nil {
			t.Fatal(err)
		}
	}
	waitFor := func(predicate func() bool) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			if predicate() {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("Gateway connections did not settle")
	}
	waitFor(func() bool {
		members := runtime.a.GatewayMembershipStatus().Memberships
		return len(members) == 2 && members[0].Phase == "joined" && members[1].Phase == "joined"
	})
	saved, err := config.Load(runtime.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Gateways) != 2 || saved.CloudGateway() != nil {
		t.Fatal("pairing changed Cloud ownership")
	}
	runtime.a.CloseGatewayMembership()
	if err := runtime.a.StartGatewayMembership(ctx, runtime.gatewayMemberApplication); err != nil {
		t.Fatal(err)
	}
	waitFor(func() bool {
		members := runtime.a.GatewayMembershipStatus().Memberships
		return len(members) == 2 && members[0].Phase == "joined" && members[1].Phase == "joined"
	})
	if err := runtime.a.LeaveGateway(deliveries[0].GatewayID); err != nil {
		t.Fatal(err)
	}
	waitFor(func() bool {
		members := runtime.a.GatewayMembershipStatus().Memberships
		return len(members) == 1 && members[0].GatewayID == deliveries[1].GatewayID && members[0].Phase == "joined"
	})
	saved, err = config.Load(runtime.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Gateways) != 1 || saved.Gateways[0].GatewayID != deliveries[1].GatewayID {
		t.Fatal("selected removal lost the other member")
	}
	for index, gateway := range gateways {
		request := httptest.NewRequest(http.MethodPost, "http://localhost/gateway/v6/catalog", strings.NewReader(`{"protocol_version":"redeven-gateway-v6"}`))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set(gatewayservice.HostAdminHeader, hostToken)
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatal("catalog unavailable", index, response.Code)
		}
		var catalog struct {
			Data struct {
				Members []struct {
					State     string `json:"state"`
					Connected bool   `json:"connected"`
				} `json:"members"`
			} `json:"data"`
		}
		if json.Unmarshal(response.Body.Bytes(), &catalog) != nil {
			t.Fatal("catalog response malformed")
		}
		if index == 0 && len(catalog.Data.Members) != 0 || index == 1 && (len(catalog.Data.Members) != 1 || !catalog.Data.Members[0].Connected || catalog.Data.Members[0].State != "active") {
			t.Fatal("Gateway removal affected another pairing")
		}
	}
}
