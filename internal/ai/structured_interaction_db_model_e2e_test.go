package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
)

func newDBConfiguredModelE2EService(t *testing.T) (*Service, session.Meta, string) {
	t.Helper()

	if strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_DB_MODEL")) != "1" {
		t.Skip("set REDEVEN_AI_E2E_DB_MODEL=1 to enable this e2e test")
	}

	cfgPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_CONFIG_PATH")),
		defaultRedevenPath("config.json"),
	)
	secretsPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_SECRETS_PATH")),
		defaultRedevenPath("secrets.json"),
	)
	dbPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_DB_PATH")),
		defaultRedevenPath("ai", "threads.sqlite"),
	)

	modelID, err := latestThreadModelID(dbPath)
	if err != nil {
		t.Fatalf("load latest model_id from db: %v", err)
	}
	providerID, _, ok := strings.Cut(modelID, "/")
	if !ok || strings.TrimSpace(providerID) == "" {
		t.Fatalf("invalid model_id from db: %q", modelID)
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg == nil || cfg.AI == nil {
		t.Fatalf("config has no ai section: %s", cfgPath)
	}
	if !cfg.AI.IsAllowedModelID(modelID) {
		t.Fatalf("db model_id %q is not allowed by config %s", modelID, cfgPath)
	}

	secrets := settings.NewSecretsStore(secretsPath)
	if secrets == nil {
		t.Fatalf("init secrets store failed: %s", secretsPath)
	}
	key, keyOK, keyErr := secrets.GetAIProviderAPIKey(providerID)
	if keyErr != nil {
		t.Fatalf("load provider api key: %v", keyErr)
	}
	if !keyOK || strings.TrimSpace(key) == "" {
		t.Fatalf("missing api key for provider %q in %s", providerID, secretsPath)
	}

	svc, err := NewService(Options{
		Logger:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		StateDir:            t.TempDir(),
		AgentHomeDir:        t.TempDir(),
		Shell:               "bash",
		Config:              cfg.AI,
		RunMaxWallTime:      2 * time.Minute,
		RunIdleTimeout:      90 * time.Second,
		ToolApprovalTimeout: 30 * time.Second,
		ResolveProviderAPIKey: func(pid string) (string, bool, error) {
			return secrets.GetAIProviderAPIKey(pid)
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := session.Meta{
		EndpointID:        "env_e2e_structured_interaction",
		NamespacePublicID: "ns_e2e_structured_interaction",
		ChannelID:         "ch_e2e_structured_interaction",
		UserPublicID:      "u_e2e_structured_interaction",
		UserEmail:         "u_e2e_structured_interaction@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	return svc, meta, modelID
}

func TestE2E_DBConfiguredModel_GuidedStructuredInteractionProducesWaitingPrompt(t *testing.T) {
	t.Parallel()

	svc, meta, modelID := newDBConfiguredModelE2EService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "e2e-guided-structured-interaction", modelID, "plan", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := fmt.Sprintf("run_e2e_guided_structured_%d", time.Now().UnixNano())
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    modelID,
		Input: RunInput{Text: strings.Join([]string{
			"请你和我一问一答猜我的岁数，不要有直接的问题。",
			"现在先只给出第一个问题。",
		}, "")},
		Options: RunOptions{MaxSteps: 4, MaxNoToolRounds: 2, Mode: "plan"},
	}, rr)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if got := strings.TrimSpace(view.RunStatus); got != string(RunStateWaitingUser) {
		t.Fatalf("run_status=%q, want %q; body=%q", got, RunStateWaitingUser, rr.Body.String())
	}
	if view.WaitingPrompt == nil {
		t.Fatalf("waiting_prompt missing; body=%q", rr.Body.String())
	}
	if len(view.WaitingPrompt.Questions) == 0 {
		t.Fatalf("waiting_prompt questions missing: %+v", view.WaitingPrompt)
	}

	question := view.WaitingPrompt.Questions[0]
	if containsDirectAgeCue(question.Question) {
		t.Fatalf("question leaked direct age cue: %+v", question)
	}
	if len(question.Choices) < 2 {
		t.Fatalf("question choices=%d, want at least 2: %+v", len(question.Choices), question)
	}
	if got := strings.TrimSpace(question.ResponseMode); got != requestUserInputResponseModeSelectText {
		t.Fatalf("response_mode=%q, want %q", got, requestUserInputResponseModeSelectText)
	}
	if question.ChoicesExhaustive == nil || *question.ChoicesExhaustive {
		t.Fatalf("choices_exhaustive=%v, want false", question.ChoicesExhaustive)
	}
	hasSelect := false
	for _, choice := range question.Choices {
		if containsDirectAgeCue(choice.Label) {
			t.Fatalf("choice leaked direct age cue: %+v", choice)
		}
		switch strings.TrimSpace(choice.Kind) {
		case requestUserInputChoiceKindSelect:
			hasSelect = true
		}
	}
	if !hasSelect {
		t.Fatalf("expected at least one select choice: %+v", question.Choices)
	}
	if strings.TrimSpace(question.WriteLabel) == "" {
		t.Fatalf("expected write_label for custom fallback: %+v", question)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(classified["intent"])); got != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got, RunIntentTask)
	}
	routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
	if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != RunExecutionContractAgenticLoop {
		t.Fatalf("path=%q, want %q", got, RunExecutionContractAgenticLoop)
	}

	foundWaiting := false
	for _, ev := range runEvents.Events {
		if strings.TrimSpace(ev.EventType) == "ask_user.waiting" {
			foundWaiting = true
			break
		}
	}
	if !foundWaiting {
		t.Fatalf("missing ask_user.waiting event")
	}
}

var directAgeRangePattern = regexp.MustCompile(`\d+\s*[-~到]\s*\d+`)

func containsDirectAgeCue(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if directAgeRangePattern.MatchString(text) {
		return true
	}
	signals := []string{"几岁", "多少岁", "年龄", "岁数", "岁）", "岁)", "岁（", "岁("}
	for _, signal := range signals {
		if strings.Contains(text, signal) {
			return true
		}
	}
	return false
}
