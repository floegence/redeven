package gatewaycloud

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/floegence/redeven/internal/gatewaystate"
)

func TestRetiredClosureRelayHasNoRoute(t *testing.T) {
	g := &Gateway{}
	for _, path := range []string{"/v5/member/cloud-closure", "/v6/member/cloud-closure"} {
		response := httptest.NewRecorder()
		g.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatal("retired closure relay still exists")
		}
	}
}
func TestOldGatewayCloudStateIsRejectedReadOnly(t *testing.T) {
	path := GatewayConfigPath(t.TempDir())
	if err := gatewaystate.Write(path, GatewayConfig{SchemaVersion: 2}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	var state GatewayConfig
	if err := readGatewayConfig(path, &state); err == nil {
		t.Fatal("old Gateway Cloud state was accepted")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("old Gateway Cloud state was rewritten")
	}
}
