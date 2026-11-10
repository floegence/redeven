package appserver

import (
	"net/http"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestRetiredFlowerBackupRoutesCannotMutateRuntime(t *testing.T) {
	provider := &controlledAIServiceProvider{service: new(ai.Service), snapshot: AIReadinessSnapshot{State: AIReadinessReady}}
	server, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanAdmin: true})
	for _, path := range []string{"snapshots", "restore"} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			response := serveAIReadinessTestRequest(server, origin, method, "/_redeven_proxy/api/ai/maintenance/"+path, []byte(`{"confirmed":true,"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
			if response.Code != http.StatusNotFound {
				t.Fatalf("retired %s %s accepted: %d", method, path, response.Code)
			}
		}
	}
}
