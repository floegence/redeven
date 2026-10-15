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

func TestServerFlowerSubagentInputValidatesPermissionAndStrictBody(t *testing.T) {
	for _, test := range []struct {
		name, body, query string
		full              bool
		status            int
	}{
		{"permission", `{}`, "", false, http.StatusForbidden},
		{"unknown field", `{"action":"steer_queue","interrupt":true}`, "", true, http.StatusBadRequest},
		{"trailing body", `{} {}`, "", true, http.StatusBadRequest},
		{"query", `{}`, "?force=true", true, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessReady}}
			server, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanWrite: test.full, CanExecute: test.full})
			response := serveAIReadinessTestRequest(server, origin, http.MethodPost, "/_redeven_proxy/api/ai/threads/parent/subagents/child/input"+test.query, []byte(test.body))
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
