package gatewaymembership

import (
	"context"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestNetworkSettingsPreserveAuthorityAndRecoverAfterRestart(t *testing.T) {
	s, identity := membershipStore(t)
	invite, err := s.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invite, "runtime_network")
	if _, err := s.Join(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	before, policy, _ := s.Snapshot()
	root := s.Endpoint().RootPEM
	settings := gp.GatewayNetworkSettings{ListenAddresses: []string{"0.0.0.0:7444", "[::1]:7445"}, AllowedHosts: []string{"gateway.internal", "127.0.0.1"}, Endpoints: s.Endpoints()}
	if err := s.UpdateNetworkSettings(settings); err != nil {
		t.Fatal(err)
	}
	if s.Endpoint().RootPEM != root {
		t.Fatal("listener edits rotated member authority")
	}
	reopened, err := NewStore(s.path, identity, "", "", s.hooks)
	if err != nil {
		t.Fatal(err)
	}
	after, nextPolicy, _ := reopened.Snapshot()
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(policy, nextPolicy) {
		t.Fatal("network edits changed members or policy")
	}
	if !reflect.DeepEqual(reopened.NetworkSettings(), settings) {
		t.Fatal("network settings did not survive restart")
	}
}

func TestAllowedHostsMatchRequestAuthorityWithoutTrustingForwardedHeaders(t *testing.T) {
	s, _ := membershipStore(t)
	request := httptest.NewRequest("GET", "https://arbitrary.example:7443/v6/member/invitation-exchange", nil)
	if !s.AllowsHost(request) {
		t.Fatal("default must allow all Hosts")
	}
	settings := s.NetworkSettings()
	settings.AllowedHosts = []string{"gateway.internal", "::1"}
	if err := s.UpdateNetworkSettings(settings); err != nil {
		t.Fatal(err)
	}
	for host, want := range map[string]bool{"GATEWAY.INTERNAL:7443": true, "gateway.internal": true, "[::1]:7443": true, "evil.example": false, "gateway.internal.evil": false} {
		request.Host = host
		request.Header.Set("X-Forwarded-Host", "gateway.internal")
		if got := s.AllowsHost(request); got != want {
			t.Errorf("Host %s: got %v want %v", host, got, want)
		}
	}
}

func TestNetworkSettingsRejectInvalidAndFailedWritesAtomically(t *testing.T) {
	s, _ := membershipStore(t)
	before, _ := os.ReadFile(s.path)
	settings := s.NetworkSettings()
	settings.ListenAddresses = []string{"https://gateway.internal:7443"}
	if err := s.UpdateNetworkSettings(settings); err == nil {
		t.Fatal("accepted URL as listener binding")
	}
	settings = s.NetworkSettings()
	settings.AllowedHosts = []string{"*.example"}
	if err := s.UpdateNetworkSettings(settings); err == nil {
		t.Fatal("accepted ambiguous wildcard")
	}
	after, _ := os.ReadFile(s.path)
	if string(before) != string(after) {
		t.Fatal("invalid edits changed disk")
	}
	settings = s.NetworkSettings()
	settings.ListenAddresses = []string{"127.0.0.1:7555"}
	old := s.NetworkSettings()
	s.path = s.path + "/invalid"
	if err := s.UpdateNetworkSettings(settings); err == nil {
		t.Fatal("expected persistence failure")
	}
	if !reflect.DeepEqual(old, s.NetworkSettings()) {
		t.Fatal("failed save changed live settings")
	}
}

func TestCurrentNetworkSettingsPreserveHostnameBindingsAndRejectDrift(t *testing.T) {
	s, identity := membershipStore(t)
	old := s.clone()
	old.SchemaVersion = 5
	old.Endpoint.ListenAddress = "localhost:7443"
	old.Endpoint.ListenAddresses = []string{"localhost:7443"}
	old.Endpoint.AllowedHosts = []string{}
	if err := gatewaystate.Write(s.path, old); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(s.path, identity, "", "", s.hooks)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.NetworkSettings().ListenAddresses[0] != "localhost:7443" {
		t.Fatal("restart changed existing hostname binding")
	}
	drift := reopened.clone()
	drift.Endpoint.AllowedHosts = nil
	if err := gatewaystate.Write(s.path, drift); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.path)
	if _, err := NewStore(s.path, identity, "", "", s.hooks); err == nil {
		t.Fatal("accepted missing current Host settings")
	}
	after, _ := os.ReadFile(s.path)
	if string(before) != string(after) {
		t.Fatal("schema drift modified disk")
	}
}
