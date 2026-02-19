package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
)

func testModelLockConfig() *config.AIConfig {
	return &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models: []config.AIProviderModel{
					{ModelName: "gpt-5-mini"},
					{ModelName: "gpt-4o-mini"},
				},
			},
		},
	}
}

func TestExecutePreparedRun_InitializesThreadModelLock(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "lock-init", "openai/gpt-5-mini", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prepared, err := svc.prepareRun(meta, "run_model_lock_init", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "initialize lock"},
		Options:  RunOptions{MaxSteps: 1},
	}, nil, nil)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = svc.executePreparedRun(execCtx, prepared)

	latest, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest == nil {
		t.Fatalf("thread missing")
	}
	if !latest.ModelLocked {
		t.Fatalf("ModelLocked=%v, want true", latest.ModelLocked)
	}
	if latest.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want %q", latest.ModelID, "openai/gpt-5-mini")
	}
}

func TestResolveRunModel_LockedThreadRejectsModelSwitch(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	_, err := svc.resolveRunModel(
		context.Background(),
		testModelLockConfig(),
		"openai/gpt-4o-mini",
		"openai/gpt-5-mini",
		true,
		nil,
	)
	if !errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
		t.Fatalf("resolveRunModel err=%v, want %v", err, ErrModelSwitchRequiresExplicitRestart)
	}
}

func TestResolveRunModel_LockedThreadUsesLockedModel(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelLockConfig(),
		"",
		"openai/gpt-5-mini",
		true,
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-5-mini" {
		t.Fatalf("resolved.ID=%q, want %q", resolved.ID, "openai/gpt-5-mini")
	}
}

func TestResolveRunModel_LockedThreadRequiresLockedModelID(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	_, err := svc.resolveRunModel(
		context.Background(),
		testModelLockConfig(),
		"",
		"",
		true,
		nil,
	)
	if !errors.Is(err, ErrModelLockViolation) {
		t.Fatalf("resolveRunModel err=%v, want %v", err, ErrModelLockViolation)
	}
}

func TestResolveRunModel_UnlockedThreadAllowsRequestedModel(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelLockConfig(),
		"openai/gpt-4o-mini",
		"openai/gpt-5-mini",
		false,
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-4o-mini" {
		t.Fatalf("resolved.ID=%q, want %q", resolved.ID, "openai/gpt-4o-mini")
	}
}
