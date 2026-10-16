package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

func TestE2E_FlowerDeepSeekContextCompaction(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_COMPACTION_E2E") != "1" {
		t.Skip("run scripts/check_flower_context_deepseek.sh --compaction")
	}
	sourceRoot := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	source, err := config.Load(filepath.Join(sourceRoot, "config.json"))
	if err != nil {
		t.Fatal("production configuration parser could not load the source profile")
	}
	if source.AI == nil {
		t.Fatal("source AI configuration is missing")
	}
	var selected config.AIProvider
	var model config.AIProviderModel
	for _, provider := range source.AI.Providers {
		if provider.Type != "deepseek" {
			continue
		}
		for _, candidate := range provider.EffectiveModels() {
			if candidate.ModelName == "deepseek-flash" {
				selected, model = provider, candidate
			}
		}
	}
	if selected.ID == "" || model.ContextWindow == 0 || model.MaxOutputTokens == 0 {
		t.Fatal("configured deepseek-flash model and explicit effective budgets are required")
	}
	assertOfficialDeepSeekCompactionEndpoint(t, selected.BaseURL)
	key, found, err := settings.NewSecretsStore(filepath.Join(sourceRoot, "secrets.json")).GetAIProviderAPIKey(selected.ID)
	if err != nil || !found || key == "" {
		t.Fatal("configured DeepSeek credential is unavailable")
	}
	reportRoot := os.Getenv("REDEVEN_FLOWER_COMPACTION_REPORT_DIR")
	if reportRoot == "" {
		t.Fatal("a persistent isolated qualification report directory is required")
	}
	t.Logf("configured wire_model=%s effective_window=%d output_budget=%d", model.EffectiveWireModelName(), model.EffectiveInputWindowTokens(), model.MaxOutputTokens)
	for _, scenario := range []string{"small_history", "manual", "automatic", "automatic_configured_window"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 45*time.Minute)
			defer cancel()
			directory := filepath.Join(reportRoot, scenario)
			if err := os.MkdirAll(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(directory, "home"), 0700); err != nil {
				t.Fatal(err)
			}
			marker := "COMPACTION_FACT_9C47_" + scenario
			recorder := &deepSeekContextRecorder{markers: []string{marker, "7319"}}
			provider := selected
			effective := model
			if scenario == "automatic" {
				effective.ContextWindow, effective.MaxOutputTokens, effective.EffectiveContextWindowPercent = 256_000, 28_000, 100
			}
			provider.BaseURL = newDeepSeekRecordingProxy(t, selected.BaseURL, recorder)
			provider.ModelSelection = nil
			provider.Models = []config.AIProviderModel{effective}
			modelID := provider.ID + "/" + effective.ModelName
			cfg := &config.AIConfig{CurrentModelID: modelID, PermissionType: source.AI.PermissionType, Providers: []config.AIProvider{provider}}
			if err := cfg.Validate(); err != nil {
				t.Fatal(err)
			}
			opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(directory, "state"), AgentHomeDir: filepath.Join(directory, "home"), Shell: "/bin/sh", Config: cfg,
				ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Minute, FirstOutputTimeout: 5 * time.Minute, IdleTimeout: 5 * time.Minute},
				ResolveProviderAPIKey:        func(id string) (string, bool, error) { return key, id == selected.ID, nil },
			}
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := &session.Meta{EndpointID: "env_compaction_qualification", ChannelID: "channel_compaction", NamespacePublicID: "namespace_compaction", UserPublicID: "user_compaction", UserEmail: "compaction@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			threadID := createDeepSeekCompactionThread(t, ctx, svc, meta, modelID, "Compaction qualification")
			report := map[string]any{"scenario": scenario, "model": effective.EffectiveWireModelName(), "window": effective.EffectiveInputWindowTokens(), "output_budget": effective.MaxOutputTokens, "thread_id": threadID}
			defer func() {
				report["passed"] = !t.Failed()
				report["requests"] = recorder.snapshot()
				saveCompactionQualificationJSON(t, filepath.Join(directory, "report.json"), report)
			}()
			// The unique facts occur only after the old 1,200-byte preview boundary.
			// Later filler and recall questions never repeat the answers.
			seed := "For this synthetic ongoing project, the following notes are disposable.\n" + strings.Repeat("Historical setup note without durable facts.\n", 100) + "\nDurable facts: preserve the exact marker " + marker + " and rollout port 7319. These facts remain relevant. Reply exactly ACK without repeating facts or calling tools."
			detail := sendDeepSeekQualificationInput(t, ctx, svc, meta, threadID, "earliest-fact", RunInput{Text: seed})
			earliest := lastDeepSeekMain(t, recorder)
			if earliest.MarkerMessageIndexes[0] < 0 {
				t.Fatal("earliest fact did not enter the provider request")
			}
			originalFactHash := earliest.MessageHashes[earliest.MarkerMessageIndexes[0]]
			if scenario == "small_history" {
				before := len(recorder.snapshot())
				detail = compactQualificationThread(t, ctx, svc, meta, threadID, "small-compact")
				if len(recorder.snapshot()) != before {
					t.Fatal("noop called a summary or ordinary provider")
				}
				if len(detail.Thread.ContextCompactions) != 1 || detail.Thread.ContextCompactions[0].Status != "noop" || detail.Thread.ContextCompactions[0].Reason != "context_too_small" {
					t.Fatal("small context must report an explicit noop")
				}
				report["compactions"] = detail.Thread.ContextCompactions
				saveCompactionQualificationJSON(t, filepath.Join(directory, "canonical.json"), detail)
				return
			}
			automatic := strings.HasPrefix(scenario, "automatic")
			// Every filler enters through production Send with bounded text/reference
			// snapshots. Later inputs and questions never contain the answers.
			maxRounds := 32
			if !automatic {
				maxRounds = 3
			}
			before := earliest
			for round := 0; round < maxRounds; round++ {
				previous := lastDeepSeekMain(t, recorder)
				detail = sendDeepSeekQualificationInput(t, ctx, svc, meta, threadID, fmt.Sprintf("pressure-%02d", round), deepSeekQualificationBallast(round))
				usage := requireDeepSeekQualificationUsage(t, detail, effective.EffectiveInputWindowTokens())
				t.Logf("scenario=%s round=%d native_input=%d threshold=%d compactions=%d", scenario, round+1, usage.InputTokens, usage.ThresholdTokens, len(detail.Thread.ContextCompactions))
				if len(detail.Thread.ContextCompactions) > 0 {
					before = previous
					break
				}
				if !automatic && usage.InputTokens > 100_000 {
					break
				}
			}
			if !automatic {
				before = lastDeepSeekMain(t, recorder)
				if len(detail.Thread.ContextCompactions) != 0 {
					t.Fatal("manual seed reached automatic pressure")
				}
				usage := requireDeepSeekQualificationUsage(t, detail, effective.EffectiveInputWindowTokens())
				if usage.InputTokens >= usage.ThresholdTokens {
					t.Fatal("manual acceptance must stay below the automatic threshold")
				}
				requestCount, itemCount := len(recorder.snapshot()), len(detail.Current.Items)
				detail = compactQualificationThread(t, ctx, svc, meta, threadID, "manual-compact")
				if len(detail.Current.Items) != itemCount || detail.Current.TurnKind != flruntime.TurnKindContextCompaction {
					t.Fatal("manual compaction added conversation items or lost its type")
				}
				for _, request := range recorder.snapshot()[requestCount:] {
					if request.Kind != "summary" {
						t.Fatal("manual compaction made an ordinary provider request")
					}
				}
				if detail.Thread.ContextUsage == nil || detail.Thread.ContextUsage.Confirmed != nil || detail.Thread.ContextUsage.Estimate == nil {
					t.Fatal("installation retained obsolete confirmed usage")
				}
			}
			if len(detail.Thread.ContextCompactions) != 1 {
				t.Fatalf("pressure bound did not install exactly one compaction: count=%d", len(detail.Thread.ContextCompactions))
			}
			compaction := detail.Thread.ContextCompactions[0]
			if compaction.Status != "compacted" {
				t.Fatalf("compaction did not install: status=%s reason=%s", compaction.Status, compaction.Reason)
			}
			assertDeepSeekCompactionSavings(t, compaction)
			if automatic && compaction.Source != "engine" {
				t.Fatal("automatic compaction has wrong execution owner")
			}
			installed := recorder.snapshot()
			summarySeen := false
			for _, request := range installed {
				if len(request.ResponseToolNames) != 0 {
					t.Fatal("qualification unexpectedly dispatched a tool")
				}
				if request.Kind == "summary" {
					if !request.MarkerPresence[0] || !request.MarkerPresence[1] {
						t.Fatal("summary input omitted facts beyond the old preview boundary")
					}
					summarySeen = true
					if request.InputTokens <= 0 || request.OutputTokens <= 0 || !request.ResponseMarkerPresence[0] || !request.ResponseMarkerPresence[1] {
						t.Fatal("summary response lacks facts or native usage")
					}
				}
			}
			if !summarySeen {
				t.Fatal("no real summary provider request was recorded")
			}
			saveCompactionQualificationJSON(t, filepath.Join(directory, "installed-canonical.json"), detail)
			detail = sendDeepSeekQualificationInput(t, ctx, svc, meta, threadID, "independent-recall", RunInput{Text: "What exact durable marker and rollout port did we agree for the ongoing project? Reply with both exact values only. Do not call tools."})
			assertOllamaContextRecall(t, detail, marker)
			after := lastDeepSeekMain(t, recorder)
			if after.InputTokens <= 0 || after.InputTokens >= before.InputTokens {
				t.Fatalf("native input did not decrease: %d -> %d", before.InputTokens, after.InputTokens)
			}
			if after.MarkerMessageIndexes[0] < 0 || after.MessageHashes[after.MarkerMessageIndexes[0]] == originalFactHash {
				t.Fatal("original fact message remains in retained tail or fact disappeared")
			}
			if after.HasPreviousResponseID {
				t.Fatal("compaction reused obsolete provider continuation")
			}
			report["before_input_tokens"], report["after_input_tokens"] = before.InputTokens, after.InputTokens
			report["compactions"] = detail.Thread.ContextCompactions
			if !automatic {
				count := len(recorder.snapshot())
				compactQualificationThread(t, ctx, svc, meta, threadID, "manual-compact")
				if len(recorder.snapshot()) != count {
					t.Fatal("same-key replay called provider")
				}
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
				svc, err = NewService(opts)
				if err != nil {
					t.Fatal(err)
				}
				compactQualificationThread(t, ctx, svc, meta, threadID, "manual-compact")
				if len(recorder.snapshot()) != count {
					t.Fatal("installed restart replay called provider")
				}
				for round := 0; round < 2; round++ {
					detail = sendDeepSeekQualificationInput(t, ctx, svc, meta, threadID, fmt.Sprintf("new-history-%d", round), deepSeekQualificationBallast(round+50))
				}
				detail = compactQualificationThread(t, ctx, svc, meta, threadID, "manual-compact-again")
				if len(detail.Thread.ContextCompactions) != 2 || detail.Thread.ContextCompactions[1].Status != "compacted" {
					t.Fatal("new-history compaction did not replace the previous summary")
				}
				detail = sendDeepSeekQualificationInput(t, ctx, svc, meta, threadID, "second-recall", RunInput{Text: "Repeat the exact durable marker and rollout port for the ongoing project. Reply with both values only. Do not call tools."})
				assertOllamaContextRecall(t, detail, marker)
			}
			assertQualificationContextAttribution(t, detail)
			saveCompactionQualificationJSON(t, filepath.Join(directory, "canonical.json"), detail)
		})
	}
}

