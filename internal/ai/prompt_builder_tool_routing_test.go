package ai

import (
	"strings"
	"testing"
)

func assertFlowerSystemPrompt(t *testing.T, prompt string) {
	t.Helper()
	const want = flowerIdentityIntroduction + "\n\n" + flowerExecutionInstruction + "\n\n" + flowerHTMLPreviewInstruction + "\n\n" + flowerTaskFilesInstruction + "\n\n" + flowerFileDeliveryInstruction
	if prompt != want {
		t.Fatalf("core system prompt differs from its expected contract:\ngot: %q\nwant: %q", prompt, want)
	}
	if !strings.Contains(prompt, "For 3D scenes, use WebGL directly; do not use Three.js.") {
		t.Fatal("core system prompt must require direct WebGL and prohibit Three.js for 3D scenes")
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

func TestFlowerPromptFileDeliveryContract(t *testing.T) {
	prompt := buildFlowerSystemPrompt()
	for _, required := range []string{
		"local file you created or confirmed exists",
		"clickable Markdown link with a clear file name or title and the full absolute path",
		"[Report](/workspace/report.html)",
		"Never use a plain or inline-code path as the only delivery entry point",
		"Wrap link destinations containing spaces or parentheses in angle brackets",
		"[Report](</workspace/report (final).html>)",
		"Do not invent paths or use file:// links",
		"Paths inside commands and code examples may remain code",
	} {
		if !strings.Contains(prompt, required) {
			t.Errorf("file delivery instruction missing %q", required)
		}
	}
}

func TestToolDefinitionsRetainTheirOperationContracts(t *testing.T) {
	contracts := map[string][]string{
		"okf.index":        {"Redeven repository knowledge"},
		"okf.search":       {"candidate summaries"},
		"okf.open":         {"Summary and the section catalog"},
		"image.read":       {"exactly one of file_path or a media:v1 locator", "reject target_id"},
		"subagents":        {"direct child threads", "inherited history does not transfer ownership"},
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
