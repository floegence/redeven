package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

const (
	deepSeekCompactionE2EModel         = "deepseek-v4-flash"
	deepSeekCompactionE2EContextWindow = 128_000
	deepSeekManualE2EContextWindow     = 512_000
	deepSeekCompactionE2EMaxOutput     = 28_000
	deepSeekCompactionEETurnTimeout    = 4 * time.Minute
	deepSeekManualContextMarker        = "FLOWER_MANUAL_CONTEXT_MARKER"
	deepSeekAutomaticContextMarker     = "FLOWER_AUTOMATIC_CONTEXT_MARKER"
)

// TestE2E_FlowerDeepSeekV4FlashContextCompaction is an opt-in qualification
// test. It uses the production Flower service, Redeven DeepSeek gateway, and
// Floret canonical Thread runtime against the real DeepSeek V4 Flash endpoint.
// Normal CI skips it because it requires a credential and performs paid model
// requests. Run scripts/check_flower_context_deepseek.sh to execute it with
// an isolated Store while reusing the configured local DeepSeek credential.
func TestE2E_FlowerDeepSeekV4FlashContextCompaction(t *testing.T) {
	if strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E")) != "1" {
		t.Skip("set REDEVEN_FLOWER_CONTEXT_E2E=1 to enable the real DeepSeek context qualification")
	}

	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	if apiKey == "" {
		t.Fatal("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY is required")
	}
	recorder := &deepSeekContextRecorder{markers: []string{deepSeekManualContextMarker, deepSeekAutomaticContextMarker}}
	proxyURL := newDeepSeekRecordingProxy(t, baseURL, recorder)

	providerID := "deepseek-compaction-e2e"
	manualProviderID := "deepseek-manual-compaction-e2e"
	modelID := providerID + "/" + deepSeekCompactionE2EModel
	manualModelID := manualProviderID + "/" + deepSeekCompactionE2EModel
	cfg := &config.AIConfig{
		CurrentModelID: modelID,
		PermissionType: config.AIPermissionFullAccess,
		Providers: []config.AIProvider{
			{
				ID: providerID, Name: "DeepSeek automatic compaction E2E", Type: "deepseek", BaseURL: proxyURL,
				Models: []config.AIProviderModel{{
					ModelName: deepSeekCompactionE2EModel, ContextWindow: deepSeekCompactionE2EContextWindow,
					MaxOutputTokens: deepSeekCompactionE2EMaxOutput, EffectiveContextWindowPercent: 100,
				}},
			},
			{
				ID: manualProviderID, Name: "DeepSeek manual compaction E2E", Type: "deepseek", BaseURL: proxyURL,
				Models: []config.AIProviderModel{{
					ModelName: deepSeekCompactionE2EModel, ContextWindow: deepSeekManualE2EContextWindow,
					MaxOutputTokens: deepSeekCompactionE2EMaxOutput, EffectiveContextWindowPercent: 100,
				}},
			},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("validate isolated DeepSeek profile: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc, err := NewService(Options{
		Logger: logger, StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "bash", Config: cfg,
		RunMaxWallTime: 8 * time.Minute, RunIdleTimeout: 3 * time.Minute, ToolApprovalTimeout: time.Minute,
		ResolveProviderAPIKey: func(candidate string) (string, bool, error) {
			candidate = strings.TrimSpace(candidate)
			if candidate != providerID && candidate != manualProviderID {
				return "", false, nil
			}
			return apiKey, true, nil
		},
	})
	if err != nil {
		t.Fatalf("create isolated Flower service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := session.Meta{
		EndpointID: "env_deepseek_compaction_e2e", NamespacePublicID: "ns_deepseek_compaction_e2e",
		ChannelID: "ch_deepseek_compaction_e2e", UserPublicID: "user_deepseek_compaction_e2e",
		UserEmail: "deepseek-compaction-e2e@example.invalid", CanRead: true, CanWrite: true,
		CanExecute: true, CanAdmin: true,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	t.Run("manual slash command compacts and preserves context", func(t *testing.T) {
		threadID := createDeepSeekCompactionThread(t, ctx, svc, &meta, manualModelID, "Manual context compaction")
		oldestMarker := deepSeekManualContextMarker
		var before FlowerContextUsage
		for index := 1; index <= 4; index++ {
			seed := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, fmt.Sprintf("deepseek-compaction-manual-seed-%d", index), threadID, manualModelID,
				deepSeekCompactionPrompt("manual", oldestMarker, 12_000, "Reply with ACK_"+oldestMarker+" and finish normally without calling tools."))
			before = requireDeepSeekContextUsage(t, seed, "manual seed", deepSeekManualE2EContextWindow)
			if len(seed.Thread.ContextCompactions) != 0 {
				t.Fatalf("manual seed %d unexpectedly compacted: count=%d", index, len(seed.Thread.ContextCompactions))
			}
		}
		manualRequestID := "deepseek-compaction-manual"
		detail := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, manualRequestID, threadID, manualModelID, "/compact")
		t.Logf("manual preflight input=%d safe_limit=%d compactions=%d", before.InputTokens, before.RequestSafeLimitTokens, len(detail.Thread.ContextCompactions))
		compaction := requireDeepSeekCompaction(t, detail, func(item FlowerContextCompaction) bool {
			return item.RequestID == manualRequestID && item.Source == flowerManualCompactionSourceName
		})
		if compaction.Trigger != "manual" || compaction.Reason != "manual" {
			t.Fatalf("manual compaction trigger=(%q,%q), want (manual,manual)", compaction.Trigger, compaction.Reason)
		}
		assertDeepSeekCompactionSavings(t, compaction)
		assertDeepSeekCompactionRequestReset(t, recorder, 0)
	})

	t.Run("automatic pressure compacts before the provider request", func(t *testing.T) {
		threadID := createDeepSeekCompactionThread(t, ctx, svc, &meta, modelID, "Automatic context compaction")
		oldestMarker := deepSeekAutomaticContextMarker
		seed := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, "deepseek-compaction-automatic-seed", threadID, modelID,
			deepSeekCompactionPrompt("automatic", oldestMarker, 2_000, "Reply with ACK_"+oldestMarker+" and finish normally without calling tools."))
		before := requireDeepSeekContextUsage(t, seed, "automatic seed", deepSeekCompactionE2EContextWindow)
		if len(seed.Thread.ContextCompactions) != 0 {
			t.Fatalf("automatic seed unexpectedly compacted: count=%d", len(seed.Thread.ContextCompactions))
		}
		var detail *FlowerThreadDetail
		var compaction FlowerContextCompaction
		found := false
		for attempt, triggerTokens := range []int{8_000, 8_000, 8_000, 8_000} {
			requestID := fmt.Sprintf("deepseek-compaction-automatic-trigger-%02d", attempt+1)
			prompt := deepSeekCompactionPrompt("automatic-trigger", oldestMarker, triggerTokens,
				"Reply with the oldest remembered marker and finish normally without calling tools.")
			detail = sendDeepSeekCompactionTurn(t, ctx, svc, &meta, requestID, threadID, modelID, prompt)
			currentInput := int64(0)
			if detail.Thread.ContextUsage != nil {
				currentInput = detail.Thread.ContextUsage.InputTokens
			}
			t.Logf("automatic seed_input=%d safe_limit=%d trigger_attempt=%d trigger_tokens=%d current_input=%d compactions=%d", before.InputTokens, before.RequestSafeLimitTokens, attempt+1, triggerTokens, currentInput, len(detail.Thread.ContextCompactions))
			for _, item := range detail.Thread.ContextCompactions {
				if item.Source == "engine" && item.Trigger != "manual" {
					compaction = item
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			t.Fatalf("canonical context did not contain an automatic compaction after bounded pressure turns: %#v", detail.Thread.ContextCompactions)
		}
		if compaction.Status != "compacted" || compaction.Phase != "complete" {
			t.Fatalf("automatic compaction=%#v, want compacted/complete", compaction)
		}
		if strings.TrimSpace(compaction.RequestID) == "" {
			t.Fatal("automatic compaction omitted its canonical request identity")
		}
		if compaction.Trigger != "pre_request" || compaction.Reason != "threshold" {
			t.Fatalf("automatic compaction trigger=(%q,%q), want (pre_request,threshold)", compaction.Trigger, compaction.Reason)
		}
		assertDeepSeekCompactionSavings(t, compaction)
		assertDeepSeekCompactionRequestReset(t, recorder, 1)
	})
}

func assertDeepSeekCompactionRequestReset(t *testing.T, recorder *deepSeekContextRecorder, markerIndex int) {
	t.Helper()
	recorder.mu.Lock()
	observations := append([]deepSeekContextObservation(nil), recorder.observations...)
	recorder.mu.Unlock()
	resetIndex := -1
	var previous *deepSeekContextObservation
	for index, observation := range observations {
		if markerIndex < 0 || markerIndex >= len(observation.MarkerPresence) || !observation.MarkerPresence[markerIndex] {
			continue
		}
		if previous != nil && !stringPrefix(previous.MessageHashes, observation.MessageHashes) {
			if previous.SystemHash != observation.SystemHash || previous.ToolsHash != observation.ToolsHash {
				t.Fatalf("compaction changed the execution surface at observation %d", index)
			}
			resetIndex = index
			break
		}
		current := observation
		previous = &current
	}
	if resetIndex < 0 {
		t.Fatalf("completed compaction did not reset the observed render generation for marker %d", markerIndex+1)
	}
}

func assertOfficialDeepSeekCompactionEndpoint(t *testing.T, raw string) {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "api.deepseek.com") {
		t.Fatalf("real compaction qualification requires https://api.deepseek.com, received %q", raw)
	}
}

