package localui

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/remotedesktop"
)

// This exercises the actual issuer, Acceptor, Agent, access proxy and AppServer.
// Creating a view session does not open capture or request OS permissions.
func newWindowSessionFixture(t *testing.T, protocol string) (*Server, *http.Client, string, remotedesktop.Session, remotedesktop.Session) {
	t.Helper()
	s := newTestServer(t, nil)
	s.protocol = protocol
	cfg, err := config.LoadForStartup(s.configPath)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PermissionPolicy, err = config.ParsePermissionPolicyPreset("execute_read_write")
	if err != nil {
		t.Fatal(err)
	}
	if err := config.Save(s.configPath, cfg); err != nil {
		t.Fatal(err)
	}
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	s.appServer = s.a.CodeAppServer()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s.bind, err = ParseBind(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.StartOnListeners(t.Context(), []net.Listener{listener}, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	base := protocol + "://" + listener.Addr().String()
	roots := x509.NewCertPool()
	roots.AddCert(s.deviceCA.certificate)
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}}
	t.Cleanup(transport.CloseIdleConnections)
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	create := func() remotedesktop.Session {
		w := httptest.NewRecorder()
		s.appServer.ServeHTTP(w, appserver.WithLocalUIEnvRoute(httptest.NewRequest("POST", "/_redeven_proxy/api/remote-desktop/sessions", strings.NewReader(`{"mode":"view","locale":"en-US"}`))))
		if w.Code != http.StatusOK {
			t.Fatal(w.Code, w.Body.String())
		}
		var result struct {
			Data remotedesktop.Session `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Data
	}
	owned, other := create(), create()
	return s, client, base, owned, other
}

func TestWindowSessionE2E(t *testing.T) {
	s, client, base, owned, other := newWindowSessionFixture(t, "https")
	roots := x509.NewCertPool()
	roots.AddCert(s.deviceCA.certificate)
	connect := func() flowersec.Session {
		response, err := client.Post(base+"/pf/"+owned.ForwardID+"/_redeven_window/connect", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatal("acquisition", response.Status)
		}
		var envelope connectArtifactEnvelope
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.PluginSessionCredential != "" {
			t.Fatal("window acquired management credential")
		}
		artifact, err := flowersec.ParseArtifact(envelope.ConnectArtifact)
		if err != nil {
			t.Fatal(err)
		}
		lease, err := flowersec.NewArtifactLease(artifact, func(ctx context.Context) error {
			attempt, err := randomB64u(32)
			if err != nil {
				return err
			}
			scope := envelope.SpendScope
			body, err := json.Marshal(localSpendRequest{AttemptID: attempt, Receipt: scope.Receipt, ArtifactDigestB64u: scope.ArtifactDigestB64u, ProjectionDigestB64u: scope.ProjectionDigestB64u, LauncherOrigin: scope.LauncherOrigin, RuntimeOrigin: scope.RuntimeOrigin, AppOrigin: scope.AppOrigin, Consumer: scope.Consumer, TargetBinding: scope.TargetBinding, ExpiresAt: scope.ExpiresAt})
			if err != nil {
				return err
			}
			r, err := http.NewRequestWithContext(ctx, "POST", base+"/pf/"+owned.ForwardID+"/_redeven_window/spend", strings.NewReader(string(body)))
			if err != nil {
				return err
			}
			r.Header.Set("Origin", base)
			r.Header.Set("Content-Type", "application/json")
			response, err := client.Do(r)
			if err != nil {
				return err
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				return fmt.Errorf("spend: %s", response.Status)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		current, err := flowersec.Connect(t.Context(), lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: base, ConnectTimeout: 5 * time.Second})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = current.Close() })
		return current
	}
	current := connect()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	for _, path := range []string{"/_redeven_desktop/", "/_redeven_desktop/assets/viewer.js"} {
		if response := localSessionProxyRequest(t, ctx, current, path, false); response.Status != http.StatusOK {
			t.Fatalf("window route %s: %+v", path, response)
		}
	}
	for _, path := range []string{"/pf/" + other.ForwardID + "/_redeven_desktop/", "/_redeven_proxy/api/remote-desktop", "/_redeven_proxy/api/spaces"} {
		if response := localSessionProxyRequest(t, ctx, current, path, false); response.Status == http.StatusOK {
			t.Fatalf("window escaped scope: %s", path)
		}
	}
	var rpc any
	if err := current.RPC().Call(ctx, 1, map[string]any{}, &rpc); err == nil {
		t.Fatal("window received Env RPC authority")
	}
	_ = current.Close()
	// A fresh resource session may reconnect; closing the carrier retains work.
	reconnected := connect()
	if response := localSessionProxyRequest(t, ctx, reconnected, "/_redeven_desktop/", false); response.Status != http.StatusOK {
		t.Fatal("reconnect lost resource", response)
	}
	if response := localSessionProxyMethod(t, ctx, reconnected, "POST", "/_redeven_desktop/disconnect", false); response.Status != http.StatusOK {
		t.Fatal("viewer disconnect did not return its confirmation", response)
	}
	for _, item := range []struct {
		id     string
		status int
	}{{owned.ID, http.StatusNotFound}, {other.ID, http.StatusOK}} {
		w := httptest.NewRecorder()
		s.appServer.ServeHTTP(w, appserver.WithLocalUIEnvRoute(httptest.NewRequest("GET", "/_redeven_proxy/api/remote-desktop/sessions/"+item.id, nil)))
		if w.Code != item.status {
			t.Fatalf("disconnect session ownership: %s returned %d, want %d", item.id, w.Code, item.status)
		}
	}
	if response := localSessionProxyRequest(t, ctx, reconnected, "/_redeven_desktop/", false); response.Status == http.StatusOK {
		t.Fatal("removed share retained access")
	}
}

func TestWindowBrowserE2E(t *testing.T) {
	if os.Getenv("REDEVEN_WINDOW_BROWSER_ACCEPTANCE") != "1" {
		t.Skip("explicit browser acceptance")
	}
	for _, protocol := range []string{"https", "http"} {
		t.Run(protocol, func(t *testing.T) {
			s, _, base, owned, _ := newWindowSessionFixture(t, protocol)
			profiles := []map[string]string{{"origin": base, "kind": "direct"}}
			if protocol == "https" {
				profiles = append(profiles, map[string]string{"origin": strings.TrimRight(s.localUIBridgeURL, "/"), "kind": "private", "token": s.localUIBridgeToken})
			}
			payload, err := json.Marshal(map[string]any{"profiles": profiles, "forward": owned.ForwardID})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
			defer cancel()
			script, err := filepath.Abs("../codeapp/ui_src/scripts/checkWindowTransport.mjs")
			if err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, "node", script)
			command.Env = append(os.Environ(), "REDEVEN_WINDOW_FIXTURE="+string(payload))
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("browser acceptance: %v\n%s", err, output)
			}
			t.Log(string(output))
		})
	}
}
