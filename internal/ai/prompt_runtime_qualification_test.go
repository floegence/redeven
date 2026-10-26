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
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
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
	fixtures := qualificationRuntimeFixtures()
	for name, body := range fixtures {
		if err := os.WriteFile(filepath.Join(workspace, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	init := exec.Command("git", "init", "--quiet", workspace)
	if out, err := init.CombinedOutput(); err != nil {
		t.Fatalf("initialize disposable repository: %v %s", err, out)
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
			if d.Current.TurnID != identity.TurnID(response.TurnID) || d.Current.Activity != flruntime.ThreadActivityIdle || d.Current.LastOutcome == nil {
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
	// Intent pairs share the actual tool surface and Goal injection. Contextual
	// assessment may inspect; request/call counts are efficiency observations.
	for _, tc := range []struct {
		name, input string
		noTools     bool
		evidence    string
	}{
		{"subjective_feedback", "你觉得‘简单问题直接回答，复杂问题先确认范围’这句话会让你困惑吗？说说你的感受。", false, ""},
		{"supplied_code_discussion", "帮我看看这段提供的代码：func Add(a, b int) int { return a - b }。它是否符合函数名表达的含义？", false, ""},
		{"workflow_text_only", "只评价下面这句话的措辞，无需检查仓库：‘实现后验证、提交、推送并部署’。", true, ""},
		{"workflow_scope", "帮我看看这条仓库规则是否合理：‘实现后验证、提交、推送并部署’。", false, ""},
		{"workflow_repository", "请结合当前仓库的实际工作流，评价这条规则是否合理：‘实现后验证、提交、推送并部署’。请说明仓库规定的发布目标。", false, "staging-only"},
	} {
		before := qualificationFileSnapshot(t, workspace)
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
			return d.Current.TurnID == identity.TurnID(response.TurnID) && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
		})
		if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted || (detail.Current.Goal != nil && detail.Current.Goal.Status != "absent") || strings.TrimSpace(ollamaTaskText(detail.Current)) == "" {
			t.Errorf("%s: brief assessment did not complete without Goal", tc.name)
		}
		results := qualificationCanonicalResults(t, ctx, svc, detail)
		if err := checkQualificationFixtureRules(results, fixtures); err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
		calls := []ToolCall{}
		for _, result := range results {
			var args map[string]any
			if err := json.Unmarshal([]byte(result.Arguments), &args); err != nil {
				t.Fatal(err)
			}
			calls = append(calls, ToolCall{Name: result.ToolName, Args: args})
		}
		if tc.noTools && len(calls) != 0 {
			t.Errorf("%s: inspected despite sufficient text-only context", tc.name)
		}
		if err := checkPromptQualificationReadonly(ModelGatewayResult{ToolCalls: calls}); err != nil {
			if strings.HasPrefix(err.Error(), "review_required:") {
				report[tc.name+"_review_required"] = err.Error()
				t.Logf("%s: manual trace review required", tc.name)
			} else {
				t.Errorf("%s: %v", tc.name, err)
			}
		}
		if !reflect.DeepEqual(before, qualificationFileSnapshot(t, workspace)) {
			t.Errorf("%s: assessment changed repository files", tc.name)
		}
		if tc.evidence != "" {
			if err := checkQualificationWorkflowEvidence(ollamaTaskText(detail.Current), results, tc.evidence); err != nil {
				t.Errorf("%s: %v", tc.name, err)
			}
		}
		mainRequests := 0
		for _, request := range recorder.snapshot()[start:] {
			if request.Kind == "main" {
				mainRequests++
			}
		}
		report[tc.name] = detail
		report[tc.name+"_observations"] = map[string]any{"main_requests": mainRequests, "tool_calls": calls, "canonical_results": results, "explicit_no_inspection": tc.noTools}
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
	repairResults := qualificationCanonicalResults(t, ctx, svc, detail)
	if err := checkQualificationFixtureRules(repairResults, fixtures); err != nil {
		t.Error(err)
	}
	report["repair_results"] = repairResults
	terminalStart := len(recorder.snapshot())
	detail = send("terminal", fmt.Sprintf("Run this finite command once in %s with yield_ms:0, then observe the existing process until completion: python3 -c 'import time; time.sleep(2); print(7319 * 2)'. Report its result, do not modify files.", workspace))
	if !strings.Contains(ollamaTaskText(detail.Current), "14638") {
		t.Error("terminal output was not reported")
	}
	report["terminal"] = detail
	terminalResults := qualificationCanonicalResults(t, ctx, svc, detail)
	var currentResults []flruntime.ThreadToolResult
	for _, result := range terminalResults {
		var args map[string]any
		_ = json.Unmarshal([]byte(result.Arguments), &args)
		command, _ := args["command"].(string)
		if result.ToolName == "terminal.read" || strings.Contains(command, "time.sleep(2)") {
			currentResults = append(currentResults, result)
		}
	}
	if err := checkQualificationTerminalContinuation(currentResults); err != nil {
		t.Error(err)
	}
	report["terminal_results"] = currentResults
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
		return d.Current.TurnID == identity.TurnID(response.TurnID) && d.Thread.WaitingPrompt != nil
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
		return d.Current.TurnID == identity.TurnID(response.TurnID) && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
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
		return d.Current.TurnID == identity.TurnID(response.TurnID) && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
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

// Canonical receipts retain actual arguments and outcomes, rather than inferring
// effects from tool names or counting provider responses.
func qualificationCanonicalResults(t *testing.T, ctx context.Context, svc *Service, detail *FlowerThreadDetail) []flruntime.ThreadToolResult {
	t.Helper()
	reader, ok := svc.threadRuntime.(flruntime.ThreadToolResultReader)
	if !ok {
		t.Fatal("canonical tool reader unavailable")
	}
	var results []flruntime.ThreadToolResult
	for _, item := range detail.Current.Items {
		if item.TurnID != detail.Current.TurnID || item.Activity == nil || item.Activity.ToolID == "" {
			continue
		}
		result, found, err := reader.LookupToolResult(ctx, flruntime.LookupToolResultInput{ThreadID: identity.ThreadID(detail.Current.ThreadID), TurnID: identity.TurnID(item.TurnID), RunID: identity.RunID(item.RunID), ToolCallID: item.Activity.ToolID})
		if err != nil || !found {
			t.Fatalf("canonical receipt unavailable: found=%v err=%v", found, err)
		}
		results = append(results, result)
	}
	return results
}

func qualificationFileSnapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[rel] = string(b)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func checkQualificationTerminalContinuation(results []flruntime.ThreadToolResult) error {
	process := ""
	cursor := float64(0)
	completed := false
	for _, result := range results {
		var args map[string]any
		if err := json.Unmarshal([]byte(result.Arguments), &args); err != nil {
			return err
		}
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(result.Content, "ERROR: ")), &envelope); err != nil {
			return err
		}
		data := envelope.Data
		if result.ToolName == "terminal.exec" {
			if process != "" {
				return fmt.Errorf("finite command was relaunched")
			}
			process, _ = data["process_id"].(string)
			if process == "" {
				return fmt.Errorf("missing process identity")
			}
		} else if result.ToolName == "terminal.read" {
			if process == "" || args["process_id"] != process || args["after_seq"] != cursor {
				return fmt.Errorf("process identity or returned cursor changed")
			}
		} else {
			return fmt.Errorf("unexpected continuation operation: %s", result.ToolName)
		}
		if seq, ok := data["last_seq"].(float64); ok {
			cursor = seq
		}
		status, _ := data["status"].(string)
		completed = status == terminalProcessStatusSuccess
	}
	if !completed {
		return fmt.Errorf("finite command was not observed to completion")
	}
	return nil
}

func TestQualificationTerminalContinuationOracle(t *testing.T) {
	start := flruntime.ThreadToolResult{ToolName: "terminal.exec", Arguments: `{"command":"build"}`, Content: `{"data":{"process_id":"build","status":"running","last_seq":19}}`}
	read := flruntime.ThreadToolResult{ToolName: "terminal.read", Arguments: `{"process_id":"build","after_seq":19}`, Content: `{"data":{"process_id":"build","status":"success","last_seq":20}}`}
	if err := checkQualificationTerminalContinuation([]flruntime.ThreadToolResult{start, read}); err != nil {
		t.Fatal(err)
	}
	for _, results := range [][]flruntime.ThreadToolResult{{start}, {start, start}, {start, {ToolName: "terminal.read", Arguments: `{"process_id":"other","after_seq":19}`, Content: read.Content}}, {start, {ToolName: "terminal.read", Arguments: `{"process_id":"build","after_seq":0}`, Content: read.Content}}} {
		if err := checkQualificationTerminalContinuation(results); err == nil {
			t.Fatal("accepted incomplete/relaunched/wrong-cursor execution")
		}
	}
}

// Fixture contents establish coverage and order without requiring one shell
// spelling. Names in a listing do not count as reading file contents.
func checkQualificationFixtureRules(results []flruntime.ThreadToolResult, fixtures map[string]string) error {
	rules, spec := false, false
	coverage := ""
	for _, result := range results {
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		content := strings.TrimPrefix(result.Content, "ERROR: ")
		if err := json.Unmarshal([]byte(content), &envelope); err != nil {
			if result.Status == "error" {
				continue
			}
			return fmt.Errorf("invalid successful tool receipt: %w", err)
		}
		output, _ := envelope.Data["output"].(string)
		output = strings.ReplaceAll(output, "\r\n", "\n")
		for _, name := range []string{"WORKFLOW.md", "SPEC.md", "calc.py", "test_calc.py"} {
			if strings.Contains(output, fixtures[name]) && !rules {
				return fmt.Errorf("dependent content read before complete rules: %s", name)
			}
		}
		if result.ToolName == "file.edit" || result.ToolName == "file.write" || result.ToolName == "apply_patch" {
			if !rules || !spec {
				return fmt.Errorf("code changed before complete applicable rules/specification")
			}
		}
		coverage += output
		rules = rules || strings.Contains(coverage, fixtures["AGENTS.md"])
		spec = spec || strings.Contains(coverage, fixtures["SPEC.md"])
	}
	return nil
}

func TestQualificationFixtureRuleOracle(t *testing.T) {
	fixtures := map[string]string{"AGENTS.md": "rules complete\n", "SPEC.md": "spec complete\n", "WORKFLOW.md": "workflow complete\n", "calc.py": "source complete\n", "test_calc.py": "tests complete\n"}
	receipt := func(output string) flruntime.ThreadToolResult {
		b, _ := json.Marshal(map[string]any{"data": map[string]any{"output": output}})
		return flruntime.ThreadToolResult{ToolName: "terminal.exec", Content: string(b)}
	}
	rules, spec, source := receipt(fixtures["AGENTS.md"]), receipt(fixtures["SPEC.md"]), receipt(fixtures["calc.py"])
	write := flruntime.ThreadToolResult{ToolName: "file.edit", Content: `{"data":{}}`}
	for _, valid := range [][]flruntime.ThreadToolResult{{rules, source, {Status: "error", Content: "ERROR: rejected before execution"}}, {rules, {Status: "error", Content: "ERROR: " + spec.Content}, write}, {rules, source}, {rules, spec, write}, {receipt("calc.py\nAGENTS.md\n"), rules}, {receipt("rules "), receipt("complete\n"), source}} {
		if err := checkQualificationFixtureRules(valid, fixtures); err != nil {
			t.Fatal(err)
		}
	}
	for _, invalid := range [][]flruntime.ThreadToolResult{{source}, {receipt(fixtures["AGENTS.md"] + fixtures["calc.py"])}, {rules, write}, {receipt("rules comp"), source}} {
		if err := checkQualificationFixtureRules(invalid, fixtures); err == nil {
			t.Fatal("accepted incomplete/out-of-order rule coverage")
		}
	}
}

func checkQualificationWorkflowEvidence(answer string, results []flruntime.ThreadToolResult, target string) error {
	evidence, _ := json.Marshal(results)
	if !strings.Contains(string(evidence), target) {
		return fmt.Errorf("workflow source was not read")
	}
	lower := strings.ToLower(answer)
	if !strings.Contains(lower, "staging") && !strings.Contains(answer, "预发布") {
		return fmt.Errorf("answer omitted repository release target")
	}
	return nil
}

func TestQualificationWorkflowEvidenceOracle(t *testing.T) {
	results := []flruntime.ThreadToolResult{{Content: `{"data":{"output":"Release target: staging-only."}}`}}
	for _, answer := range []string{"仅限 staging 环境", "仅限预发布环境"} {
		if err := checkQualificationWorkflowEvidence(answer, results, "staging-only"); err != nil {
			t.Fatal(err)
		}
	}
	if err := checkQualificationWorkflowEvidence("staging", nil, "staging-only"); err == nil {
		t.Fatal("accepted unsupported claim")
	}
	if err := checkQualificationWorkflowEvidence("默认部署生产环境", results, "staging-only"); err == nil {
		t.Fatal("accepted incorrect release target")
	}
}

func qualificationRuntimeFixtures() map[string]string {
	return map[string]string{
		"AGENTS.md":    "# Fixture rules\nDo not use subagents. Preserve the exported Add function. For workflow assessment, consult WORKFLOW.md. Before changing code, read SPEC.md completely and follow its requirements. Run the existing unittest after the change.\n",
		"WORKFLOW.md":  "Release target: staging-only. Production deployment requires a separate operator request. Verify with python3 -m unittest. No automatic commit or push is required.\n",
		"SPEC.md":      strings.Repeat("Disposable fixture background.\n", 80) + "\nRequired: Add returns the sum. Keep the marker FIXTURE_RULE_READ_7319 as a comment next to Add.\n",
		"calc.py":      "def Add(a, b):\n    return a - b\n",
		"test_calc.py": "import unittest\nfrom calc import Add\nclass TestAdd(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(Add(2, 3), 5)\n        self.assertEqual(Add(-2, 2), 0)\nif __name__ == '__main__':\n    unittest.main()\n"}
}