func createDeepSeekCompactionThread(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, modelID string, title string) string {
	t.Helper()
	thread, err := svc.CreateThread(ctx, meta, title, modelID, config.AIPermissionFullAccess, "")
	if err != nil {
		t.Fatalf("create compaction thread: %v", err)
	}
	if thread == nil || strings.TrimSpace(thread.ThreadID) == "" {
		t.Fatal("create compaction thread returned no identity")
	}
	return thread.ThreadID
}

func requireDeepSeekContextUsage(t *testing.T, detail *FlowerThreadDetail, label string, contextWindow int64) FlowerContextUsage {
	t.Helper()
	if detail == nil || detail.Thread.ContextUsage == nil {
		t.Fatalf("%s omitted canonical context usage", label)
	}
	usage := *detail.Thread.ContextUsage
	if usage.ContextWindowTokens != contextWindow || usage.OutputHeadroomTokens != deepSeekCompactionE2EMaxOutput {
		t.Fatalf("%s policy=(window:%d headroom:%d), want (%d,%d)", label,
			usage.ContextWindowTokens, usage.OutputHeadroomTokens,
			contextWindow, deepSeekCompactionE2EMaxOutput)
	}
	if usage.InputTokens <= 0 || usage.RequestSafeLimitTokens <= 0 || usage.InputTokens >= usage.RequestSafeLimitTokens {
		t.Fatalf("%s usage input=%d safe_limit=%d", label, usage.InputTokens, usage.RequestSafeLimitTokens)
	}
	return usage
}

