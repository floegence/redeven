package appserver

import (
	"encoding/json"
	"fmt"
	"github.com/floegence/redeven/internal/session"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
)

func TestAIThreadActionHTTPStatusMapsStopOutcome(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "stale precise stop", err: flruntime.ErrRequestConflict, want: http.StatusConflict},
		{name: "continuation retry unavailable", err: fmt.Errorf("%w: latest turn is not retryable", ai.ErrThreadContinuationRetryUnavailable), want: http.StatusConflict},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := aiThreadActionHTTPStatus(tc.err); got != tc.want {
				t.Fatalf("aiThreadActionHTTPStatus(%v)=%d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

func TestAIUserTurnErrorKeepsWorkspaceRecoveryCodeAndHidesPrivatePath(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAIUserTurnError(recorder, fmt.Errorf("model context unavailable: %w: /private/source", ai.ErrPluginWorkspaceUnavailable))
	var body apiResp
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusConflict || body.ErrorCode != "PLUGIN_WORKSPACE_UNAVAILABLE" || body.Error != ai.ErrPluginWorkspaceUnavailable.Error() {
		t.Fatalf("unexpected recovery response: %d %+v", recorder.Code, body)
	}
}

func TestAIStopHTTPPreservesExactTargetAndRequestIdentity(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
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
	meta := session.Meta{ChannelID: "ch_ai_readiness", EndpointID: "env_precise_stop", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), meta)
	thread, err := svc.CreateThread(t.Context(), &meta, "Stop", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "first", Input: ai.RunInput{Text: "work"}})
	if err != nil {
		t.Fatal(err)
	}
	stop := ai.StopThreadRequest{ExpectedTurnID: first.TurnID, ExpectedRunID: first.RunID, ClientRequestID: "http-stop"}
	path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/cancel"
	request := func(input ai.StopThreadRequest) int {
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return performServerRequest(server, http.MethodPost, path, origin, string(body)).Code
	}
	wrong := stop
	wrong.ExpectedRunID = "run-stale"
	if code := request(wrong); code != http.StatusConflict {
		t.Fatalf("stale HTTP status=%d", code)
	}
	if code := request(stop); code != http.StatusOK {
		t.Fatalf("exact HTTP status=%d", code)
	}
	deadline := time.Now().Add(8 * time.Second)
	for {
		detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Current.Activity == flruntime.ThreadActivityIdle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("stop did not settle")
		}
		time.Sleep(5 * time.Millisecond)
	}
	next, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "next", Input: ai.RunInput{Text: "more"}})
	if err != nil {
		t.Fatal(err)
	}
	if code := request(stop); code != http.StatusOK {
		t.Fatalf("replay HTTP status=%d", code)
	}
	detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Current.RunID.String() != next.RunID || detail.Current.Cancellation != nil || detail.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("replay stopped replacement: %+v", detail.Current)
	}
	partial := ai.StopThreadRequest{ExpectedRunID: next.RunID}
	if code := request(partial); code != http.StatusBadRequest {
		t.Fatalf("partial target HTTP status=%d", code)
	}
}
