package environmentcenter

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type applicationProbeConnection struct{}

func (applicationProbeConnection) Close() {}
func (applicationProbeConnection) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
}

func TestChildReuseCannotCrossAuthorityBoundary(t *testing.T) {
	for _, boundary := range []string{"parent", "resource", "kind", "instance", "login", "cookie-name", "revoked"} {
		t.Run(boundary, func(t *testing.T) {
			c, _, _, codes := configuredCenter(t)
			login := loginRecovery(t, c, "browser", codes[0])
			a := newWebAccess(c)
			defer a.Close()
			parent := admissionFixture(t, c, a, login.Token, "parent")
			parent.connection = applicationProbeConnection{}
			owner := admissionFixture(t, c, a, login.Token, "child")
			owner.parent, owner.appKind, owner.appID = parent, "pf", "service-one"
			owner.runtimeCookie = http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"}
			switch boundary {
			case "parent":
				owner.parent = &openOperation{}
			case "resource":
				owner.appID = "service-two"
			case "kind":
				owner.appKind = "cs"
			case "instance":
				owner.appInstance = "previous-instance"
			case "login":
				owner.runtimeCookie.Value = "previous-runtime-login"
			case "cookie-name":
				owner.runtimeCookie.Name = "redeven_local_access_other"
			case "revoked":
				owner.cancel()
			}
			body, _ := json.Marshal(ApplicationRequest{RequestID: "exact-boundary-request", Kind: "pf", ID: "service-one", Path: "/"})
			r := httptest.NewRequest("POST", parent.route.Origin+"/__center/applications", strings.NewReader(string(body)))
			r.Header.Set("Origin", parent.route.Origin)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Redeven-Center", "1")
			r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"})
			out := httptest.NewRecorder()
			a.application(out, r, parent)
			if out.Code != 200 {
				t.Fatalf("prepare %d: %s", out.Code, out.Body.String())
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			found := false
			for _, op := range a.operations {
				if op.RequestID == "exact-boundary-request" {
					found = true
					if op.accessOwner != nil {
						t.Fatal("child reused foreign or stale authority")
					}
				}
			}
			if !found {
				t.Fatal("child handoff was not created")
			}
		})
	}
}

func TestChildReusePreservesAdmissionLimit(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	a := newWebAccess(c)
	defer a.Close()
	parent := admissionFixture(t, c, a, login.Token, "parent")
	parent.connection = applicationProbeConnection{}
	for i := range 15 {
		owner := admissionFixture(t, c, a, login.Token, fmt.Sprintf("child-%d", i))
		owner.parent, owner.appKind, owner.appID = parent, "pf", fmt.Sprintf("service-%d", i)
		owner.runtimeCookie = http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"}
	}
	for _, tc := range []struct {
		id     string
		status int
	}{{"service-0", http.StatusOK}, {"new-service", http.StatusTooManyRequests}} {
		body, _ := json.Marshal(ApplicationRequest{RequestID: "capacity-request-" + tc.id, Kind: "pf", ID: tc.id, Path: "/"})
		r := httptest.NewRequest("POST", parent.route.Origin+"/__center/applications", strings.NewReader(string(body)))
		r.Header.Set("Origin", parent.route.Origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Redeven-Center", "1")
		r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"})
		out := httptest.NewRecorder()
		a.application(out, r, parent)
		if out.Code != tc.status {
			t.Fatalf("%s: got %d, want %d: %s", tc.id, out.Code, tc.status, out.Body.String())
		}
	}
}

func TestRepeatedChildOpenReusesExactAdmission(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	a := newWebAccess(c)
	defer a.Close()
	parent := admissionFixture(t, c, a, login.Token, "parent")
	parent.connection = applicationProbeConnection{}
	var accessToken string
	for i := range 20 {
		// Exercise pruning of handoff receipts without pruning live authority.
		if i == 10 {
			a.mu.Lock()
			for _, op := range a.operations {
				if op.parent != nil {
					op.expires = time.Now().Add(-time.Second)
				}
			}
			a.mu.Unlock()
		}
		body, _ := json.Marshal(ApplicationRequest{RequestID: fmt.Sprintf("child-open-request-%03d", i), Kind: "pf", ID: "service-one", Path: fmt.Sprintf("/page/%d", i)})
		r := httptest.NewRequest("POST", parent.route.Origin+"/__center/applications", strings.NewReader(string(body)))
		r.Header.Set("Origin", parent.route.Origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Redeven-Center", "1")
		r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"})
		prepared := httptest.NewRecorder()
		a.application(prepared, r, parent)
		if prepared.Code != 200 {
			t.Fatalf("reopening same child %d exhausted admission: %d %s", i+1, prepared.Code, prepared.Body.String())
		}
		var result struct{ Data ApplicationResult }
		if err := json.Unmarshal(prepared.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		destination, err := url.Parse(result.Data.Destination)
		if err != nil {
			t.Fatal(err)
		}
		start := httptest.NewRecorder()
		a.start(start, httptest.NewRequest("GET", destination.String(), nil))
		if start.Code != 303 {
			t.Fatal(start.Body.String())
		}
		nonce := start.Result().Cookies()[0]
		a.mu.Lock()
		op := a.operations[destination.Query().Get("operation")]
		op.codeHash = digest("test-code")
		form := url.Values{"operation": {op.ID}, "challenge": {op.challenge}, "code": {"test-code"}}
		a.mu.Unlock()
		finish := httptest.NewRequest("POST", result.Data.Origin+"/__center/finish", strings.NewReader(form.Encode()))
		finish.Header.Set("Origin", result.Data.Origin)
		finish.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		finish.AddCookie(nonce)
		completed := httptest.NewRecorder()
		a.finish(completed, finish)
		if completed.Code != 303 || completed.Header().Get("Location") != fmt.Sprintf("/page/%d", i) {
			t.Fatalf("finish %d: %s", completed.Code, completed.Body.String())
		}
		current := completed.Result().Cookies()[0].Value
		if accessToken == "" {
			accessToken = current
		}
		if current != accessToken {
			t.Fatal("repeated child changed admission cookie instead of reusing exact authority")
		}
		if i > 0 {
			if _, err := a.operation(login.Token, op.ID, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.access) != 2 || a.access[digest(accessToken)] == nil {
		t.Fatalf("expected parent and one child authority, got %d", len(a.access))
	}
}
