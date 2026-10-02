package localui

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/session"
)

func TestWindowArtifactBindsOnlyItsResource(t *testing.T) {
	s := newTestServer(t, nil)
	request := httptest.NewRequest("POST", "https://localhost:23998/pf/owned/_redeven_window/connect", strings.NewReader(`{}`))
	request.TLS = &tls.ConnectionState{}
	meta := session.Meta{EndpointID: "env_local", FloeApp: agent.FloeAppRedevenPortForward, CodeSpaceID: "owned", UserPublicID: localUserPublicID, CanRead: true, CanWrite: true, CanExecute: true}
	w := httptest.NewRecorder()
	s.handleConnectArtifactWithMeta(w, request, &meta)
	if w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body.String())
	}
	var envelope connectArtifactEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if _, err := flowersec.ParseArtifact(envelope.ConnectArtifact); err != nil {
		t.Fatal(err)
	}
	if envelope.PluginSessionCredential != "" {
		t.Fatal("window received a management credential")
	}
	var target map[string]any
	if err := json.Unmarshal(envelope.SpendScope.TargetBinding, &target); err != nil {
		t.Fatal(err)
	}
	if target["forward_id"] != "owned" || target["kind"] != "window" || target["floe_app"] != meta.FloeApp {
		t.Fatal("incorrect spend resource")
	}
	var keys map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &keys); err != nil || len(keys) != 4 {
		t.Fatal("window response must match the exact published acquisition contract")
	}
	var pending pendingDirect
	for _, value := range s.pending {
		pending = value
	}
	if pending.meta.FloeApp != meta.FloeApp || pending.meta.CodeSpaceID != "owned" || pending.meta.CanAdmin {
		t.Fatal("issuer widened resource authority")
	}
	if !strings.Contains(envelope.CriticalScopeProjectionJSON, `"maxWsFrameBytes":33554432`) || strings.Contains(envelope.CriticalScopeProjectionJSON, "service_worker") {
		t.Fatal("incorrect graphical stream scope")
	}
}

func TestWindowAcquisitionRejectsUnownedForwardAndClientScope(t *testing.T) {
	s := newTestServer(t, nil)
	for _, endpoint := range []string{"connect", "spend"} {
		r := httptest.NewRequest("POST", "https://localhost:23998/pf/other/_redeven_window/"+endpoint, nil)
		r.TLS = &tls.ConnectionState{}
		w := httptest.NewRecorder()
		s.handleWindowTransport(w, r, "other", "/pf/other")
		if w.Code != http.StatusForbidden {
			t.Fatalf("unknown window %s = %d", endpoint, w.Code)
		}
	}
	r := httptest.NewRequest("POST", "https://localhost:23998/api/local/direct/connect_artifact", strings.NewReader(`{"forward_id":"other"}`))
	r.TLS = &tls.ConnectionState{}
	w := httptest.NewRecorder()
	s.handleConnectArtifact(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatal("client overrode issuer scope")
	}
}
