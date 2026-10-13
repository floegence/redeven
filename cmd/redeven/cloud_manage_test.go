package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloudManagementPageDoesNotExposeOwnerCapability(t *testing.T) {
	const origin = "http://127.0.0.1:12345"
	const token = "secret-owner-capability"
	handler := cloudManagementHandler("missing", origin, token)
	request := httptest.NewRequest(http.MethodGet, origin+"/", nil)
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, request)
	if record.Code != 200 || strings.Contains(record.Body.String(), token) || strings.Contains(record.Header().Get("Content-Security-Policy"), token) {
		t.Fatal("management shell exposed owner capability")
	}
	for _, test := range []struct {
		method, path, authority, auth, requestOrigin string
		status                                       int
	}{
		{"GET", "/v2/cloud-link", origin, "", "", 401},
		{"GET", "/v2/cloud-link", "http://evil.example", token, "", 421},
		{"POST", "/v2/cloud/retry", origin, token, "https://evil.example", 403},
		{"POST", "/v2/cloud/retry", origin, token, "", 403},
		{"POST", "/v2/runtime/security", origin, token, origin, 404},
		{"POST", "/v2/gateway/leave", origin, token, origin, 404},
		{"GET", "/v2/cloud/route/operations/../../runtime/access", origin, token, "", 404},
	} {
		req := httptest.NewRequest(test.method, test.authority+test.path, strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+test.auth)
		if test.requestOrigin != "" {
			req.Header.Set("Origin", test.requestOrigin)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != test.status {
			t.Fatalf("%s %s: %d", test.method, test.path, rec.Code)
		}
	}
}

func TestCloudManagementUsesOriginalOperationOverOwnerSocket(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "rdv-cloud-ui-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "owner.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	const id = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/cloud/route/operations/"+id || r.Method != http.MethodDelete || r.Header.Get("Origin") != "" {
			t.Error("proxy changed operation or leaked browser authority")
		}
		if r.Header.Get("X-Redeven-Runtime-Control-Protocol") != "redeven-runtime-control-v2" {
			t.Error("missing owner protocol")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"operation_id": id, "state": "committed"}})
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	handler := cloudManagementHandler(socket, "http://127.0.0.1:12345", "secret")
	req := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:12345/v2/cloud/route/operations/"+id, nil)
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("Origin", "http://127.0.0.1:12345")
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, req)
	raw, _ := io.ReadAll(record.Result().Body)
	if record.Code != 200 || !strings.Contains(string(raw), `"state":"committed"`) {
		t.Fatalf("committed cancellation not preserved: %d %s", record.Code, raw)
	}
}
