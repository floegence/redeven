package localui

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/monitor"
	"github.com/floegence/redeven/internal/sessionhop"
)

func TestNetworkAccessKeepsAuthenticatedLocalAliases(t *testing.T) {
	for _, protocol := range []string{"http", "https"} {
		t.Run(protocol, func(t *testing.T) {
			primary, err := net.Listen("tcp4", "0.0.0.0:0")
			if err != nil {
				t.Fatal(err)
			}
			port := primary.Addr().(*net.TCPAddr).Port
			bind, _ := ParseBind(fmt.Sprintf("0.0.0.0:%d", port))
			listeners := []net.Listener{primary}
			supplement, err := net.Listen("tcp6", net.JoinHostPort("::1", fmt.Sprint(port)))
			if err == nil {
				listeners = append(listeners, supplement)
			} else if !unavailableAddressFamily(err) {
				primary.Close()
				t.Fatal(err)
			}
			s := newTestServer(t, accessgate.New(accessgate.Options{Password: "shared-secret"}))
			s.bind, s.protocol = bind, protocol
			s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.StartOnListeners(ctx, listeners, nil); err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			roots := x509.NewCertPool()
			roots.AddCert(s.deviceCA.certificate)
			var clients []*http.Client
			var sessions []flowersec.Session
			urls := s.DisplayURLs()
			for _, raw := range urls {
				base := strings.TrimRight(raw, "/")
				jar, _ := cookiejar.New(nil)
				client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}}, Jar: jar, Timeout: 5 * time.Second}
				defer client.CloseIdleConnections()
				clients = append(clients, client)
				request := func(method, path, body string, want int) *http.Response {
					t.Helper()
					req, _ := http.NewRequestWithContext(ctx, method, base+path, bytes.NewBufferString(body))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Origin", base)
					res, err := client.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					if res.StatusCode != want {
						res.Body.Close()
						t.Fatalf("%s %s%s = %d, want %d", method, base, path, res.StatusCode, want)
					}
					return res
				}
				request("GET", "/", "", 200).Body.Close()
				request("POST", "/api/local/direct/connect_artifact", `{}`, 423).Body.Close()
				request("POST", "/api/local/access/unlock", `{"password":"wrong"}`, 401).Body.Close()
				request("POST", "/api/local/access/unlock", `{"password":"shared-secret"}`, 200).Body.Close()
				res := request("POST", "/api/local/direct/connect_artifact", `{}`, 200)
				var envelope connectArtifactEnvelope
				err = json.NewDecoder(res.Body).Decode(&envelope)
				res.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if protocol == "https" {
					artifact, err := flowersec.ParseArtifact(envelope.ConnectArtifact)
					if err != nil {
						t.Fatal(err)
					}
					lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error {
						attempt, err := randomB64u(32)
						if err != nil {
							return err
						}
						scope := envelope.SpendScope
						body, err := json.Marshal(localSpendRequest{AttemptID: attempt, Receipt: scope.Receipt,
							ArtifactDigestB64u: scope.ArtifactDigestB64u, ProjectionDigestB64u: scope.ProjectionDigestB64u,
							LauncherOrigin: scope.LauncherOrigin, RuntimeOrigin: scope.RuntimeOrigin, AppOrigin: scope.AppOrigin,
							Consumer: scope.Consumer, TargetBinding: scope.TargetBinding, ExpiresAt: scope.ExpiresAt})
						if err != nil {
							return err
						}
						request("POST", "/api/local/direct/artifact/spend", string(body), 204).Body.Close()
						return nil
					})
					if err != nil {
						t.Fatal(err)
					}
					current, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: base, ConnectTimeout: 5 * time.Second})
					if err != nil {
						t.Fatalf("WSS %s: %v", base, err)
					}
					defer current.Close()
					sessions = append(sessions, current)
					waitPublicSessionReady(t, client, base, envelope)
					var response map[string]any
					if err := current.RPC().Call(ctx, monitor.TypeID_SYS_MONITOR, map[string]any{}, &response); err != nil {
						t.Fatal(err)
					}
				}
				for _, origin := range []string{protocol + "://attacker.example", protocol + "://localhost:" + fmt.Sprint(port+1)} {
					assertWebSocketAdmission(t, client, base, "", origin, flowersec.WebSocketDirectPath, 403)
				}
				if len(urls) > 1 {
					other := strings.TrimRight(urls[0], "/")
					if other == base {
						other = strings.TrimRight(urls[1], "/")
					}
					assertWebSocketAdmission(t, client, base, "", other, flowersec.WebSocketDirectPath, 403)
				}
				for _, host := range []string{"localhost.example:" + fmt.Sprint(port), "127.0.0.1:" + fmt.Sprint(port+1)} {
					assertWebSocketAdmission(t, client, base, host, base, flowersec.WebSocketDirectPath, 403)
				}
			}
			res, err := clients[0].Post(strings.TrimRight(urls[0], "/")+"/api/local/access/logout", "application/json", nil)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			for index, client := range clients {
				res, err := client.Post(strings.TrimRight(urls[index], "/")+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
				if err != nil {
					t.Fatal(err)
				}
				res.Body.Close()
				want := 200
				if index == 0 {
					want = 423
				}
				if res.StatusCode != want {
					t.Fatalf("session %s after logout = %d, want %d", urls[index], res.StatusCode, want)
				}
			}
			for _, current := range sessions[min(1, len(sessions)):] {
				if _, err := current.ProbeLiveness(ctx); err != nil {
					t.Fatalf("another alias logout interrupted this session: %v", err)
				}
			}
		})
	}
}

// Match browser admission: transport connection precedes product route readiness.
func waitPublicSessionReady(t *testing.T, client *http.Client, base string, envelope connectArtifactEnvelope) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	body, _ := json.Marshal(pluginSessionReadyRequest{ChannelID: envelope.ChannelID})
	req, _ := http.NewRequestWithContext(ctx, "POST", base+"/api/local/plugin/session/ready", bytes.NewReader(body))
	req.Header.Set(sessionhop.HeaderPluginSessionCredential, envelope.PluginSessionCredential)
	req.Header.Set("Origin", base)
	ready, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	ready.Body.Close()
	if ready.StatusCode != 204 {
		t.Fatalf("session readiness %s = %d", base, ready.StatusCode)
	}
}

func assertWebSocketAdmission(t *testing.T, client *http.Client, base, host, origin, path string, want int) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+path, nil)
	if host != "" {
		req.Host = host
	}
	req.Header.Set("Origin", origin)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", base64.StdEncoding.EncodeToString([]byte("the sample nonce")))
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != want {
		t.Errorf("WS %s Host=%q Origin=%q = %d, want %d", base, host, origin, res.StatusCode, want)
	}
}
