package environmentcenter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSourceRemovalReleasesAdmissionCapacity(t *testing.T) {
	a := newWebAccess(nil)
	defer a.Close()
	ctx, cancel := context.WithCancel(context.Background())
	op := &openOperation{ID: "open", route: Route{SourceID: "source"}, Status: "ready", consumed: true, ctx: ctx, cancel: cancel, expires: time.Now().Add(time.Minute)}
	a.operations[op.ID] = op
	a.access["access"] = &accessSession{operation: op, ctx: ctx}
	a.removeSource("source")
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.access) != 0 {
		t.Fatal("revoked access still consumes admission capacity")
	}
	if ctx.Err() == nil {
		t.Fatal("source removal did not cancel its transport")
	}
}

func TestHandoffPinsDeviceHostNonceAndOrigin(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	a := newWebAccess(c)
	defer a.Close()
	c.mu.Lock()
	session := c.sessions[digest(login.Token)]
	c.mu.Unlock()
	ctx, cancel := context.WithCancel(session.Context)
	op := &openOperation{ID: randomID(), session: login.Token, device: session.Device, route: Route{Origin: "https://env.example.test"}, Status: "ready", ctx: ctx, cancel: cancel, expires: time.Now().Add(time.Minute)}
	a.operations[op.ID] = op
	start := httptest.NewRecorder()
	a.start(start, httptest.NewRequest("GET", op.route.Origin+"/__center/start?operation="+op.ID, nil))
	if start.Code != 303 {
		t.Fatal(start.Code)
	}
	nonce := start.Result().Cookies()[0]
	authorize := httptest.NewRecorder()
	a.authorize(authorize, httptest.NewRequest("GET", start.Header().Get("Location"), nil), login.Token)
	if authorize.Code != 200 || authorize.Header().Get("Referrer-Policy") != "strict-origin" {
		t.Fatal("handoff strips its form Origin")
	}
	op.codeHash = digest("code")
	form := url.Values{"operation": {op.ID}, "challenge": {op.challenge}, "code": {"code"}}
	finish := func(host, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", host+"/__center/finish", strings.NewReader(form.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.Header.Set("Origin", origin)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		out := httptest.NewRecorder()
		a.finish(out, r)
		return out
	}
	for _, v := range []struct {
		host, origin string
		cookie       *http.Cookie
	}{{op.route.Origin, "null", nonce}, {"https://other.example.test", c.key.Origin, nonce}, {op.route.Origin, op.route.Origin, nil}} {
		if finish(v.host, v.origin, v.cookie).Code != 403 {
			t.Fatal("handoff crossed target proof")
		}
	}
	if relay := finish(op.route.Origin, c.key.Origin, nil); relay.Code != 200 {
		t.Fatal("cross-origin relay denied")
	}
	first := finish(op.route.Origin, op.route.Origin, nonce)
	second := finish(op.route.Origin, op.route.Origin, nonce)
	if first.Code != 303 || second.Code != 303 || first.Result().Cookies()[0].Value != second.Result().Cookies()[0].Value {
		t.Fatal("retry did not recover same access")
	}
	if err := c.Revoke(login.Token, "", false); err != nil {
		t.Fatal(err)
	}
	if finish(op.route.Origin, c.key.Origin, nonce).Code != 403 {
		t.Fatal("revoked handoff revived access")
	}
}

func TestRepeatedOpenReusesDeviceRouteAndCancelDoesNotCloseExistingAccess(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	c.mu.Lock()
	c.state.Gateways = []GatewayRecord{{ID: "source"}}
	c.state.Routes = []Route{{ID: "route", SourceID: "source", Origin: "https://env.example.test"}}
	device := c.sessions[digest(login.Token)]
	c.mu.Unlock()
	a := newWebAccess(c)
	defer a.Close()
	ctx, cancel := context.WithCancel(device.Context)
	owner := &openOperation{ID: "owner", RouteID: "route", session: login.Token, device: device.Device, route: c.state.Routes[0], Status: "ready", consumed: true, accessToken: "access", ctx: ctx, cancel: cancel, expires: time.Now().Add(time.Minute)}
	a.operations[owner.ID] = owner
	a.access[digest(owner.accessToken)] = &accessSession{operation: owner, ctx: ctx}
	opened, err := a.open(login.Token, "route", "unique-request-id")
	if err != nil || opened.Status != "ready" {
		t.Fatalf("repeated open: %+v %v", opened, err)
	}
	a.mu.Lock()
	repeated := a.operations[opened.ID]
	a.mu.Unlock()
	if repeated.accessOwner != owner {
		t.Fatal("repeated open allocated another connection")
	}
	if _, err = a.operation(login.Token, opened.ID, true); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != nil {
		t.Fatal("canceling new tab closed existing environment")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.access[digest(owner.accessToken)] == nil {
		t.Fatal("canceling new tab removed existing admission")
	}
}

func TestOperationCancelAdvancesOwnerSequenceAndCannotRestoreHandoff(t *testing.T) {
	a := newWebAccess(nil)
	ctx, cancel := context.WithCancel(context.Background())
	op := &openOperation{Sequence: 2, Status: "ready", ctx: ctx, cancel: cancel, accessToken: "token"}
	a.access[digest("token")] = &accessSession{operation: op, ctx: ctx}
	a.releaseLocked(op)
	if op.Sequence != 3 || publicOperation(op).Status != "canceled" || len(a.access) != 0 {
		t.Fatal("cancel did not publish a newer revoked state")
	}
	a.releaseLocked(op)
	if op.Sequence != 3 {
		t.Fatal("duplicate cancel advanced sequence")
	}
	cancel()
}
