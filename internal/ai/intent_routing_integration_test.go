package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func newIntentRoutingService(t *testing.T, mock *openAIMock) (*Service, session.Meta) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_intent_router",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc, err := NewService(Options{
		Logger:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		StateDir:            t.TempDir(),
		FSRoot:              t.TempDir(),
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	return svc, meta
}

func findRunEventPayload(t *testing.T, events []RunEventView, eventType string) map[string]any {
	t.Helper()
	for _, ev := range events {
		if strings.TrimSpace(ev.EventType) != strings.TrimSpace(eventType) {
			continue
		}
		payload, ok := ev.Payload.(map[string]any)
		if !ok {
			t.Fatalf("event %q payload type=%T, want map[string]any", eventType, ev.Payload)
		}
		return payload
	}
	t.Fatalf("missing run event %q", eventType)
	return nil
}

func TestIntentRouting_SocialInputUsesSocialPathWithoutTools(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "SOCIAL_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "social test", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_intent_social_1"
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{MaxSteps: 1, Mode: "plan"},
	}, rr)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), "SOCIAL_REPLY_OK") {
		t.Fatalf("stream output missing social reply token, body=%q", rr.Body.String())
	}
	if !mock.didSeeResponses() {
		t.Fatalf("expected OpenAI responses call")
	}
	if names := mock.toolNamesSnapshot(); len(names) != 0 {
		t.Fatalf("social path must not send tools, got=%v", names)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(classified["intent"])); got != RunIntentSocial {
		t.Fatalf("intent=%q, want %q", got, RunIntentSocial)
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["intent_source"])); got != RunIntentSourceModel {
		t.Fatalf("intent_source=%q, want %q", got, RunIntentSourceModel)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != "social_responder" {
		t.Fatalf("intent path=%q, want social_responder", got)
	}
}

func TestIntentRouting_CreativeInputUsesCreativePathWithoutTools(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "CREATIVE_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "creative test", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_intent_creative_1"
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "请用 markdown 写一篇长篇童话故事"},
		Options:  RunOptions{MaxSteps: 1, Mode: "act"},
	}, rr)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), "CREATIVE_REPLY_OK") {
		t.Fatalf("stream output missing creative reply token, body=%q", rr.Body.String())
	}
	if names := mock.toolNamesSnapshot(); len(names) != 0 {
		t.Fatalf("creative path must not send tools, got=%v", names)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(classified["intent"])); got != RunIntentCreative {
		t.Fatalf("intent=%q, want %q", got, RunIntentCreative)
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["intent_source"])); got != RunIntentSourceModel {
		t.Fatalf("intent_source=%q, want %q", got, RunIntentSourceModel)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != "creative_responder" {
		t.Fatalf("intent path=%q, want creative_responder", got)
	}
}

func TestIntentRouting_ContinuationWithOpenGoalStaysTask(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "TASK_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "task test", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if svc.contextRepo == nil {
		t.Fatalf("context repository is not initialized")
	}
	if err := svc.contextRepo.SetOpenGoal(ctx, meta.EndpointID, thread.ThreadID, "fix startup failure"); err != nil {
		t.Fatalf("SetOpenGoal: %v", err)
	}

	secondRunID := "run_intent_task_continue_1"
	secondRR := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, secondRunID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 1, MaxNoToolRounds: 1, Mode: "plan"},
	}, secondRR)
	if err != nil {
		t.Fatalf("StartRun continuation: %v", err)
	}

	if !strings.Contains(secondRR.Body.String(), "TASK_REPLY_OK") {
		t.Fatalf("stream output missing continuation reply token, body=%q", secondRR.Body.String())
	}
	if names := mock.toolNamesSnapshot(); len(names) == 0 {
		t.Fatalf("task path should include tools, got none")
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, secondRunID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(classified["intent"])); got != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got, RunIntentTask)
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["intent_source"])); got != RunIntentSourceModel {
		t.Fatalf("intent_source=%q, want %q", got, RunIntentSourceModel)
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["objective_mode"])); got != RunObjectiveModeContinue {
		t.Fatalf("objective_mode=%q, want %q", got, RunObjectiveModeContinue)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != "task_engine" {
		t.Fatalf("intent path=%q, want task_engine", got)
	}
}
