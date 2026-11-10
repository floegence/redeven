package appserver

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestFlowerHistoricalErrorHTTPRetainsExactProviderEvidence(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":{"message":"retained provider diagnostic","type":"invalid_request_error","code":"invalid_request"}}`)
	}))
	defer provider.Close()
	cfg := appserverTestAIConfig()
	cfg.Providers[0].BaseURL = provider.URL + "/v1"
	dir := t.TempDir()
	svc, err := ai.NewService(ai.Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh", Config: cfg, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := session.Meta{ChannelID: "ch_ai_readiness", EndpointID: "env_historical_error", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), meta)
	thread, err := svc.CreateThread(t.Context(), &meta, "Historical diagnostics", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "first", Input: ai.RunInput{Text: "work"}})
	if err != nil {
		t.Fatal(err)
	}
	wait := func() {
		t.Helper()
		deadline := time.Now().Add(8 * time.Second)
		for {
			detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if detail.Current.Activity == flruntime.ThreadActivityIdle {
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("failure did not settle")
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	wait()
	if _, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "next", Input: ai.RunInput{Text: "continue"}}); err != nil {
		t.Fatal(err)
	}
	wait()
	path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/turn-error"
	body := fmt.Sprintf(`{"turn_id":%q,"run_id":%q}`, first.TurnID, first.RunID)
	response := performServerRequest(server, http.MethodPost, path, origin, body)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "retained provider diagnostic") {
		t.Fatalf("historical error unavailable: %d %s", response.Code, response.Body.String())
	}
	for _, invalid := range []string{`{}`, `{"turn_id":"turn"}`, `{"turn_id":"turn","run_id":"run","thread_id":"other"}`, body + `{}`} {
		if got := performServerRequest(server, http.MethodPost, path, origin, invalid); got.Code != http.StatusBadRequest {
			t.Fatalf("invalid read accepted: %d", got.Code)
		}
	}
}
