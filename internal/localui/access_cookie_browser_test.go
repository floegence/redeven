package localui

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/pquerna/otp/totp"
)

// The opt-in browser check exercises production handlers with Chromium's real
// cookie store. Go's cookiejar does not enforce Secure-cookie overwrite rules.
func TestLocalAccessBrowserSession(t *testing.T) {
	if os.Getenv("REDEVEN_LOCAL_ACCESS_BROWSER") != "1" {
		t.Skip("run scripts/check_local_access_browser.sh")
	}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	var host string
	for _, address := range addresses {
		if network, ok := address.(*net.IPNet); ok && network.IP.To4() != nil && network.IP.IsPrivate() && !network.IP.IsLoopback() {
			host = network.IP.String()
			break
		}
	}
	if host == "" {
		t.Fatal("browser cookie acceptance requires a private IPv4 interface; localhost has special Secure-cookie exemptions")
	}
	const password = "cookie-fixture-password"
	type fixture struct {
		mu       sync.RWMutex
		server   *Server
		endpoint *httptest.Server
		state    string
	}
	start := func(secure bool, ttl time.Duration) *fixture {
		state := t.TempDir()
		var gate *accessgate.Gate
		if ttl != 0 {
			gate = accessgate.New(accessgate.Options{Password: password, LocalSessionTTL: ttl})
		} else {
			hash, err := accessgate.HashPassword(password)
			if err != nil {
				t.Fatal(err)
			}
			if err := accessgate.WritePasswordHash(state, hash); err != nil {
				t.Fatal(err)
			}
			gate, err = accessgate.OpenPersistent(state)
			if err != nil {
				t.Fatal(err)
			}
		}
		server := newTestServer(t, gate)
		listener, err := net.Listen("tcp4", net.JoinHostPort(host, "0"))
		if err != nil {
			t.Fatal(err)
		}
		server.publicAccess.authorities = map[string]struct{}{listener.Addr().String(): {}}
		f := &fixture{server: server, state: state}
		// The test-only lock permits replacing the process-local gate on restart.
		// Every browser request still runs through the production network handler.
		handler := server.networkHandler()
		endpoint := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			f.mu.RLock()
			defer f.mu.RUnlock()
			handler.ServeHTTP(w, r)
		}))
		_ = endpoint.Listener.Close()
		endpoint.Listener = listener
		if secure {
			endpoint.StartTLS()
		} else {
			server.protocol = "http"
			endpoint.Start()
		}
		f.endpoint = endpoint
		t.Cleanup(func() { _ = f.server.accessGate.Close() })
		t.Cleanup(endpoint.Close)
		t.Logf("cookie fixture pid=%d endpoint=%s state=%s config=%s", os.Getpid(), endpoint.URL, state, filepath.Dir(server.configPath))
		return f
	}
	enableMFA := func(f *fixture) string {
		gate := f.server.accessGate
		setup, err := gate.Manage("fixture-owner", "Browser fixture", accessgate.SecurityRequest{Action: "setup"})
		if err != nil {
			t.Fatal(err)
		}
		code, err := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
		if err != nil {
			t.Fatal(err)
		}
		verified, err := gate.Manage("fixture-owner", "Browser fixture", accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := gate.Manage("fixture-owner", "Browser fixture", accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
			t.Fatal(err)
		}
		return verified.RecoveryCodes[0]
	}
	httpA, httpB, https := start(false, 0), start(false, 0), start(true, 0)
	expiring := start(false, 3*time.Second)
	mfaA, mfaB := start(true, 0), start(true, 0)
	mfaCodeA, mfaCodeB := enableMFA(mfaA), enableMFA(mfaB)
	controlToken := rand.Text()
	// Control is test-only, loopback-bound and authenticated. It never enters the
	// product router or touches a user Runtime/state directory.
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+controlToken {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		httpA.mu.Lock()
		defer httpA.mu.Unlock()
		var err error
		switch r.URL.Path {
		case "/restart":
			err = httpA.server.accessGate.Close()
			if err == nil {
				httpA.server.accessGate, err = accessgate.OpenPersistent(httpA.state)
			}
		case "/recover":
			_, err = httpA.server.accessGate.Manage("fixture-owner", "Browser fixture", accessgate.SecurityRequest{Action: "recover"})
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err != nil {
			t.Errorf("fixture control failed: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer control.Close()
	certificateHash := sha256.Sum256(https.endpoint.Certificate().RawSubjectPublicKeyInfo)
	configuration, err := json.Marshal(map[string]string{
		"httpA": httpA.endpoint.URL, "httpB": httpB.endpoint.URL, "https": https.endpoint.URL,
		"expiring": expiring.endpoint.URL, "mfaA": mfaA.endpoint.URL, "mfaB": mfaB.endpoint.URL,
		"mfaCodeA": mfaCodeA, "mfaCodeB": mfaCodeB,
		"control": control.URL, "controlToken": controlToken,
		"certificateSPKI": base64.StdEncoding.EncodeToString(certificateHash[:]),
	})
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "../envapp/ui_src/scripts/checkLocalAccessSession.mjs", string(configuration))
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		t.Fatalf("browser access-session acceptance: %v", err)
	}
}
