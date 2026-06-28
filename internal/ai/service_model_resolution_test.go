package ai

import (
	"context"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

func testModelResolutionConfig() *config.AIConfig {
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

func TestExecutePreparedRun_DoesNotMutateThreadDefaultForExplicitModel(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "per-turn model", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prepared, err := svc.prepareRun(meta, "run_model_override", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-4o-mini",
		Input:    RunInput{Text: "use a one-turn model"},
		Options:  RunOptions{},
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
	if latest.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want unchanged thread default %q", latest.ModelID, "openai/gpt-5-mini")
	}
}

func TestResolveRunModel_PrefersRequestedModel(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelResolutionConfig(),
		"openai/gpt-4o-mini",
		"openai/gpt-5-mini",
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-4o-mini" {
		t.Fatalf("resolved.ID=%q, want %q", resolved.ID, "openai/gpt-4o-mini")
	}
}

func TestResolveRunModel_UsesThreadDefaultWhenRequestOmitsModel(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelResolutionConfig(),
		"",
		"openai/gpt-4o-mini",
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-4o-mini" {
		t.Fatalf("resolved.ID=%q, want %q", resolved.ID, "openai/gpt-4o-mini")
	}
}

func TestResolveRunModel_FallsBackToCurrentConfigModel(t *testing.T) {
	t.Parallel()

	svc := &Service{}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelResolutionConfig(),
		"",
		"",
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-5-mini" {
		t.Fatalf("resolved.ID=%q, want %q", resolved.ID, "openai/gpt-5-mini")
	}
}

func TestResolveRunModel_PrefersDesktopModelSourceDefaultBeforeConfigCurrent(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_default"
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:       modelID,
					Label:    "Desktop / default",
					Provider: "Desktop",
				}},
			})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	svc := &Service{desktopModelSource: modelSource}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelResolutionConfig(),
		"",
		"",
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != modelID {
		t.Fatalf("resolved.ID=%q, want Desktop model source default %q", resolved.ID, modelID)
	}
	if resolved.ProviderID != DesktopModelSourceProviderType {
		t.Fatalf("ProviderID=%q, want %q", resolved.ProviderID, DesktopModelSourceProviderType)
	}
}

func TestCreateThread_PrefersDesktopModelSourceDefaultBeforeConfigCurrent(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_thread_default"
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:       modelID,
					Label:    "Desktop / thread default",
					Provider: "Desktop",
				}},
			})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	svc := newSendTurnTestService(t)
	svc.mu.Lock()
	svc.desktopModelSource = modelSource
	svc.mu.Unlock()
	meta := testSendTurnMeta()

	thread, err := svc.CreateThread(context.Background(), meta, "desktop default", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if thread.ModelID != modelID {
		t.Fatalf("thread.ModelID=%q, want Desktop model source default %q", thread.ModelID, modelID)
	}
}

func TestResolveRunModel_IgnoresDesktopModelSourceWhenCurrentModelMissing(t *testing.T) {
	t.Parallel()

	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: "desktop:model_missing",
				Models: []DesktopModelSourceModel{{
					ID:       "desktop:model_other",
					Label:    "Desktop / other",
					Provider: "Desktop",
				}},
			})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	svc := &Service{desktopModelSource: modelSource}
	resolved, err := svc.resolveRunModel(
		context.Background(),
		testModelResolutionConfig(),
		"",
		"",
		nil,
	)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	if resolved.ID != "openai/gpt-5-mini" {
		t.Fatalf("resolved.ID=%q, want config current model", resolved.ID)
	}
}