func sendDeepSeekQualificationInput(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID, key string, input RunInput) *FlowerThreadDetail {
	t.Helper()
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{StorageGeneration: svc.storageGeneration, ThreadID: threadID, ClientRequestID: key, Input: input, Options: RunOptions{NoUserInteraction: true}})
	if err != nil {
		t.Fatal(err)
	}
	return waitForDeepSeekAskUserDetail(t, ctx, svc, meta, threadID, func(detail *FlowerThreadDetail) bool {
		if detail.Current.TurnID != response.Current.TurnID || detail.Current.Activity != flruntime.ThreadActivityIdle || detail.Current.LastOutcome == nil {
			return false
		}
		if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
			code, hash, classes := safeDeepSeekFailureFingerprint(detail.Current.Failure)
			t.Fatalf("qualification failed code=%s hash=%s classes=%v", code, hash, classes)
		}
		return true
	})
}

func deepSeekQualificationBallast(round int) RunInput {
	const line = "Disposable synthetic context alpha beta gamma delta. "
	action := &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: contextActionAskFlowerID, Provider: contextActionFlowerProvider,
		Target: ContextActionTarget{TargetID: "env_compaction_qualification", Locality: contextActionLocalityCurrent}, Source: ContextActionSource{Surface: contextActionSurfaceGit}, Presentation: ContextActionPresentation{Label: "Synthetic pressure"},
	}
	for index := 0; index < 18; index++ {
		text := fmt.Sprintf("Synthetic record %d/%d. ", round, index) + strings.Repeat(line, 160)
		action.Context = append(action.Context, ContextActionContextItem{Kind: contextActionKindText, Title: fmt.Sprintf("Synthetic record %d", index), Content: text})
	}
	return RunInput{Text: strings.Repeat(line, 800) + "\nThis filler is disposable. Reply exactly ACK without repeating it or calling tools.", ContextAction: action}
}

