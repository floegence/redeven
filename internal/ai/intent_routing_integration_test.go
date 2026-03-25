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
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
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
		AgentHomeDir:        t.TempDir(),
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

	thread, err := svc.CreateThread(ctx, &meta, "social test", "", "", "")
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
	if got := strings.TrimSpace(fmt.Sprint(classified["execution_contract"])); got != RunExecutionContractDirectReply {
		t.Fatalf("execution_contract=%q, want %q", got, RunExecutionContractDirectReply)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != RunExecutionContractDirectReply {
		t.Fatalf("intent path=%q, want %q", got, RunExecutionContractDirectReply)
	}
}

func TestIntentRouting_CreativeInputUsesCreativePathWithoutTools(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "CREATIVE_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "creative test", "", "", "")
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
	if got := strings.TrimSpace(fmt.Sprint(classified["execution_contract"])); got != RunExecutionContractDirectReply {
		t.Fatalf("execution_contract=%q, want %q", got, RunExecutionContractDirectReply)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != RunExecutionContractDirectReply {
		t.Fatalf("intent path=%q, want %q", got, RunExecutionContractDirectReply)
	}
}

func TestIntentRouting_ClassifierFailureFallsBackToHybridFirstTurnWithoutDuplicateAssistantOutput(t *testing.T) {
	t.Parallel()

	reply := "我是 Flower，一个运行在你当前设备上的 AI 助手。"
	mock := &openAIMock{
		token:           reply,
		classifierToken: "not-json",
	}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "hybrid fallback", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_intent_hybrid_fallback_1"
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "你是谁"},
		Options:  RunOptions{MaxSteps: 2, MaxNoToolRounds: 1, Mode: "act"},
	}, rr)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(classified["execution_contract"])); got != RunExecutionContractHybridFirstTurn {
		t.Fatalf("execution_contract=%q, want %q", got, RunExecutionContractHybridFirstTurn)
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["intent_source"])); got != RunIntentSourceDeterministic {
		t.Fatalf("intent_source=%q, want %q", got, RunIntentSourceDeterministic)
	}
	completion := findRunEventPayload(t, runEvents.Events, "completion.contract")
	if got := strings.TrimSpace(fmt.Sprint(completion["contract"])); got != completionContractFirstTurn {
		t.Fatalf("completion contract=%q, want %q", got, completionContractFirstTurn)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, thread.ThreadID, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	assistantCount := 0
	for _, msg := range msgs {
		if strings.TrimSpace(msg.Role) != "assistant" {
			continue
		}
		assistantCount++
		if got := strings.TrimSpace(msg.TextContent); got != reply {
			t.Fatalf("assistant text=%q, want %q", got, reply)
		}
		if strings.Count(msg.TextContent, "Flower") != 1 {
			t.Fatalf("assistant text unexpectedly duplicated: %q", msg.TextContent)
		}
	}
	if assistantCount != 1 {
		t.Fatalf("assistant message count=%d, want 1", assistantCount)
	}
}

func TestIntentRouting_ContinuationWithOpenGoalStaysTask(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "TASK_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "task test", "", "", "")
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
	if got := strings.TrimSpace(fmt.Sprint(classified["execution_contract"])); got != RunExecutionContractAgenticLoop {
		t.Fatalf("execution_contract=%q, want %q", got, RunExecutionContractAgenticLoop)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != RunExecutionContractAgenticLoop {
		t.Fatalf("intent path=%q, want %q", got, RunExecutionContractAgenticLoop)
	}
}

func TestIntentRouting_GuidedStructuredInteractionUsesTaskPath(t *testing.T) {
	t.Parallel()

	mock := &openAIMock{token: "GUIDED_TASK_REPLY_OK"}
	svc, meta := newIntentRoutingService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "guided interaction test", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_intent_guided_task_1"
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。"},
		Options:  RunOptions{MaxSteps: 1, MaxNoToolRounds: 1, Mode: "plan"},
	}, rr)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), "GUIDED_TASK_REPLY_OK") {
		t.Fatalf("stream output missing guided task reply token, body=%q", rr.Body.String())
	}
	if names := mock.toolNamesSnapshot(); len(names) == 0 {
		t.Fatalf("guided structured interaction should route to task path with tools, got none")
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
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
	if got := strings.TrimSpace(fmt.Sprint(classified["reason"])); got != "guided_structured_interaction_requested" {
		t.Fatalf("reason=%q, want %q", got, "guided_structured_interaction_requested")
	}
	if got := strings.TrimSpace(fmt.Sprint(classified["execution_contract"])); got != RunExecutionContractAgenticLoop {
		t.Fatalf("execution_contract=%q, want %q", got, RunExecutionContractAgenticLoop)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != RunExecutionContractAgenticLoop {
		t.Fatalf("intent path=%q, want %q", got, RunExecutionContractAgenticLoop)
	}
}
