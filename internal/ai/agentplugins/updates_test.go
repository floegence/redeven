package agentplugins

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type updateTransport func(*http.Request) (*http.Response, error)

func (f updateTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestUpdateChecksOnlyResolveRefAndRespectOptOut(t *testing.T) {
	manager, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer manager.Close()
	in := install(t, manager, fixture(t))
	manager.mu.Lock()
	next := cloneState(manager.state)
	next.Installs[0].Source = Source{Type: "github", Repository: "example/plugin", Path: ".", Ref: "main", Commit: strings.Repeat("a", 40)}
	next.Installs[0].AutoCheck = true
	if e = manager.saveLocked(next); e != nil {
		t.Fatal(e)
	}
	in = next.Installs[0]
	manager.mu.Unlock()
	calls := 0
	manager.http = &http.Client{Transport: updateTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if !strings.HasSuffix(r.URL.Path, "/commits/main") {
			t.Fatal("unexpected update download", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{\"sha\":\"" + strings.Repeat("b", 40) + "\"}")), Header: http.Header{}}, nil
	})}
	manager.checkUpdate(t.Context(), in)
	current, e := manager.Get(in.ID)
	if e != nil || !current.Update.Available || current.Digest != in.Digest || calls != 1 {
		t.Fatal(current, e, calls)
	}
	off := false
	current, e = manager.Change(Change{ID: current.ID, Revision: current.Revision, AutoCheck: &off})
	if e != nil || current.AutoCheck {
		t.Fatal(current, e)
	}
	manager.checkUpdate(t.Context(), in)
	after, _ := manager.Get(in.ID)
	if after.Revision != current.Revision || after.AutoCheck {
		t.Fatal("stale result overrode opt-out")
	}
}
