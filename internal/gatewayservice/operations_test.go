package gatewayservice

import (
	"context"
	"crypto/rand"
	"github.com/floegence/redeven/internal/gatewaystate"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHostOperationRecoversExactResultAndNeverReplaysUncertainEffect(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("s", 43)
	owner, err := New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	id := rand.Text()
	body := "{\"protocol_version\":\"redeven-gateway-v6\"}"
	call := func(owner *Server, route, id, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://gateway/gateway/v6/"+route, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), hostSocketKey{}, owner))
		r.Header.Set(HostAdminHeader, token)
		r.Header.Set(OperationIDHeader, id)
		w := httptest.NewRecorder()
		owner.Handler().ServeHTTP(w, r)
		return w
	}
	issued := call(owner, "clients/access-codes", id, body)
	if issued.Code != 200 {
		t.Fatal(issued.Body.String())
	}
	recovered, err := New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"operations/query", "clients/access-codes"} {
		result := call(recovered, route, id, body)
		if result.Code != 200 || strings.TrimSpace(result.Body.String()) != strings.TrimSpace(issued.Body.String()) {
			t.Fatal("lost response was not recovered", route, result.Code)
		}
	}
	if result := call(recovered, "invitation-codes", id, body); result.Code != 409 {
		t.Fatal("operation reused for another effect")
	}
	unknown := rand.Text()
	recovered.operations.records[unknown] = hostOperation{Fingerprint: strings.Repeat("a", 64), State: "running", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	if err := gatewaystate.Write(recovered.operations.path, recovered.operations.records); err != nil {
		t.Fatal(err)
	}
	recovered, err = New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	if result := call(recovered, "operations/query", unknown, body); result.Code != 409 || !strings.Contains(result.Body.String(), "OPERATION_RESULT_UNKNOWN") {
		t.Fatal("interrupted effect reported as completed")
	}
	req := httptest.NewRequest(http.MethodPost, "https://gateway/gateway/v6/operations/query", strings.NewReader(body))
	req.Header.Set(HostAdminHeader, token)
	req.Header.Set(OperationIDHeader, id)
	response := httptest.NewRecorder()
	recovered.PublicHandler().ServeHTTP(response, req)
	if response.Code != 404 {
		t.Fatal("public receipt access")
	}
}

func TestHostOperationReturnsCompletedFailureReceipt(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("s", 43)
	owner, err := New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	call := func(route string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://gateway/gateway/v6/"+route, strings.NewReader("{\"protocol_version\":\"redeven-gateway-v6\"}"))
		r = r.WithContext(context.WithValue(r.Context(), hostSocketKey{}, owner))
		r.Header.Set(HostAdminHeader, token)
		r.Header.Set(OperationIDHeader, "invalid_target_123456")
		w := httptest.NewRecorder()
		owner.Handler().ServeHTTP(w, r)
		return w
	}
	failed := call("attachments/remove")
	if failed.Code == 200 || failed.Header().Get("X-Redeven-Operation-State") != "completed" {
		t.Fatal("missing completed failure receipt")
	}
	result := call("operations/query")
	if result.Code != failed.Code || result.Body.String() != failed.Body.String() || result.Header().Get("X-Redeven-Operation-State") != "completed" {
		t.Fatal("failed result not recoverable")
	}
}
