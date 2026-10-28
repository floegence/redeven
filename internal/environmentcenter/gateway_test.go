package environmentcenter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayClassifiesTransientAdmissionConflicts(t *testing.T) {
	for _, test := range []struct {
		code  string
		retry bool
	}{
		{"MEMBER_VERSION_CONFLICT", true},
		{"MEMBER_OFFLINE", true},
		{"MEMBER_CAPACITY", true},
		{"GATEWAY_UNAVAILABLE", true},
		{"MEMBER_DENIED", false},
		{"CLIENT_ACCESS_REVOKED", false},
		{"UNKNOWN_CONFLICT", false},
	} {
		t.Run(test.code, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": test.code}})
			}))
			defer server.Close()
			client := &gatewayClient{record: GatewayRecord{URL: server.URL}, http: server.Client()}
			err := client.request(context.Background(), "access/open", struct{}{}, nil, false)
			if err == nil || retryable(err) != test.retry {
				t.Fatalf("retry=%v, expected %v: %v", retryable(err), test.retry, err)
			}
		})
	}
}
