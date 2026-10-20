package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestE2E_FlowerPromptDeepSeekRuntime(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_PROMPT_E2E") != "1" {
		t.Skip("run scripts/check_flower_prompt_deepseek.sh")
	}
	provider, model, key := loadPromptQualificationProfile(t)
	reportRoot := os.Getenv("REDEVEN_FLOWER_PROMPT_REPORT_DIR")
	if reportRoot == "" {
		t.Fatal("isolated report directory required")
	}
	root := filepath.Join(reportRoot, "runtime")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(root, "workspace")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal("runtime report directory must be fresh")
	}
	fixtures := map[string]string{
		"AGENTS.md":    "# Fixture rules\nDo not use subagents. Preserve the exported Add function. Before changing code, read SPEC.md completely and follow its requirements. Run the existing unittest after the change.\n",
		"SPEC.md":      strings.Repeat("Disposable fixture background.\n", 80) + "\nRequired: Add returns the sum. Keep the marker FIXTURE_RULE_READ_7319 as a comment next to Add.\n",
		"calc.py":      "def Add(a, b):\n    return a - b\n",
		"test_calc.py": "import unittest\nfrom calc import Add\nclass TestAdd(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(Add(2, 3), 5)\n        self.assertEqual(Add(-2, 2), 0)\nif __name__ == '__main__':\n    unittest.main()\n"}
	for name, body := range fixtures {
		if err := os.WriteFile(filepath.Join(workspace, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	defer cancel()
	recorder := &deepSeekContextRecorder{}
	provider.BaseURL = newDeepSeekRecordingProxy(t, provider.BaseURL, recorder)
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	modelID := provider.ID + "/" + model.ModelName
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "state"), AgentHomeDir: filepath.Join(root, "home"), Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }}
	if err := os.MkdirAll(opts.AgentHomeDir, 0700); err != nil {
		t.Fatal(err)
	}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if svc != nil {
			_ = svc.Close()
		}
	}()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Prompt slimming qualification", modelID, config.AIPermissionFullAccess, workspace)
	if err != nil {
		t.Fatal(err)
	}
	report := map[string]any{"wire_model": model.EffectiveWireModelName(), "workspace": workspace}
	defer func() {
		report["passed"] = !t.Failed()
		report["requests"] = recorder.snapshot()
		saveCompactionQualificationJSON(t, filepath.Join(root, "report.json"), report)
	}()
	send := func(id, text string) *FlowerThreadDetail {
		response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: id, Input: RunInput{Text: text}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 4096, NoUserInteraction: true, ToolAllowlist: []string{"terminal.exec", "terminal.read", "file.edit", "file.write", "apply_patch"}}})
		if err != nil {
			t.Fatal(err)
		}
		detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
			if d.Current.TurnID != response.Current.TurnID || d.Current.Activity != flruntime.ThreadActivityIdle || d.Current.LastOutcome == nil {
				return false
			}
			if *d.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				code, hash, classes := safeDeepSeekFailureFingerprint(d.Current.Failure)
				t.Fatalf("runtime failed code=%s hash=%s classes=%v", code, hash, classes)
			}
			return true
		})
		assertQualificationContextAttribution(t, detail)
		return detail
	}
	// Fresh consultations retain the production tool surface and Floret Goal
	// injection. No user instruction forbids tools or task management here.
	for _, tc := range []struct{ name, input string }{
		{"subjective_feedback", "你觉得‘简单问题直接回答，复杂问题先确认范围’这句话会让你困惑吗？说说你的感受。"},
		{"supplied_code_discussion", "帮我看看这段提供的代码：func Add(a, b int) int { return a - b }。它是否符合函数名表达的含义？"},
		{"workflow_scope", "帮我看看这条仓库规则是否合理：‘实现后验证、提交、推送并部署’。"},
	} {
		consultation, err := svc.CreateThread(ctx, meta, tc.name, modelID, config.AIPermissionFullAccess, workspace)
		if err != nil {
			t.Fatal(err)
		}
		start := len(recorder.snapshot())
		response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: consultation.ThreadID, ClientRequestID: tc.name, Input: RunInput{Text: tc.input}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 4096, NoUserInteraction: true, ToolAllowlist: []string{"terminal.exec", "terminal.read", "file.edit", "file.write", "apply_patch"}}})
		if err != nil {
			t.Fatal(err)
		}
		detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, consultation.ThreadID, func(d *FlowerThreadDetail) bool {
			return d.Current.TurnID == response.Current.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
		})
		if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted || (detail.Current.Goal != nil && detail.Current.Goal.Status != "absent") || strings.TrimSpace(ollamaTaskText(detail.Current)) == "" {
			t.Errorf("%s: consultation did not complete directly without Goal", tc.name)
		}
		mainRequests := 0
		for _, request := range recorder.snapshot()[start:] {
			if request.Kind == "main" {
				mainRequests++
			}
			if len(request.ResponseToolNames) != 0 {
				t.Errorf("%s: consultation invoked tools: %v", tc.name, request.ResponseToolNames)
			}
		}
		if mainRequests != 1 {
			t.Errorf("%s: consultation required %d provider steps", tc.name, mainRequests)
		}
		report[tc.name] = detail
	}
	detail := send("repair", "Fix Add in this fixture project. Follow its repository rules and verify the existing tests. Work only inside this workspace; no subagents. Reply concisely in Chinese with the result.")
	code, err := os.ReadFile(filepath.Join(workspace, "calc.py"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(code), "FIXTURE_RULE_READ_7319") {
		t.Error("complete repository rule requirement was not applied")
	}
	command := exec.CommandContext(ctx, "python3", "-m", "unittest")
	command.Dir = workspace
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("external verification failed: %s %v", out, err)
	}
	toolCount := 0
	for _, item := range detail.Current.Items {
		if item.Activity != nil {
			toolCount++
		}
	}
	if toolCount < 3 {
		t.Errorf("insufficient canonical tool loop evidence: %d", toolCount)
	}
	report["repair"] = detail
	terminalStart := len(recorder.snapshot())
	detail = send("terminal", fmt.Sprintf("Run this finite command once in %s with yield_ms:0, then observe the existing process until completion: python3 -c 'import time; time.sleep(2); print(7319 * 2)'. Report its result, do not modify files.", workspace))
	if !strings.Contains(ollamaTaskText(detail.Current), "14638") {
		t.Error("terminal output was not reported")
	}
	report["terminal"] = detail
	reads, starts := 0, 0
	for _, request := range recorder.snapshot()[terminalStart:] {
		for _, name := range request.ResponseToolNames {
			if name == "terminal_read" {
				reads++
			}
			if name == "terminal_exec" {
				starts++
			}
		}
	}
	if reads == 0 || starts != 1 {
		t.Errorf("finite command starts=%d reads=%d; want one start and live observation", starts, reads)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = nil
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	detail = send("restart", "From the existing conversation only, report the marker required by SPEC.md and the arithmetic command's printed result. Do not call tools.")
	text := ollamaTaskText(detail.Current)
	if !strings.Contains(text, "FIXTURE_RULE_READ_7319") || !strings.Contains(text, "14638") {
		t.Error("restart lost prior tool evidence")
	}
	report["restart"] = detail
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "question", Input: RunInput{Text: "请只问我一个问题，在甲区和乙区中选择一个，用可点击的选项。这两个选项就是全部候选。收到答案后，只回复所选区域，不要继续提问或调用其他工具。"}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 4096, ToolAllowlist: []string{"ask_user"}}})
	if err != nil {
		t.Fatal(err)
	}
	waiting := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
		return d.Current.TurnID == response.Current.TurnID && d.Thread.WaitingPrompt != nil
	})
	prompt := waiting.Thread.WaitingPrompt
	if len(prompt.Questions) != 1 || len(prompt.Questions[0].Choices) < 2 {
		t.Fatal("missing structured clickable question")
	}
	question := prompt.Questions[0]
	choice := question.Choices[0]
	report["question"] = waiting
	if _, err := svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: prompt.PromptID, Answers: map[string]RequestUserInputAnswer{question.ID: {ChoiceID: choice.ChoiceID}}}}); err != nil {
		t.Fatal(err)
	}
	detail = waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
		return d.Current.TurnID == response.Current.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
	})
	if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted || !strings.Contains(ollamaTaskText(detail.Current), choice.Label) {
		t.Error("structured answer did not complete with selected choice")
	}
	report["answer"] = detail
	if err := os.WriteFile(filepath.Join(workspace, "readonly.txt"), []byte("Qualification marker: READONLY_8527\n"), 0600); err != nil {
		t.Fatal(err)
	}
	readonly, err := svc.CreateThread(ctx, meta, "Readonly prompt qualification", modelID, config.AIPermissionReadonly, workspace)
	if err != nil {
		t.Fatal(err)
	}
	readonlyStart := len(recorder.snapshot())
	response, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: readonly.ThreadID, ClientRequestID: "readonly", Input: RunInput{Text: "Read readonly.txt and report its qualification marker. Do not change any files."}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 4096, NoUserInteraction: true, ToolAllowlist: []string{"read_file", "read_files"}}})
	if err != nil {
		t.Fatal(err)
	}
	detail = waitForDeepSeekAskUserDetail(t, ctx, svc, meta, readonly.ThreadID, func(d *FlowerThreadDetail) bool {
		return d.Current.TurnID == response.Current.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
	})
	if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted || !strings.Contains(ollamaTaskText(detail.Current), "READONLY_8527") {
		t.Error("readonly tool execution did not report the file marker")
	}
	readonlyCalls := 0
	for _, request := range recorder.snapshot()[readonlyStart:] {
		for _, name := range request.ResponseToolNames {
			if name != "read_file" && name != "read_files" {
				t.Errorf("unexpected readonly tool: %s", name)
			}
			readonlyCalls++
		}
	}
	if readonlyCalls == 0 {
		t.Error("readonly file was never read")
	}
	report["readonly"] = detail
	t.Logf("wire_model=%s verified code repair, repository rules, terminal continuation, restart recall, structured interaction resume and readonly execution", model.EffectiveWireModelName())
}