func requireDeepSeekQualificationUsage(t *testing.T, detail *FlowerThreadDetail, window int) FlowerContextSample {
	t.Helper()
	if detail.Thread.ContextUsage == nil || detail.Thread.ContextUsage.Confirmed == nil {
		t.Fatal("real provider did not report canonical native usage")
	}
	usage := *detail.Thread.ContextUsage.Confirmed
	if usage.InputTokens <= 0 || usage.ContextWindowTokens != int64(window) || usage.OutputHeadroomTokens <= 0 || usage.OutputControl != "client" || usage.RequestOutputTokens <= 0 || usage.SafetyMarginTokens != min(int64(window)/100, 4096) {
		t.Fatal("native usage has no input or configured budget")
	}
	return usage
}

func lastDeepSeekMain(t *testing.T, recorder *deepSeekContextRecorder) deepSeekContextObservation {
	t.Helper()
	records := recorder.snapshot()
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].Kind == "main" {
			if records[i].InputTokens <= 0 {
				t.Fatal("main request lacks native usage")
			}
			return records[i]
		}
	}
	t.Fatal("no main provider request recorded")
	return deepSeekContextObservation{}
}

func saveCompactionQualificationJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Error(err)
		return
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Error(err)
	}
}

// Validate category provenance independently of native totals. The fixture's
// collector always supplies these non-secret managed sections.
func assertQualificationContextAttribution(t *testing.T, detail *FlowerThreadDetail) {
	t.Helper()
	usage := detail.Thread.ContextUsage
	if usage == nil || usage.Confirmed == nil || usage.Confirmed.Breakdown == nil {
		t.Fatal("confirmed distribution unavailable")
	}
	b := usage.Confirmed.Breakdown
	if (b.Quality != "token_estimate" && b.Quality != "relative_weight") || b.Tokenizer != "deepseek_v4" || b.Details == nil {
		t.Fatalf("unexpected distribution quality: %+v", b)
	}
	keys := map[string]bool{}
	for _, item := range b.Details.Items {
		if item.Category == "model_context" && item.Tokens > 0 {
			keys[item.Key] = true
		}
	}
	for _, key := range []string{"skills", "repository_rules", "execution_environment", "local_time"} {
		if !keys[key] {
			t.Errorf("missing canonical context source %s", key)
		}
	}
}

