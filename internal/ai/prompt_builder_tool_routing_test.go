package ai

import (
	"strings"
	"testing"
)

func assertFlowerIdentityPrompt(t *testing.T, prompt string) {
	t.Helper()
	const want = "你是 Flower，Redeven 中的通用助手。你帮助用户解决软件工程、设备使用、信息分析、日常问答、规划和创作等问题。"
	if prompt != want {
		t.Fatalf("core system prompt must contain only the Flower introduction:\ngot: %q\nwant: %q", prompt, want)
	}
}

func assertPromptContains(t *testing.T, prompt string, want string) {
	t.Helper()
	if !strings.Contains(prompt, want) {
		t.Fatalf("prompt missing %q:\n%s", want, prompt)
	}
}

func assertPromptNotContains(t *testing.T, prompt string, forbidden string) {
	t.Helper()
	if strings.Contains(prompt, forbidden) {
		t.Fatalf("prompt unexpectedly contains %q:\n%s", forbidden, prompt)
	}
}

func TestToolDefinitionsRetainTheirOperationContracts(t *testing.T) {
	contracts := map[string][]string{
		"okf.index":        {"Redeven repository knowledge"},
		"okf.search":       {"candidate summaries"},
		"okf.open":         {"Summary and the section catalog"},
		"image.read":       {"exactly one of file_path or a media:v1 locator", "reject target_id"},
		"subagents":        {"direct children", "inherited history does not transfer ownership"},
		"report_to_parent": {"child task managed by your direct parent", "question, blocker", "automatically notifies the parent", "subagents inspect/wait"},
	}
	for _, def := range builtInToolDefinitions() {
		required, ok := contracts[def.Name]
		if !ok {
			continue
		}
		for _, want := range required {
			if !strings.Contains(def.Description, want) {
				t.Errorf("%s definition omits %q", def.Name, want)
			}
		}
		if def.Name == "subagents" {
			assertPromptContains(t, string(def.InputSchema), "1-5 English Title Case words")
		}
		delete(contracts, def.Name)
	}
	if len(contracts) != 0 {
		t.Fatalf("tool definitions missing: %v", contracts)
	}
}