func deepSeekCompactionPrompt(label string, marker string, approximateTokens int, instruction string) string {
	if approximateTokens < 1 {
		approximateTokens = 1
	}
	const ballast = "context ballast alpha beta gamma delta; "
	targetBytes := approximateTokens * 4
	repetitions := (targetBytes + len(ballast) - 1) / len(ballast)
	filler := strings.Repeat(ballast, repetitions)
	return fmt.Sprintf("Context qualification %s. Remember this exact durable marker: %s. The following ballast is unimportant.\n%s\n%s", label, marker, filler, instruction)
}

func sendDeepSeekCompactionTurn(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, requestID string, threadID string, modelID string, text string) *FlowerThreadDetail {
	t.Helper()
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ClientRequestID: requestID, ThreadID: threadID, Model: modelID,
		Input: RunInput{Text: text},
		Options: RunOptions{
			ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
			NoUserInteraction:  true,
		},
	})
	if err != nil {
		t.Fatalf("send compaction turn %s: %v", requestID, err)
	}
	if response.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("send compaction turn %s activity=%q, want active", requestID, response.Current.Activity)
	}
	turnID := response.Current.TurnID
	deadline := time.NewTimer(deepSeekCompactionEETurnTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		detail, detailErr := svc.GetFlowerThreadDetail(ctx, meta, threadID)
		if detailErr != nil {
			t.Fatalf("read compaction turn %s: %v", requestID, detailErr)
		}
		if detail != nil && detail.Current.TurnID == turnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				failureCode, failureHash, failureClasses := safeDeepSeekFailureFingerprint(detail.Current.Failure)
				t.Fatalf("compaction turn %s outcome=%q error_code=%q canonical_code=%q canonical_hash=%s classes=%v",
					requestID, *detail.Current.LastOutcome, detail.Thread.RunErrorCode, failureCode, failureHash, failureClasses)
			}
			return detail
		}
		select {
		case <-ctx.Done():
			t.Fatalf("wait for compaction turn %s: %v", requestID, ctx.Err())
		case <-deadline.C:
			t.Fatalf("compaction turn %s exceeded %s", requestID, deepSeekCompactionEETurnTimeout)
		case <-ticker.C:
		}
	}
}

func safeDeepSeekFailureFingerprint(failure *flruntime.ThreadTurnFailure) (string, string, []string) {
	if failure == nil {
		return "", "", nil
	}
	message := strings.ToLower(strings.TrimSpace(failure.Message))
	classes := make([]string, 0, 4)
	for _, class := range []string{"prefix", "progress", "control", "incomplete", "continuation", "tool", "provider", "usage", "context", "checkpoint", "segment", "model", "schema"} {
		if strings.Contains(message, class) {
			classes = append(classes, class)
		}
	}
	return string(failure.Code), sha256Hex([]byte(message)), classes
}

func requireDeepSeekCompaction(t *testing.T, detail *FlowerThreadDetail, match func(FlowerContextCompaction) bool) FlowerContextCompaction {
	t.Helper()
	if detail == nil {
		t.Fatal("compaction detail is nil")
	}
	for _, item := range detail.Thread.ContextCompactions {
		if match(item) {
			if item.Status != "compacted" || item.Phase != "complete" {
				t.Fatalf("compaction=%#v, want compacted/complete", item)
			}
			return item
		}
	}
	t.Fatalf("canonical context did not contain the expected compaction: %#v", detail.Thread.ContextCompactions)
	return FlowerContextCompaction{}
}

func assertDeepSeekCompactionSavings(t *testing.T, compaction FlowerContextCompaction) {
	t.Helper()
	if compaction.TokensBefore <= 0 || compaction.TokensAfterEstimate <= 0 || compaction.TokensAfterEstimate >= compaction.TokensBefore {
		t.Fatalf("compaction token change=%d -> %d, want positive savings", compaction.TokensBefore, compaction.TokensAfterEstimate)
	}
}
