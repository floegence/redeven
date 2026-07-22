package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type parallelCanonicalTitleProvider struct {
	mainStarted chan struct{}
	mainRelease chan struct{}
	mainOnce    sync.Once
}

func (p *parallelCanonicalTitleProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	if isFloretThreadTitleRequest(req) {
		if req.Budgets.MaxOutputToken != 64 {
			return ModelGatewayResult{}, fmt.Errorf("title max output tokens=%d, want 64", req.Budgets.MaxOutputToken)
		}
		if req.ProviderControls.ReasoningSelection.Level != config.AIReasoningLevelOff {
			return ModelGatewayResult{}, fmt.Errorf("title reasoning=%+v, want off", req.ProviderControls.ReasoningSelection)
		}
		return ModelGatewayResult{FinishReason: "stop", Text: "修复终端停止故障"}, nil
	}
	p.mainOnce.Do(func() { close(p.mainStarted) })
	select {
	case <-p.mainRelease:
		return ModelGatewayResult{FinishReason: "stop", Text: "主任务完成"}, nil
	case <-ctx.Done():
		return ModelGatewayResult{}, ctx.Err()
	}
}

func TestRunFloretHostedTurnPublishesCanonicalChineseTitleWhileMainProviderRuns(t *testing.T) {
	const threadID = "thread_parallel_canonical_title"
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		WorkingDir:   t.TempDir(),
		Shell:        "/bin/bash",
		RunID:        "run_parallel_canonical_title",
		EndpointID:   "env_parallel_canonical_title",
		ThreadID:     threadID,
		TurnID:       "turn_parallel_canonical_title",
		MessageID:    "turn_parallel_canonical_title",
		SessionMeta: &session.Meta{
			EndpointID: "env_parallel_canonical_title",
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
	})
	svc := testServiceForRun(t, r)
	provider := &parallelCanonicalTitleProvider{
		mainStarted: make(chan struct{}),
		mainRelease: make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		done <- r.runFloretHostedTurn(context.Background(), RunRequest{
			Model: "provider-instance-42/deepseek-v4",
			ModelCapability: contextmodel.ModelCapability{
				ProviderID:    "provider-instance-42",
				ProviderType:  "openai_compatible",
				ModelName:     "deepseek-v4",
				WireModelName: "deepseek-v4",
				ReasoningCapability: config.AIReasoningCapability{
					Kind: "effort", SupportedLevels: []string{"high"}, DefaultLevel: "high", DisableSupported: true,
				},
			},
			Input: RunInput{Text: "请修复终端停止故障并验证状态"},
			Options: RunOptions{
				PermissionType:     config.AIPermissionFullAccess,
				ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh},
			},
		}, config.AIProvider{ID: "provider-instance-42", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "修复终端停止故障", provider)
	}()
	select {
	case <-provider.mainStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("main provider did not start")
	}

	deadline := time.Now().Add(3 * time.Second)
	var title string
	var titleStatus string
	var runStatus string
	for time.Now().Before(deadline) {
		snapshot, _, err := svc.readCanonicalThreadState(context.Background(), threadID)
		if err != nil {
			t.Fatalf("read canonical title: %v", err)
		}
		title = strings.TrimSpace(snapshot.Title)
		titleStatus = strings.TrimSpace(snapshot.TitleStatus)
		runStatus = string(snapshot.Status)
		if titleStatus == "ready" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if title != "修复终端停止故障" || titleStatus != "ready" || utf8.RuneCountInString(title) > 16 || strings.ContainsAny(title, "\r\n") {
		t.Fatalf("canonical title=%q status=%q run_status=%q", title, titleStatus, runStatus)
	}
	select {
	case err := <-done:
		t.Fatalf("main turn completed before barrier release: %v", err)
	default:
	}
	close(provider.mainRelease)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runFloretHostedTurn: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("main turn did not complete after release")
	}
}
