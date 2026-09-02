package appserver

import (
	"net/http"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestServerFlowerSubagentDetailRejectsQueryParameters(t *testing.T) {
	t.Parallel()

	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessReady}}
	server, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true})
	for _, query := range []string{"after_ordinal=4", "limit=20", "unexpected=true"} {
		query := query
		t.Run(query, func(t *testing.T) {
			response := serveAIReadinessTestRequest(
				server,
				origin,
				http.MethodGet,
				"/_redeven_proxy/api/ai/threads/parent/subagents/child/detail?"+query,
				nil,
			)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "query parameters are not supported") {
				t.Fatalf("unexpected body=%s", response.Body.String())
			}
		})
	}
}
