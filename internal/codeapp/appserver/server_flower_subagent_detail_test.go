package appserver

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
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

func TestServerFlowerParentEventsRejectsUnauthorizedAndNonStrictRequests(t *testing.T) {
	for _, test := range []struct {
		name, body, query string
		read              bool
		status            int
	}{
		{"permission", `{}`, "", false, http.StatusForbidden},
		{"route injection", `{"action":"read","event_id":"event","parent_thread_id":"other"}`, "", true, http.StatusBadRequest},
		{"trailing body", `{} {}`, "", true, http.StatusBadRequest},
		{"null", `null`, "", true, http.StatusBadRequest},
		{"query", `{"action":"list"}`, "?force=true", true, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessReady}}
			server, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: test.read})
			response := serveAIReadinessTestRequest(server, origin, http.MethodPost, "/_redeven_proxy/api/ai/threads/parent/subagent-events"+test.query, []byte(test.body))
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestFlowerParentEventReadErrorPreservesSourceAndAuthorization(t *testing.T) {
	for _, test := range []struct {
		leaf string
		err  error
		code string
	}{
		{"old-path", fmt.Errorf("source: %w", flruntime.ErrJournalInvariant), "history_source_changed"},
		{"", flruntime.ErrJournalInvariant, ""},
		{"old-path", errors.New("permission denied"), ""},
		{"old-path", errors.New("transport closed"), ""},
	} {
		if got := flowerParentEventReadErrorCode(test.leaf, test.err); got != test.code {
			t.Fatalf("leaf=%q error=%v code=%q want=%q", test.leaf, test.err, got, test.code)
		}
	}
}
