package gatewayservice

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestNetworkSettingsSaveKeepsLiveListenerAndAppliesOnRestart(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("t", 32)
	server, err := New(Options{StateRoot: root, HostAdminToken: token, MemberListen: "127.0.0.1:0", MemberURL: "https://gateway.internal:7443"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	admin, listeners, err := server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	settings := server.members.NetworkSettings()
	settings.ListenAddresses = []string{"[::1]:0"}
	settings.AllowedHosts = []string{"gateway.internal"}
	raw, _ := json.Marshal(gp.NetworkSettingsRequest{ProtocolVersion: gp.Version, Settings: settings})
	request := httptest.NewRequest("POST", "http://127.0.0.1/gateway/v6/network-settings", bytes.NewReader(raw))
	request.RemoteAddr = "127.0.0.1:5000"
	denied := httptest.NewRecorder()
	server.Handler().ServeHTTP(denied, request)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("untrusted update: %d", denied.Code)
	}
	request = httptest.NewRequest("POST", "http://127.0.0.1/gateway/v6/network-settings", bytes.NewReader(raw))
	request.RemoteAddr = "127.0.0.1:5000"
	request.Header.Set(HostAdminHeader, token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	var result struct {
		Data gp.NetworkSettingsResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || !result.Data.RestartRequired {
		t.Fatalf("save result: %d %s", response.Code, response.Body.String())
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(server.members.Endpoint().RootPEM))
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: "gateway.internal", MinVersion: tls.VersionTLS13}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	// Both the product exchange and the released protocol upgrade boundary must
	// reject a disallowed Host before accepting any authentication material.
	for _, path := range []string{"/v6/member/invitation-exchange", flowersec.WebSocketDirectPath} {
		for _, host := range []string{"evil.example", "gateway.internal"} {
			req, _ := http.NewRequest("GET", "https://"+listeners[1].Addr().String()+path, nil)
			req.Host = host
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if host == "evil.example" && res.StatusCode != 403 {
				t.Fatalf("%s bypassed Host restriction: %d", path, res.StatusCode)
			}

		}
	}
	req, _ := http.NewRequest("GET", "https://"+listeners[1].Addr().String()+"/v6/member/unknown", nil)
	req.Host = "gateway.internal"
	allowed, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	allowed.Body.Close()
	if allowed.StatusCode != 404 {
		t.Fatalf("allowed Host did not reach application routing: %d", allowed.StatusCode)
	}
	cancel()
	reopened, err := New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	nextCtx, nextCancel := context.WithCancel(context.Background())
	defer nextCancel()
	nextAdmin, nextListeners, err := reopened.Start(nextCtx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer nextAdmin.Close()
	if !strings.HasPrefix(nextListeners[1].Addr().String(), "[::1]:") {
		t.Fatalf("saved listener not applied: %s", nextListeners[1].Addr())
	}
}
