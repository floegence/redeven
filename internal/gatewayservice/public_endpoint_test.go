package gatewayservice

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestPublicEndpointPairsClientsWithoutCloud(t *testing.T) {
	server, err := New(Options{StateRoot: t.TempDir(), PublicURL: "https://127.0.0.1", PublicListen: "127.0.0.1:0", HostAdminToken: strings.Repeat("h", 43)})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	host, listeners, err := server.Start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(server.members.Endpoint().RootPEM)) {
		t.Fatal("missing Gateway root")
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	code, err := server.trust.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://" + listeners[1].Addr().String()
	raw, _ := json.Marshal(gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: "offline-client", ClientPublicKey: keys.PublicKeyPEM, BindingAudience: origin, AccessCode: code.AccessCode})
	response, err := client.Post(origin+"/gateway/v6/pairing/challenge", "application/json", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("public pairing returned %d", response.StatusCode)
	}
	for _, route := range []string{"clients/access-codes", "clients/revoke", "invitation-codes", "attachments/remove", "network-settings", "endpoints", "policy", "attachments/policy", "operations/query", "cloud/configure"} {
		request, _ := http.NewRequest(http.MethodPost, origin+"/gateway/v6/"+route, strings.NewReader(`{"protocol_version":"redeven-gateway-v6"}`))
		request.Header.Set(HostAdminHeader, server.hostAdminToken)
		request.Header.Set(OperationIDHeader, rand.Text())
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("public management %s returned %d", route, response.StatusCode)
		}
	}
}
