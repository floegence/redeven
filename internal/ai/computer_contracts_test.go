package ai

import (
	"encoding/json"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestComputerNavigationNativeURLs(t *testing.T) {
	for _, value := range []string{"file:///tmp/animation.html", "file:///tmp/animation preview.html", "data:text/html,Hello world", "data:text/html,<h1>Animation</h1>", "about:blank", "chrome://version/", "chrome-extension://abcdef/page.html", "custom-browser:document", "https://user:secret@example.test/path"} {
		parsed, err := parseComputerNavigationURL(value)
		if err != nil {
			t.Fatalf("native URL rejected: %s: %v", value, err)
		}
		if strings.Contains(normalizedComputerNavigationURL(parsed), "secret") {
			t.Fatal("credentials entered approval resources")
		}
	}
	for _, value := range []string{"relative.html", "//example.test/path", "file:///tmp/\nsecret", "file:///tmp/end\n", "http://[broken", strings.Repeat("a", 4097)} {
		if _, err := parseComputerNavigationURL(value); err == nil {
			t.Fatalf("invalid URL accepted: %q", value)
		}
	}
}

func TestComputerRoleOnlyAndExactSelectorContracts(t *testing.T) {
	for _, selector := range []map[string]any{{"canonical_role": "button"}, {"canonical_role": "img", "name": "Animation", "exact": true}, {"canonical_role": "image", "name": "Animation", "root_ref": "root", "exact": false}} {
		args, _ := json.Marshal(map[string]any{"action": "read", "selector": selector})
		call, err := resolveComputerCanonicalSelector(TargetToolCall{Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		var projected map[string]any
		_ = json.Unmarshal(call.Arguments, &projected)
		got := projected["selector"].(map[string]any)
		if got["exact"] != selector["exact"] || got["name"] != selector["name"] {
			t.Fatalf("selector semantics changed: %s", call.Arguments)
		}
		if selector["canonical_role"] == "img" && !strings.Contains(string(call.Arguments), "AXImage") {
			t.Fatal("img did not use canonical image roles")
		}
	}
}

func TestComputerScriptErrorClassifications(t *testing.T) {
	for _, code := range []string{"STALE_REFERENCE", "AMBIGUOUS_ELEMENT", "ELEMENT_NOT_FOUND", "TARGET_OBSERVATION_UNAVAILABLE", "TARGET_CAPABILITY_UNAVAILABLE", "NAVIGATION_FAILED", "NAVIGATION_TIMEOUT", "TARGET_PERMISSION_REQUIRED"} {
		if got := computerScriptErrorCode(code); string(got) != code {
			t.Fatalf("%s became %s", code, got)
		}
	}
	if computerScriptErrorCode("SCRIPT_STOPPED") != aitools.ErrorCodeScriptFailed {
		t.Fatal("known script failure became an unknown effect")
	}
}

func TestComputerNavigationDefinitionMatchesRuntimeAndPrompt(t *testing.T) {
	for _, definition := range builtInComputerToolDefinitions() {
		if definition.Name != "browser.navigate" {
			continue
		}
		var schema map[string]any
		if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		urlSchema := schema["properties"].(map[string]any)["url"].(map[string]any)
		if urlSchema["enum"] != nil || urlSchema["pattern"] != nil || urlSchema["maxLength"] != float64(maxComputerNavigationURLLength) {
			t.Fatalf("navigation schema narrows native URLs: %+v", urlSchema)
		}
		prompt := renderPromptSections([]promptSection{buildPromptComputerUseCapabilitySection(promptRuntimeSnapshot{AvailableToolNames: "computer.screenshot,computer.targets,computer.select_target,computer.observe,computer.exec,browser.navigate"})})
		for _, term := range []string{"file://", "data:", "about:"} {
			if !strings.Contains(strings.ToLower(definition.Description), strings.ToLower(term)) {
				t.Fatalf("definition omits %q", term)
			}
		}
		for _, term := range []string{"Approval Required", "observe"} {
			if !strings.Contains(prompt, term) {
				t.Fatalf("prompt omits policy %q", term)
			}
		}
		return
	}
	t.Fatal("browser navigation definition missing")
}
