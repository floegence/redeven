package environmentcenter

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestLogoutCancelsPendingCatalogRequest(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			accepted <- conn
		}
	}()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	c.state.Gateways = []GatewayRecord{{ID: "blocked", URL: "https://" + listener.Addr().String(), ClientPrivateKey: keys.PrivateKeyPEM}}
	c.mu.Unlock()
	server := NewServer(c, nil)
	defer server.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		requestCenter(t, server, "GET", "/api/center/v1/catalog?source=blocked", "", "", &http.Cookie{Name: sessionCookie, Value: login.Token})
	}()
	// The fake endpoint intentionally holds TLS negotiation before any data or
	// Gateway proof can be accepted. This is a reproducible stalled network.
	select {
	case conn := <-accepted:
		defer conn.Close()
	case <-time.After(2 * time.Second):
		t.Fatal("catalog did not reach the test endpoint")
	}
	if err = c.Revoke(login.Token, "", false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("logout left pending catalog network activity alive")
	}
}

func TestRepeatedTabsCannotExhaustOtherDeviceReceipts(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	first := loginRecovery(t, c, "first", codes[0])
	second := loginRecovery(t, c, "second", codes[1])
	a := newWebAccess(c)
	defer a.Close()
	one := admissionFixture(t, c, a, first.Token, "one")
	admissionFixture(t, c, a, second.Token, "other")
	c.mu.Lock()
	c.state.Gateways = []GatewayRecord{{ID: "source"}}
	c.state.Routes = []Route{one.route}
	c.mu.Unlock()
	for i := range 150 {
		_, err := a.open(first.Token, "route", fmt.Sprintf("repeated-tab-request-%03d", i))
		if errors.Is(err, ErrBusy) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.open(second.Token, "route", "other-device-new-request"); err != nil {
		t.Fatalf("one device exhausted another device's open budget: %v", err)
	}
}

// Install already authenticated access so these tests exercise admission and
// cancellation without replacing the Gateway transport with a fake network.
func admissionFixture(t *testing.T, c *Center, a *webAccess, token, id string) *openOperation {
	t.Helper()
	c.mu.Lock()
	device, err := c.sessionLocked(token)
	if err != nil {
		c.mu.Unlock()
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(device.Context)
	op := &openOperation{Sequence: 2, ID: id, RouteID: "route", RequestID: "fixture-" + id, session: token, device: device.Device, route: Route{ID: "route", SourceID: "source", Origin: "https://env.example.test"}, Status: "ready", consumed: true, accessToken: randomID(), ctx: ctx, cancel: cancel, expires: time.Now().Add(time.Minute)}
	c.mu.Unlock()
	a.mu.Lock()
	a.operations[op.ID] = op
	a.access[digest(op.accessToken)] = &accessSession{operation: op, ctx: ctx}
	a.mu.Unlock()
	context.AfterFunc(ctx, func() { a.mu.Lock(); defer a.mu.Unlock(); a.releaseLocked(op) })
	return op
}

func sessionRequest(a *webAccess, cookie string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "https://env.example.test/__center/session", nil)
	r.AddCookie(&http.Cookie{Name: accessCookie, Value: cookie})
	w := httptest.NewRecorder()
	a.serve(w, r)
	return w
}

func TestAdmissionBudgetsIsolateRoutesAndDevices(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	first := loginRecovery(t, c, "first", codes[0])
	second := loginRecovery(t, c, "second", codes[1])
	a := newWebAccess(c)
	defer a.Close()
	one := admissionFixture(t, c, a, first.Token, "one")
	sibling := admissionFixture(t, c, a, first.Token, "sibling")
	other := admissionFixture(t, c, a, second.Token, "other")
	assertStatus := func(token string, want int) {
		t.Helper()
		w := sessionRequest(a, token)
		if w.Code != want || want == http.StatusTooManyRequests && w.Header().Get("Retry-After") == "" {
			t.Fatalf("admission status %d, want %d (retry %q)", w.Code, want, w.Header().Get("Retry-After"))
		}
	}
	a.access[digest(one.accessToken)].requests = 16
	assertStatus(one.accessToken, http.StatusTooManyRequests)
	assertStatus(sibling.accessToken, http.StatusOK)
	assertStatus(other.accessToken, http.StatusOK)
	a.access[digest(one.accessToken)].requests = 0
	a.deviceRequests[one.device] = 48
	assertStatus(sibling.accessToken, http.StatusTooManyRequests)
	assertStatus(other.accessToken, http.StatusOK)
	delete(a.deviceRequests, one.device)
	a.requests = 192
	assertStatus(other.accessToken, http.StatusTooManyRequests)
	a.requests = 0
	assertStatus(one.accessToken, http.StatusOK)
	if len(a.deviceRequests) != 0 || a.requests != 0 {
		t.Fatal("completed or rejected request leaked admission capacity")
	}
}

func TestGatewayRequestBudgetPreservesOtherSourcesAndLogout(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	s := NewServer(c, nil)
	defer s.Close()
	var contexts []context.Context
	for range 2 {
		ctx, release, err := s.gatewayRequest(t.Context(), login.Token, "slow-source")
		if err != nil {
			t.Fatal(err)
		}
		defer release()
		contexts = append(contexts, ctx)
	}
	if _, release, err := s.gatewayRequest(t.Context(), login.Token, "slow-source"); !errors.Is(err, ErrBusy) {
		if release != nil {
			release()
		}
		t.Fatalf("slow source exceeded its budget: %v", err)
	}
	ctx, release, err := s.gatewayRequest(t.Context(), login.Token, "another-source")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	contexts = append(contexts, ctx)
	if err = c.Revoke(login.Token, "", false); err != nil {
		t.Fatal(err)
	}
	for _, ctx := range contexts {
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
			t.Fatal("outbound request survived device revocation")
		}
	}
}

