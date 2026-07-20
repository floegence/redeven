package ai

import (
	"context"
	"encoding/json"
	"strings"
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

	latest, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, th.ThreadID)
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

func TestSetCurrentModelID_UpdatesConfigFutureDefault(t *testing.T) {
	t.Parallel()

	cfg := testModelResolutionConfig()
	svc := &Service{cfg: cfg}
	var persisted *config.AIConfig
	err := svc.SetCurrentModelID("openai/gpt-4o-mini", func(next *config.AIConfig) error {
		copy := *next
		persisted = &copy
		return nil
	})
	if err != nil {
		t.Fatalf("SetCurrentModelID: %v", err)
	}
	if persisted == nil {
		t.Fatalf("persist was not called")
	}
	if persisted.CurrentModelID != "openai/gpt-4o-mini" {
		t.Fatalf("persisted CurrentModelID=%q, want %q", persisted.CurrentModelID, "openai/gpt-4o-mini")
	}
	if svc.cfg.CurrentModelID != "openai/gpt-4o-mini" {
		t.Fatalf("service CurrentModelID=%q, want %q", svc.cfg.CurrentModelID, "openai/gpt-4o-mini")
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
					ID:         modelID,
					Label:      "Desktop / default",
					Provider:   "Desktop",
					Capability: testDesktopModelSourceCapability(modelID),
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
	if resolved.Capability.ReasoningCapability.DefaultLevel != "high" || !resolved.Capability.ReasoningCapability.SupportsLevel(config.AIReasoningLevelMax) {
		t.Fatalf("ReasoningCapability=%+v, want Desktop snapshot capability", resolved.Capability.ReasoningCapability)
	}
	if resolved.Capability.MaxContextTokens != 950_000 || resolved.Capability.PreferredToolSchemaMode != "relaxed_json" {
		t.Fatalf("Capability=%+v, want Desktop snapshot limits and tool schema", resolved.Capability)
	}
}

func TestExecutePreparedRun_UsesDesktopModelSourceReasoningCapability(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_reasoning"
	streamedRequests := make(chan ModelGatewayRequest, 1)
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:         modelID,
					Label:      "DeepSeek / deepseek-v4-pro",
					Provider:   "DeepSeek",
					Capability: testDesktopModelSourceCapability(modelID),
				}},
			})
		case "ai.turn.stream":
			var body desktopModelSourceStreamRequest
			if err := json.Unmarshal(frame.Params, &body); err != nil {
				return testDesktopModelSourceError(frame.ID, "DECODE_FAILED", err.Error())
			}
			streamedRequests <- body.Request
			return testDesktopModelSourceResult(t, frame.ID, ModelGatewayResult{FinishReason: "stop", Text: "desktop reply"})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	svc := newSendTurnTestService(t)
	svc.mu.Lock()
	svc.cfg = &config.AIConfig{PermissionType: config.AIPermissionReadonly}
	svc.desktopModelSource = modelSource
	svc.mu.Unlock()
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "desktop reasoning", modelID, "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if thread.ReasoningSelection.Level != config.AIReasoningLevelHigh {
		t.Fatalf("ReasoningSelection=%+v, want high Desktop default", thread.ReasoningSelection)
	}
	prepared, err := svc.prepareRun(meta, "run_desktop_reasoning", RunStartRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{Text: "use desktop reasoning"},
	}, nil, nil)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}
	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := svc.executePreparedRun(execCtx, prepared); err != nil {
		t.Fatalf("executePreparedRun: %v", err)
	}
	var streamedRequest ModelGatewayRequest
	streamDeadline := time.NewTimer(2 * time.Second)
	defer streamDeadline.Stop()
	select {
	case streamedRequest = <-streamedRequests:
	case <-streamDeadline.C:
		t.Fatalf("Desktop model source did not receive ai.turn.stream")
	}
	if streamedRequest.Model != modelID {
		t.Fatalf("streamed model=%q, want %q", streamedRequest.Model, modelID)
	}
	if streamedRequest.ProviderControls.ReasoningSelection.Level != config.AIReasoningLevelHigh {
		t.Fatalf("streamed reasoning=%+v, want high", streamedRequest.ProviderControls.ReasoningSelection)
	}
	if streamedRequest.ProviderControls.ReasoningCapability.WireShape != "deepseek_reasoning_effort" {
		t.Fatalf("streamed capability=%+v, want DeepSeek reasoning", streamedRequest.ProviderControls.ReasoningCapability)
	}
}

