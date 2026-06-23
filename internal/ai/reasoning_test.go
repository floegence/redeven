package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func testReasoningCapability() config.AIReasoningCapability {
	return config.AIReasoningCapability{
		Kind:             "effort",
		SupportedLevels:  []string{"low", "high"},
		DefaultLevel:     "low",
		DisableSupported: true,
		WireShape:        "openai_responses_reasoning_effort",
		DisableShape:     "openai_reasoning_effort_none",
		SourceURLs:       []string{"https://developers.openai.com/api/docs/guides/reasoning"},
		SourceCheckedAt:  "2026-06-23",
		Fixture:          "openai_responses_reasoning_effort",
	}
}

func TestResolveEffectiveReasoningRejectsUnsupportedTurnOverride(t *testing.T) {
	t.Parallel()

	_, err := resolveEffectiveReasoning(
		testReasoningCapability(),
		config.AIReasoningSelection{Level: config.AIReasoningLevelMax},
		config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
		config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
	)
	if err == nil {
		t.Fatalf("resolveEffectiveReasoning succeeded, want unsupported override error")
	}
}

func TestResolveEffectiveReasoningDoesNotFallbackFromUnsupportedThreadDefault(t *testing.T) {
	t.Parallel()

	_, err := resolveEffectiveReasoning(
		testReasoningCapability(),
		config.AIReasoningSelection{},
		config.AIReasoningSelection{Level: config.AIReasoningLevelMax},
		config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
	)
	if err == nil {
		t.Fatalf("resolveEffectiveReasoning succeeded, want unsupported thread default error")
	}
}

func TestNormalizeReasoningForModelSwitchAdjustsToModelDefault(t *testing.T) {
	t.Parallel()

	normalized, adjusted, err := normalizeReasoningForModelSwitch(
		testReasoningCapability(),
		config.AIReasoningSelection{Level: config.AIReasoningLevelMax},
		config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
	)
	if err != nil {
		t.Fatalf("normalizeReasoningForModelSwitch: %v", err)
	}
	if !adjusted {
		t.Fatalf("adjusted=false, want true")
	}
	if normalized.Level != config.AIReasoningLevelLow {
		t.Fatalf("level=%q, want low", normalized.Level)
	}
}

func TestServiceCreateThreadInitializesDefaultReasoningSelection(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	view, err := svc.CreateThreadWithOptions(context.Background(), meta, CreateThreadRequest{
		Title:   "reasoning defaults",
		ModelID: "openai/gpt-5-mini",
	})
	if err != nil {
		t.Fatalf("CreateThreadWithOptions: %v", err)
	}
	if view.ReasoningSelection.Level != config.AIReasoningLevelMedium {
		t.Fatalf("ReasoningSelection=%+v, want medium default", view.ReasoningSelection)
	}
	if view.ReasoningCapability.WireShape != "openai_responses_reasoning_effort" {
		t.Fatalf("ReasoningCapability=%+v, want OpenAI reasoning capability", view.ReasoningCapability)
	}
}

func TestServiceSetThreadReasoningSelectionRejectsUnsupportedLevel(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	view, err := svc.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		Title:   "reject unsupported",
		ModelID: "openai/gpt-5-mini",
	})
	if err != nil {
		t.Fatalf("CreateThreadWithOptions: %v", err)
	}
	err = svc.SetThreadReasoningSelection(ctx, meta, view.ThreadID, config.AIReasoningSelection{Level: config.AIReasoningLevelMax})
	if err == nil {
		t.Fatalf("SetThreadReasoningSelection accepted max for gpt-5-mini")
	}
	latest, err := svc.GetThread(ctx, meta, view.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest.ReasoningSelection.Level != config.AIReasoningLevelMedium {
		t.Fatalf("ReasoningSelection changed to %+v, want original medium", latest.ReasoningSelection)
	}
}

func TestServiceClearThreadReasoningSelectionRemovesThreadOverride(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	view, err := svc.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		Title:              "clear reasoning override",
		ModelID:            "openai/gpt-5-mini",
		ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh},
	})
	if err != nil {
		t.Fatalf("CreateThreadWithOptions: %v", err)
	}
	if view.ReasoningSelection.Level != config.AIReasoningLevelHigh {
		t.Fatalf("ReasoningSelection=%+v, want high override", view.ReasoningSelection)
	}
	if err := svc.ClearThreadReasoningSelection(ctx, meta, view.ThreadID); err != nil {
		t.Fatalf("ClearThreadReasoningSelection: %v", err)
	}
	latest, err := svc.GetThread(ctx, meta, view.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if !latest.ReasoningSelection.IsZero() {
		t.Fatalf("ReasoningSelection=%+v, want cleared stored override", latest.ReasoningSelection)
	}
	if latest.ReasoningCapability.WireShape != "openai_responses_reasoning_effort" {
		t.Fatalf("ReasoningCapability=%+v, want retained model capability", latest.ReasoningCapability)
	}
}

func TestServiceSetThreadModelNormalizesReasoningSelection(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	view, err := svc.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		Title:              "model switch",
		ModelID:            "openai/gpt-5-mini",
		ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh},
	})
	if err != nil {
		t.Fatalf("CreateThreadWithOptions: %v", err)
	}
	if err := svc.SetThreadModel(ctx, meta, view.ThreadID, "openai/gpt-4o-mini"); err != nil {
		t.Fatalf("SetThreadModel: %v", err)
	}
	latest, err := svc.GetThread(ctx, meta, view.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest.ModelID != "openai/gpt-4o-mini" {
		t.Fatalf("ModelID=%q, want gpt-4o-mini", latest.ModelID)
	}
	if !latest.ReasoningSelection.IsZero() {
		t.Fatalf("ReasoningSelection=%+v, want cleared for model without reasoning capability", latest.ReasoningSelection)
	}
}