// Read completed qualification state through the public service after an oracle
// correction. This does not dispatch, retry or replace any recorded model call.
func TestRecordedDeepSeekContextAttribution(t *testing.T) {
	root := os.Getenv("REDEVEN_FLOWER_RECORDED_CONTEXT_REPORT_DIR")
	if root == "" {
		t.Skip("set a completed synthetic qualification report directory")
	}
	provider, model, key := loadPromptQualificationProfile(t)
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	provider.BaseURL = "https://example.invalid/v1"
	for _, scenario := range []string{"small_history", "manual", "automatic", "automatic_configured_window"} {
		t.Run(scenario, func(t *testing.T) {
			directory := filepath.Join(root, scenario)
			raw, err := os.ReadFile(filepath.Join(directory, "report.json"))
			if err != nil {
				t.Fatal(err)
			}
			var report struct {
				ThreadID string `json:"thread_id"`
				Before   int64  `json:"before_input_tokens"`
				After    int64  `json:"after_input_tokens"`
			}
			if err = json.Unmarshal(raw, &report); err != nil {
				t.Fatal(err)
			}
			state := filepath.Join(t.TempDir(), "state")
			if err = os.CopyFS(state, os.DirFS(filepath.Join(directory, "state"))); err != nil {
				t.Fatal(err)
			}
			svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: filepath.Join(directory, "home"), Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: provider.ID + "/" + model.ModelName, Providers: []config.AIProvider{provider}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }})
			if err != nil {
				t.Fatal(err)
			}
			defer svc.Close()
			meta := &session.Meta{EndpointID: "env_compaction_qualification", ChannelID: "channel_compaction", NamespacePublicID: "namespace_compaction", UserPublicID: "user_compaction", UserEmail: "compaction@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, report.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if detail.Current.Activity != flruntime.ThreadActivityIdle || detail.Current.LastOutcome == nil || *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatal("recorded turn did not complete")
			}
			assertQualificationContextAttribution(t, detail)
			if scenario != "small_history" {
				if report.After <= 0 || report.After >= report.Before {
					t.Fatal("native input did not decrease")
				}
				assertOllamaContextRecall(t, detail, "COMPACTION_FACT_9C47_"+scenario)
			}
			t.Logf("recorded scenario=%s quality=%s native_before=%d native_after=%d sources=verified", scenario, detail.Thread.ContextUsage.Confirmed.Breakdown.Quality, report.Before, report.After)
		})
	}
}
