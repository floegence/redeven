package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestComputerActivityPreservesIntentCodeAndOutput(t *testing.T) {
	code := "  await ui.observe();\n" + strings.Repeat("log('page');\n", 1000)
	args := map[string]any{"description": "Find the Google search box", "code": code}
	call := floretActivityForToolCall("computer.exec", args)
	result, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.exec", Status: toolResultStatusSuccess, activityInput: args, Data: map[string]any{
		"target_name": "Managed browser", "target_id": "browser-main", "completed": true,
		"logs": []any{[]any{"Page title", "Google"}}, "observation": map[string]any{"nodes": []any{map[string]any{"role": "textbox", "name": "Search"}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	merged := fltools.MergeActivityPresentations(call, result)
	payload := merged.Payload.(fltools.StructuredActivityPayload)
	if merged.Label != args["description"] {
		t.Fatalf("intent overwritten: %q", merged.Label)
	}
	if len(payload.Inputs) != 1 || payload.Inputs[0].Content != code || payload.Inputs[0].Language != "javascript" {
		t.Fatal("full script missing")
	}
	if !payload.RowsProvided || len(payload.Rows) < 2 {
		t.Fatalf("results missing: %#v", payload)
	}
	body, _ := json.Marshal(payload)
	var record map[string]any
	_ = json.Unmarshal(body, &record)
	public, ok := sanitizeActivityPayloadValue(record, fltools.ActivityRendererStructured, "computer.exec")
	encoded, _ := json.Marshal(public)
	if !ok || !strings.Contains(string(encoded), "Page title") || !strings.Contains(string(encoded), "Search") || !strings.Contains(string(encoded), "javascript") {
		t.Fatalf("public details lost: %s", encoded)
	}
	inputs := public["inputs"].([]any)
	if inputs[0].(map[string]any)["content"] != code {
		t.Fatal("public script truncated or reformatted")
	}
}

func TestStructuredToolsPreserveUsefulResults(t *testing.T) {
	for _, tc := range []struct {
		name string
		data map[string]any
		want string
	}{
		{"rgrep", map[string]any{"matches": []any{map[string]any{"path": "main.go", "line": 12, "text": "func main()"}}}, "func main()"},
		{"find", map[string]any{"results": []any{map[string]any{"path": "main.go", "type": "file"}}}, "main.go"},
		{"read_files", map[string]any{"files": []any{map[string]any{"path": "main.go", "result": map[string]any{"content": "package main"}}}}, "package main"},
		{"use_skill", map[string]any{"name": "browser", "reason": "Inspect web pages", "content": "Observe before clicking"}, "Inspect web pages"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: tc.name, Status: toolResultStatusSuccess, Data: tc.data})
			if err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(activity)
			if !strings.Contains(string(body), tc.want) {
				t.Fatalf("missing detail: %s", body)
			}
		})
	}
}

func TestToolActivityDetailsKeepBoundedTypedResults(t *testing.T) {
	code := "  await ui.observe();\n" + strings.Repeat("// detail\n", 4000)
	for _, name := range []string{"computer.exec", "rgrep", "find", "read_files", "use_skill"} {
		data := map[string]any{"content": code, "logs": []any{[]any{code}}}
		normalized, truncated := normalizeTruncatedToolPayload(name, data)
		if truncated || normalized.(map[string]any)["raw"] != nil {
			t.Fatalf("%s lost its typed result", name)
		}
	}
	row := toolDetailRow("", "", strings.Repeat("界", 30000), fltools.StructuredActivityRowFormatCode, "text", false)
	if !row.Truncated || len(row.Content) > 65536 || !utf8.ValidString(row.Content) {
		t.Fatal("output must be bounded on a valid Unicode boundary")
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.exec", Status: toolResultStatusSuccess})
	if err != nil || !activity.Payload.(fltools.StructuredActivityPayload).RowsProvided || len(activity.Payload.(fltools.StructuredActivityPayload).Rows) != 0 {
		t.Fatalf("explicit empty result missing: %v", err)
	}
}

func TestToolActivityDoesNotExposeSecretTextOrInventFrameAuthority(t *testing.T) {
	call := floretActivityForToolCall("computer.type", map[string]any{"text": "private password"})
	body, _ := json.Marshal(call)
	if strings.Contains(string(body), "private password") {
		t.Fatal("secret text entered presentation")
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.screenshot", Status: toolResultStatusSuccess, Data: map[string]any{"after_frame": "computer://target/" + strings.Repeat("a", 64)}})
	if err != nil || len(activity.TargetRefs) != 0 {
		t.Fatalf("untrusted payload granted frame authority: %+v %v", activity, err)
	}
}

func TestSourceActivityPreservesSavedSources(t *testing.T) {
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "sources", Status: toolResultStatusSuccess, Data: map[string]any{
		"sources": []any{map[string]any{"title": "Documentation", "url": "https://example.test/docs"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	payload := activity.Payload.(fltools.WebSearchActivityPayload)
	if !payload.ResultsProvided || len(payload.Results) != 1 || payload.Results[0].URL != "https://example.test/docs" {
		t.Fatalf("source list lost: %+v", payload)
	}
}

func TestStructuredInputsRespectRegisteredRedactions(t *testing.T) {
	call := floretActivityForToolCall("browser.navigate", map[string]any{"url": "https://user:private@example.test/?token=private"})
	body, _ := json.Marshal(call)
	if strings.Contains(string(body), "private") {
		t.Fatalf("redacted navigation input entered activity: %s", body)
	}
}

func TestStructuredOutputMarksOnlyActualTruncation(t *testing.T) {
	matches := make([]any, structuredActivityRowLimit)
	for i := range matches {
		matches[i] = map[string]any{"path": "main.go", "line": i + 1, "text": "match"}
	}
	rows := structuredToolResults("rgrep", map[string]any{"matches": matches}, nil)
	if rows[len(rows)-1].Truncated {
		t.Fatal("exactly full output is not truncated")
	}
	rows = structuredToolResults("rgrep", map[string]any{"matches": append(matches, matches[0])}, nil)
	if !rows[len(rows)-1].Truncated {
		t.Fatal("omitted output must be explicit")
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "okf.open", Status: toolResultStatusSuccess, Data: map[string]any{"body": strings.Repeat("x", 9000), "truncated": true}})
	if err != nil || !activity.Payload.(fltools.StructuredActivityPayload).Rows[0].Truncated {
		t.Fatalf("knowledge output truncation lost: %v", err)
	}
}
