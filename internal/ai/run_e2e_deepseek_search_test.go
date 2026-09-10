package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// Paid opt-in qualification goes through normal model selection and admission.
// Credentials and raw provider receipts never become test output.
func TestE2E_FlowerDeepSeekV4WebResearchBoundary(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E") != "1" {
		t.Skip("enable the real DeepSeek qualification")
	}
	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	if apiKey == "" {
		t.Fatal("DeepSeek credential is required")
	}
	for _, model := range []string{"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"} {
		t.Run(model, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
			defer cancel()
			recorder := &deepSeekContextRecorder{}
			proxyURL := newDeepSeekRecordingProxy(t, baseURL, recorder)
			defer func() {
				recorder.mu.Lock()
				defer recorder.mu.Unlock()
				if recorder.err != nil {
					t.Error(recorder.err)
				}
				if len(recorder.observations) < 3 {
					t.Errorf("requests=%d, want fetch, result, and restart follow-up", len(recorder.observations))
				}
				for _, observation := range recorder.observations {
					if observation.NativeSearchTools != 0 || observation.Model != model || !observation.SearchUnavailablePrompt {
						t.Errorf("wire boundary: native tools=%d model=%s unavailable prompt=%v", observation.NativeSearchTools, observation.Model, observation.SearchUnavailablePrompt)
					}
					if !slices.Contains(observation.DefinitionToolNames, "web_fetch") || slices.Contains(observation.DefinitionToolNames, "web_search") || slices.Contains(observation.DefinitionToolNames, "web_search_tool") {
						t.Errorf("unexpected tool definitions: %v", observation.DefinitionToolNames)
					}
					if strings.Contains(model, "vision") && !observation.HasImageInput {
						t.Error("Vision request lost authorized image input")
					}
				}
				t.Logf("verified %d outgoing requests: no native search, local fetch available, accurate prompt", len(recorder.observations))
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
			models, err := svc.ListModels()
			if err != nil {
				t.Fatal(err)
			}
			if len(models.Models) == 0 {
				t.Fatal("model projection is empty")
			}
			for _, entry := range models.Models {
				if entry.WebSearch.Status != "unavailable" || entry.WebSearch.Reason != "unsupported" {
					t.Fatalf("incorrect model search projection: %+v", entry.WebSearch)
				}
			}
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(ctx, meta, "Web research boundary", "deepseek/"+model, config.AIPermissionReadonly, "")
			if err != nil {
				t.Fatal(err)
			}
			request := SendUserTurnRequest{ClientRequestID: "search-qualification", ThreadID: thread.ThreadID,
				Input:   RunInput{Text: "Use web_fetch to fetch this exact public page: https://example.com/. Report its page heading and cite the URL. This is a page-fetch request, so do not search for URLs or use shell tools."},
				Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 4096, NoUserInteraction: true}}
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
				t.Fatalf("web research failed: code=%s hash=%s classes=%v", code, hash, classes)
			}
			fetches := 0
			for _, item := range detail.Current.Items {
				if item.Activity == nil {
					continue
				}
				if item.Activity.ToolName == "web_search" && item.Activity.Status == "success" {
					t.Fatal("unexpected hosted search activity")
				}
				if item.Activity.ToolName != "web_fetch" || item.Activity.Status != "success" || item.Activity.Presentation == nil {
					continue
				}
				if payload, ok := item.Activity.Presentation.Payload.(fltools.WebFetchActivityPayload); ok && payload.StatusCode == 200 && payload.FinalURL == "https://example.com/" && strings.Contains(payload.ContentPreview, "Example Domain") {
					fetches++
				}
			}
			if fetches == 0 {
				t.Fatal("no canonical successful fetch with verified public page content")
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			// Restart and replay use the same canonical provider receipts.
			sendDeepSeekCompactionTurn(t, ctx, svc, meta, "search-follow-up", thread.ThreadID, "deepseek/"+model, "From the page already fetched, repeat only its heading. Do not call tools again.")
			t.Logf("canonical verified page fetches=%d; restart and follow-up passed; native search correctly unavailable", fetches)
		})
	}
}