func TestRevocationRacesCannotLeaveLiveAdmissions(t *testing.T) {
	for _, mode := range []string{"device", "all", "password", "recovery", "close"} {
		t.Run(mode, func(t *testing.T) {
			c, _, _, codes := configuredCenter(t)
			first := loginRecovery(t, c, "first", codes[0])
			second := loginRecovery(t, c, "second", codes[1])
			a := newWebAccess(c)
			defer a.Close()
			one := admissionFixture(t, c, a, first.Token, "one")
			other := admissionFixture(t, c, a, second.Token, "other")
			firstCookie, otherCookie := one.accessToken, other.accessToken
			c.mu.Lock()
			c.state.Gateways = []GatewayRecord{{ID: "source"}}
			c.state.Routes = []Route{one.route}
			c.mu.Unlock()
			password, grant := "replacement test password phrase", ""
			if mode == "password" {
				action := passwordAction(password, first.Device.ID)
				challenge, err := c.Authenticate("first", first.Token, "source", "Test", Authentication{Password: testPassword, Action: action})
				if err != nil {
					t.Fatal(err)
				}
				verified, err := c.Authenticate("first", first.Token, "source", "Test", Authentication{Challenge: challenge.Challenge, Recovery: codes[2], Action: action})
				if err != nil {
					t.Fatal(err)
				}
				grant = verified.Grant
			}
			start := make(chan struct{})
			var wg sync.WaitGroup
			for n := range 32 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					_, _ = a.open(first.Token, "route", fmt.Sprintf("concurrent-request-%03d", n))
					_ = sessionRequest(a, firstCookie)
				}()
			}
			close(start)
			var err error
			switch mode {
			case "device":
				err = c.Revoke(first.Token, "", false)
			case "all":
				err = c.Revoke(first.Token, "", true)
			case "password":
				err = c.ChangePassword(first.Token, grant, password)
			case "recovery":
				_, err = c.OwnerBootstrap(true)
			case "close":
				err = c.Close()
			}
			if err != nil {
				t.Fatal(err)
			}
			wg.Wait()
			if w := sessionRequest(a, firstCookie); w.Code != http.StatusUnauthorized {
				t.Fatalf("revoked access returned %d", w.Code)
			}
			if _, err := a.open(first.Token, "route", "after-revocation-request"); err == nil {
				t.Fatal("new admission survived revocation")
			}
			want := http.StatusUnauthorized
			if mode == "device" {
				want = http.StatusOK
			}
			if got := sessionRequest(a, otherCookie).Code; got != want {
				t.Fatalf("other device returned %d, want %d", got, want)
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			for _, op := range a.operations {
				if (mode != "device" || op.session == first.Token) && op.ctx.Err() == nil {
					t.Fatal("concurrent operation escaped the revoked device context")
				}
			}
			if a.requests != 0 || len(a.deviceRequests) != 0 {
				t.Fatal("concurrent requests leaked budget")
			}
		})
	}
}