func TestExecutePreparedRun_DesktopReasoningPrecedence(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_reasoning_precedence"
	streamedRequests := make(chan ModelGatewayRequest, 8)
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:         modelID,
					Label:      "DeepSeek / deepseek-v4-pro",
					Provider:   "DeepSeek",
					Capability: testDesktopModelSourceCapability(modelID),
				}},
			})
		case "ai.turn.stream":
			var body desktopModelSourceStreamRequest
			if err := json.Unmarshal(frame.Params, &body); err != nil {
				return testDesktopModelSourceError(frame.ID, "DECODE_FAILED", err.Error())
			}
			streamedRequests <- body.Request
			return testDesktopModelSourceResult(t, frame.ID, ModelGatewayResult{FinishReason: "stop", Text: "desktop reply"})
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
	ctx := context.Background()
	thread, err := svc.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
		Title:              "desktop reasoning precedence",
		ModelID:            modelID,
		ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelMax},
	})
	if err != nil {
		t.Fatalf("CreateThreadWithOptions: %v", err)
	}
	if thread.ReasoningSelection.Level != config.AIReasoningLevelMax {
		t.Fatalf("ReasoningSelection=%+v, want explicit max thread default", thread.ReasoningSelection)
	}

	run := func(runID string, text string, selection config.AIReasoningSelection) ModelGatewayRequest {
		t.Helper()
		prepared, err := svc.prepareRun(meta, runID, RunStartRequest{
			ThreadID: thread.ThreadID,
			Input:    RunInput{Text: text},
			Options:  RunOptions{ReasoningSelection: selection},
		}, nil, nil)
		if err != nil {
			t.Fatalf("prepareRun(%s): %v", runID, err)
		}
		execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := svc.executePreparedRun(execCtx, prepared); err != nil {
			t.Fatalf("executePreparedRun(%s): %v", runID, err)
		}
		deadline := time.NewTimer(2 * time.Second)
		defer deadline.Stop()
		for {
			select {
			case request := <-streamedRequests:
				for _, message := range request.Messages {
					for _, part := range message.Content {
						if part.Text == text {
							return request
						}
					}
				}
			case <-deadline.C:
				t.Fatalf("Desktop model source did not receive main ai.turn.stream for %s", runID)
				return ModelGatewayRequest{}
			}
		}
	}

	explicit := run("run_desktop_reasoning_explicit", "use explicit reasoning", config.AIReasoningSelection{Level: config.AIReasoningLevelHigh})
	if explicit.ProviderControls.ReasoningSelection.Level != config.AIReasoningLevelHigh {
		t.Fatalf("explicit reasoning=%+v, want high single-turn override", explicit.ProviderControls.ReasoningSelection)
	}
	threadDefault := run("run_desktop_reasoning_thread", "use thread reasoning", config.AIReasoningSelection{})
	if threadDefault.ProviderControls.ReasoningSelection.Level != config.AIReasoningLevelMax {
		t.Fatalf("thread reasoning=%+v, want max thread default", threadDefault.ProviderControls.ReasoningSelection)
	}
}

func TestCreateThreadRejectsUnsupportedDesktopReasoning(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_without_reasoning"
	capability := *testDesktopModelSourceCapability(modelID)
	capability.SupportsReasoningTokens = false
	capability.ReasoningCapability = config.AIReasoningCapability{}
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:         modelID,
					Label:      "Desktop / plain",
					Provider:   "Desktop",
					Capability: &capability,
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
	_, err := svc.CreateThreadWithOptions(context.Background(), testSendTurnMeta(), CreateThreadRequest{
		Title:              "unsupported desktop reasoning",
		ModelID:            modelID,
		ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh},
	})
	if err == nil {
		t.Fatalf("CreateThreadWithOptions accepted reasoning for unsupported Desktop model")
	}
	if !strings.Contains(err.Error(), "invalid reasoning selection") {
		t.Fatalf("CreateThreadWithOptions error=%q, want invalid reasoning selection", err)
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
