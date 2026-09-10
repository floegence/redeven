package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// Paid opt-in qualification goes through normal model selection and admission.
// Credentials and raw provider receipts never become test output.
func TestE2E_FlowerDeepSeekV4NativeSearch(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E") != "1" {
		t.Skip("enable the real DeepSeek qualification")
	}
	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	if apiKey == "" {
		t.Fatal("DeepSeek credential is required")
	}
	for _, model := range []string{"deepseek-v4-flash", "deepseek-v4-flash-vision-exp"} {
		t.Run(model, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
			defer cancel()
			recorder := &deepSeekContextRecorder{}
			proxyURL := newDeepSeekRecordingProxy(t, baseURL, recorder)
			defer func() {
				recorder.mu.Lock()
				defer recorder.mu.Unlock()
				for _, observation := range recorder.observations {
					if observation.NativeSearchTools != 1 || observation.Model != model {
						t.Errorf("wire search count=%d model=%s", observation.NativeSearchTools, observation.Model)
					}
				}
				t.Logf("verified %d outgoing Turn requests with native search", len(recorder.observations))
			}()
			stateDir := t.TempDir()
			opts := Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
				Config:         &config.AIConfig{CurrentModelID: "deepseek/" + model, Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: proxyURL, Models: config.AIProviderCatalog("deepseek")}}},
				RunMaxWallTime: 2 * time.Minute, RunIdleTimeout: time.Minute,
				ResolveProviderAPIKey: func(string) (string, bool, error) { return apiKey, true, nil },
			}
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(ctx, meta, "Native search qualification", "deepseek/"+model, config.AIPermissionReadonly, "")
			if err != nil {
				t.Fatal(err)
			}
			request := SendUserTurnRequest{ClientRequestID: "search-qualification", ThreadID: thread.ThreadID,
				Input:   RunInput{Text: "Use your web_search tool to look up the latest Go release on go.dev. You must actually search the web, then give a short answer with a source citation. Do not use local tools."},
				Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}, MaxOutputTokens: 32768, NoUserInteraction: true}}
			if strings.Contains(model, "vision") {
				attachSearchTestImage(t, svc, meta, &request)
			}
			response, err := svc.SendUserTurn(ctx, meta, request)
			if err != nil {
				t.Fatal(err)
			}
			var detail *FlowerThreadDetail
			for {
				detail, err = svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				if detail.Current.TurnID == response.Current.TurnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(100 * time.Millisecond):
				}
			}
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				code, hash, classes := safeDeepSeekFailureFingerprint(detail.Current.Failure)
				t.Fatalf("search failed: code=%s hash=%s classes=%v", code, hash, classes)
			}
			searches, sources := 0, 0
			for _, item := range detail.Current.Items {
				if item.Activity == nil || item.Activity.ToolName != "web_search" || item.Activity.Status != "success" {
					continue
				}
				searches++
				if item.Activity.Presentation != nil {
					if payload, ok := item.Activity.Presentation.Payload.(fltools.WebSearchActivityPayload); ok {
						sources += len(payload.Results)
					}
				}
			}
			if searches == 0 || sources == 0 {
				t.Fatalf("canonical native searches=%d sources=%d", searches, sources)
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			// Restart and replay use the same canonical provider receipts.
			sendDeepSeekCompactionTurn(t, ctx, svc, meta, "search-follow-up", thread.ThreadID, "deepseek/"+model, "Using the preceding search result, repeat only the release version. Do not call tools or search again.")
			t.Logf("canonical native searches=%d sources=%d; restart and follow-up passed", searches, sources)
		})
	}
}
