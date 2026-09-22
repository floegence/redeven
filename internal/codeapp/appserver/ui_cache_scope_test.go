package appserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestUICacheScopeUsesAuthenticatedIdentity(t *testing.T) {
	request := func(user, namespace, endpoint string, read bool) (int, string) {
		t.Helper()
		server := &Server{resolveSessionMeta: resolveMetaForTest("ch_cache", session.Meta{
			UserPublicID: user, NamespacePublicID: namespace, EndpointID: endpoint, CanRead: read,
		})}
		r := httptest.NewRequest(http.MethodGet, "http://localhost/_redeven_proxy/api/ui-cache-scope?user_public_id=mallory", nil)
		r.Header.Set("Origin", envOriginWithChannel("ch_cache"))
		w := httptest.NewRecorder()
		server.handleAPI(w, r)
		if w.Code == http.StatusOK && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("scope response must not be cached by intermediaries")
		}
		var result struct {
			Data struct {
				ScopeID string `json:"scope_id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return w.Code, result.Data.ScopeID
	}
	status, first := request("alice", "team", "host", true)
	if status != http.StatusOK || len(first) != 64 {
		t.Fatalf("expected an opaque scope, got %d %q", status, first)
	}
	_, again := request("alice", "team", "host", true)
	if first != again {
		t.Fatal("reopening the same authorized identity must retain its cache scope")
	}
	for _, identity := range [][3]string{{"bob", "team", "host"}, {"alice", "other", "host"}, {"alice", "team", "other"}} {
		_, next := request(identity[0], identity[1], identity[2], true)
		if first == next {
			t.Fatal("different authorized identities must not share cached snapshots")
		}
	}
	status, denied := request("alice", "team", "host", false)
	if status != http.StatusForbidden || denied != "" {
		t.Fatal("read permission is required before revealing a scope")
	}
	for _, identity := range [][3]string{{"", "team", "host"}, {"alice", "team", ""}} {
		status, scope := request(identity[0], identity[1], identity[2], true)
		if status != http.StatusUnauthorized || scope != "" {
			t.Fatal("incomplete authenticated identities cannot share a cache scope")
		}
	}

}
