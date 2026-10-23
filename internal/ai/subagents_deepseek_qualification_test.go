package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

// This opt-in qualification uses a configured provider and fresh product state.
// The same test can run against a baseline and candidate build; it never opens
// the source conversation database or changes the user's selected model.
func TestE2E_FlowerSubagentDeepSeekResearch(t *testing.T) {
	if os.Getenv("REDEVEN_SUBAGENT_DEEPSEEK_E2E") != "1" {
		t.Skip("set REDEVEN_SUBAGENT_DEEPSEEK_E2E=1 for real-provider qualification")
	}
	root := os.Getenv("REDEVEN_SUBAGENT_REPORT_DIR")
	if !filepath.IsAbs(root) {
		t.Fatal("absolute isolated report directory required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal("report directory must be fresh")
	}
	source := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	cfg, err := config.Load(filepath.Join(source, "config.json"))
	if err != nil || cfg.AI == nil {
		t.Fatal("source provider configuration unavailable")
	}
	providerID := os.Getenv("REDEVEN_SUBAGENT_PROVIDER_ID")
	var profile config.AIProvider
	for _, candidate := range cfg.AI.Providers {
		if candidate.ID == providerID && candidate.Type == "deepseek" {
			profile = candidate
		}
	}
	if profile.ID == "" {
		t.Fatal("explicit configured DeepSeek provider required")
	}
	var model config.AIProviderModel
	for _, candidate := range profile.EffectiveModels() {
		if candidate.ModelName == "deepseek-flash" {
			model = candidate
		}
	}
	if model.ModelName == "" || model.ContextWindow == 0 || model.MaxOutputTokens == 0 {
		t.Fatal("configured deepseek-flash model budgets unavailable")
	}
	key, found, err := settings.NewSecretsStore(filepath.Join(source, "secrets.json")).GetAIProviderAPIKey(profile.ID)
	if err != nil || !found || key == "" {
		t.Fatal("configured provider credential unavailable")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Minute)
	defer cancel()
	recorder := &deepSeekContextRecorder{}
	profile.BaseURL = newDeepSeekRecordingProxy(t, profile.BaseURL, recorder)
	profile.ModelSelection = nil
	profile.Models = []config.AIProviderModel{model}
	modelID := profile.ID + "/" + model.ModelName
	aiConfig := *cfg.AI
	aiConfig.CurrentModelID, aiConfig.Providers = modelID, []config.AIProvider{profile}
	workspace, home := filepath.Join(root, "workspace"), filepath.Join(root, "home")
	for _, dir := range []string{workspace, home} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper := os.Getenv("REDEVEN_SUBAGENT_BROWSER_HELPER")
	if !filepath.IsAbs(helper) {
		t.Fatal("absolute browser helper required")
	}
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Qualification Browser"}); err != nil {
		t.Fatal(err)
	}
	computer := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, filepath.Join(root, "browser-profile"))}, filepath.Join(root, "media"))
	configureBrowserFixture(t, computer)
	defer computer.Close()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "state"), AgentHomeDir: home, Shell: "/bin/zsh", Config: &aiConfig, TargetResolver: computer, TargetToolExecutor: computer, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == profile.ID, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Subagent research qualification", modelID, config.AIPermissionFullAccess, workspace)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	report := map[string]any{"provider_id": profile.ID, "wire_model": model.EffectiveWireModelName(), "reasoning": model.EffectiveDefaultReasoningSelection(profile.Type), "started_at": started, "thread_id": thread.ThreadID, "prompt": "创建sub agents调研最近24小时热门的AI相关的讨论、项目、发现，给出报告"}
	defer func() {
		report["passed"], report["elapsed_ms"], report["requests"] = !t.Failed(), time.Since(started).Milliseconds(), recorder.snapshot()
		saveCompactionQualificationJSON(t, filepath.Join(root, "report.json"), report)
	}()
	t.Logf("qualification thread=%s model=%s root=%s", thread.ThreadID, model.EffectiveWireModelName(), root)
	if _, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "research", Input: RunInput{Text: report["prompt"].(string)}}); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var parent flruntime.ThreadView
	for {
		parent, err = svc.threadRuntime.View(ctx, identity.ThreadID(thread.ThreadID))
		if err != nil {
			t.Fatal(err)
		}
		if parent.Attention.InputCount > 0 || parent.Attention.ApprovalCount > 0 {
			t.Error("research requires user attention")
			break
		}
		if parent.Activity == flruntime.ThreadActivityIdle && parent.LastOutcome != nil && len(parent.Queue) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
	if parent.LastOutcome == nil || *parent.LastOutcome != flruntime.TurnOutcomeCompleted {
		t.Error("parent did not complete")
	}
	parentID := identity.ThreadID(thread.ThreadID)
	children, err := svc.threadRuntime.List(ctx, flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		t.Fatal(err)
	}
	if len(children) < 2 {
		t.Errorf("expected multiple delegated research tasks, got %d", len(children))
	}
	views := []flruntime.ThreadView{parent}
	for _, child := range children {
		view, err := svc.threadRuntime.View(ctx, child.ID)
		if err != nil {
			t.Fatal(err)
		}
		if view.Activity != flruntime.ThreadActivityIdle || view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted {
			t.Errorf("child %s did not complete", child.ID)
		}
		views = append(views, view)
	}
	reader := svc.threadRuntime.(flruntime.ThreadToolResultReader)
	toolCounts, coordinationCounts := map[string]int{}, map[string]int{}
	coordinationErrors := map[string]int{}
	handoffCounts := map[string]int{}
	resultChars, coordinationChars, contradictoryWaits := 0, 0, 0
	evidence := []map[string]any{}
	for _, view := range views {
		seen := map[string]bool{}
		for _, item := range view.Items {
			if item.Activity == nil || item.Activity.ToolID == "" || seen[item.Activity.ToolID] {
				continue
			}
			seen[item.Activity.ToolID] = true
			result, found, err := reader.LookupToolResult(ctx, flruntime.LookupToolResultInput{ThreadID: view.ThreadID, TurnID: item.TurnID, RunID: item.RunID, ToolCallID: item.Activity.ToolID})
			if err != nil || !found {
				t.Fatalf("canonical result unavailable: %v", err)
			}
			toolCounts[result.ToolName]++
			resultChars += utf8.RuneCountInString(result.Content)
			evidence = append(evidence, map[string]any{"thread_id": view.ThreadID, "tool_call_id": item.Activity.ToolID, "result": result})
			if view.ThreadID != parentID || result.ToolName != "subagents" {
				continue
			}
			var args map[string]any
			_ = json.Unmarshal([]byte(result.Arguments), &args)
			action, _ := args["action"].(string)
			coordinationCounts[action]++
			coordinationChars += utf8.RuneCountInString(result.Content)
			if result.Status == "error" || strings.HasPrefix(result.Content, "ERROR:") {
				coordinationErrors[action]++
				continue
			}
			var payload struct {
				Data map[string]any `json:"data"`
			}
			if err := json.Unmarshal([]byte(result.Content), &payload); err != nil {
				t.Errorf("invalid coordination payload for %s: %v", action, err)
				continue
			}
			for _, h := range anySlice(payload.Data["handoffs"]) {
				if value, ok := h.(map[string]any); ok {
					handoffCounts[fmt.Sprint(value["thread_id"])]++
				}
			}
			if action == "wait" {
				statuses := map[string]string{}
				for _, raw := range anySlice(payload.Data["items"]) {
					value, _ := raw.(map[string]any)
					statuses[fmt.Sprint(value["thread_id"])] = fmt.Sprint(value["status"])
				}
				page, _ := payload.Data["events"].(map[string]any)
				for _, raw := range anySlice(page["events"]) {
					value, _ := raw.(map[string]any)
					if value["kind"] == "completed" && statuses[fmt.Sprint(value["source_thread_id"])] == "running" {
						contradictoryWaits++
					}
				}
			}
		}
	}
	report["tools"], report["tool_counts"], report["coordination_counts"] = evidence, toolCounts, coordinationCounts
	report["coordination_errors"] = coordinationErrors
	report["result_chars"], report["coordination_chars"], report["contradictory_waits"], report["handoff_counts"] = resultChars, coordinationChars, contradictoryWaits, handoffCounts
	report["children"] = children
	report["parent"] = parent
	for _, child := range children {
		if handoffCounts[child.ID.String()] != 1 {
			t.Errorf("child %s report delivered %d times", child.ID, handoffCounts[child.ID.String()])
		}
	}
	if os.Getenv("REDEVEN_SUBAGENT_EXPECT_COHERENT") == "1" && contradictoryWaits != 0 {
		t.Errorf("%d contradictory completion waits", contradictoryWaits)
	}
	if os.Getenv("REDEVEN_SUBAGENT_EXPECT_COHERENT") == "1" && len(coordinationErrors) != 0 {
		t.Errorf("coordination calls failed: %v", coordinationErrors)
	}
	for _, observation := range recorder.snapshot() {
		if observation.Model != "" && observation.Model != "deepseek-flash" {
			t.Errorf("unexpected wire model %q", observation.Model)
		}
	}
	text := qualificationAssistantText(parent, false)
	finalText := qualificationAssistantText(parent, true)
	report["final_response_contains_sources"] = len([]rune(finalText)) >= 500 && strings.Contains(finalText, "http")
	if len([]rune(text)) < 500 || !strings.Contains(text, "http") {
		t.Error("delivered research report lacks substantive cited content")
	}
	if err := os.WriteFile(filepath.Join(root, "research-report.md"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "final-response.md"), []byte(finalText), 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("results children=%d tools=%v coordination=%v errors=%v chars=%d contradictory_waits=%d", len(children), toolCounts, coordinationCounts, coordinationErrors, coordinationChars, contradictoryWaits)
}

func anySlice(value any) []any { values, _ := value.([]any); return values }

// The task does not prescribe when the model delivers its report. Preserve all
// admitted visible assistant text and separately observe the final boundary.
func qualificationAssistantText(view flruntime.ThreadView, finalOnly bool) string {
	final := map[string]bool{}
	for _, turn := range view.Turns {
		if turn.TurnID == view.TurnID {
			for _, id := range turn.FinalItemIDs {
				final[id] = true
			}
		}
	}
	var text strings.Builder
	for _, item := range view.Items {
		if (!finalOnly || final[item.ID]) && item.Kind == flruntime.ThreadItemAssistant && !item.Live && item.Text != "" {
			if text.Len() > 0 {
				text.WriteString("\n\n")
			}
			text.WriteString(item.Text)
		}
	}
	return text.String()
}

// Retained observations can be rescored after correcting an oracle without
// issuing another model request. Empty model names belong to native web calls.
func TestFlowerSubagentRetainedDeepSeekEvidence(t *testing.T) {
	path := os.Getenv("REDEVEN_SUBAGENT_RETAINED_REPORT")
	if path == "" {
		t.Skip("set REDEVEN_SUBAGENT_RETAINED_REPORT to re-evaluate a local report")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Requests []deepSeekContextObservation `json:"requests"`
		Children []flruntime.ThreadSummary    `json:"children"`
		Handoffs map[string]int               `json:"handoff_counts"`
		Tools    []struct {
			ThreadID string                     `json:"thread_id"`
			Result   flruntime.ThreadToolResult `json:"result"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	for _, request := range report.Requests {
		if request.Model != "" && request.Model != "deepseek-flash" {
			t.Fatalf("wire model = %q", request.Model)
		}
	}
	if len(report.Children) < 2 {
		t.Fatal("missing delegated work")
	}
	for _, child := range report.Children {
		if child.LastOutcome == nil || *child.LastOutcome != flruntime.TurnOutcomeCompleted || report.Handoffs[child.ID.String()] != 1 {
			t.Fatalf("incomplete delivery for %s", child.ID)
		}
	}
	before, after, coordinationErrors := 0, 0, 0
	for _, tool := range report.Tools {
		if tool.Result.ToolName != "subagents" {
			continue
		}
		if tool.Result.Status == "error" || strings.HasPrefix(tool.Result.Content, "ERROR:") {
			coordinationErrors++
			before += utf8.RuneCountInString(tool.Result.Content)
			after += utf8.RuneCountInString(tool.Result.Content)
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(tool.Result.Content), &payload); err != nil {
			t.Fatal(err)
		}
		data, ok := payload["data"].(map[string]any)
		if !ok {
			continue
		}
		originalHandoffs, _ := json.Marshal(data["handoffs"])
		original, _ := json.Marshal(payload)
		compactSubagentModelData(data)
		projected, _ := json.Marshal(payload)
		projectedHandoffs, _ := json.Marshal(data["handoffs"])
		if string(originalHandoffs) != string(projectedHandoffs) {
			t.Fatal("replayed projection altered handoffs")
		}
		before += utf8.RuneCount(original)
		after += utf8.RuneCount(projected)
	}
	t.Logf("retained delivery evidence passed; coordination errors %d; same-content coordination projection chars %d -> %d", coordinationErrors, before, after)
}

// Reopen only a copy of a completed qualification database. No model execution
// is permitted; this checks visible delivery against canonical facts.
func TestFlowerSubagentRetainedDeepSeekReport(t *testing.T) {
	path := os.Getenv("REDEVEN_SUBAGENT_RETAINED_REPORT")
	if path == "" {
		t.Skip("set REDEVEN_SUBAGENT_RETAINED_REPORT to inspect a completed run")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		ThreadID string `json:"thread_id"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	root := filepath.Dir(path)
	copyPath := filepath.Join(t.TempDir(), "threads.sqlite")
	if err := copyTargetThreadFile(filepath.Join(root, "state", "ai", "floret_threads.sqlite"), copyPath); err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(copyPath)})
	if err != nil {
		t.Fatal(err)
	}
	defer host.Shutdown(context.Background())
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return nil, fmt.Errorf("retained qualification must not execute")
	}))
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.View(t.Context(), identity.ThreadID(report.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	saveCompactionQualificationJSON(t, filepath.Join(root, "canonical-parent-view.json"), view)
	text := qualificationAssistantText(view, false)
	finalText := qualificationAssistantText(view, true)
	if len([]rune(text)) < 500 || !strings.Contains(text, "http") {
		t.Error("delivered research report lacks substantive cited content")
	}
	if err := os.WriteFile(filepath.Join(root, "research-report-revalidated.md"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("canonical parent turns=%d delivered_chars=%d final_chars=%d final_contains_sources=%v", len(view.Turns), utf8.RuneCountInString(text), utf8.RuneCountInString(finalText), strings.Contains(finalText, "http"))
}
