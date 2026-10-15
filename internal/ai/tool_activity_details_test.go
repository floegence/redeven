package ai

import (
	"encoding/json"
	"fmt"
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

func TestComputerActivityDescriptionsRequiredForEveryInvocation(t *testing.T) {
	for _, definition := range builtInComputerToolDefinitions() {
		var schema struct {
			Properties map[string]json.RawMessage `json:"properties"`
			Required   []string                   `json:"required"`
		}
		if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		if schema.Properties["description"] == nil || !strings.Contains(strings.Join(schema.Required, ","), "description") {
			t.Errorf("%s must require invocation intent", definition.Name)
		}
	}
}

func TestComputerActivityReturnsConcreteCandidates(t *testing.T) {
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.targets", Status: toolResultStatusSuccess,
		activityInput: map[string]any{"description": "Find a browser for the preview"}, Data: ComputerTargetInventory{DefaultCandidateRef: "candidate-new", Candidates: []ComputerCandidate{
			{CandidateRef: "candidate-new", Kind: "browser.connected", DisplayName: "Chrome", NewTab: true, State: "ready"},
			{CandidateRef: "candidate-page", Kind: "browser.connected", DisplayName: "Chrome", Title: "Project", URL: "https://example.test/project", State: "ready"},
		}}})
	if err != nil {
		t.Fatal(err)
	}
	payload := activity.Payload.(fltools.StructuredActivityPayload)
	if len(payload.Rows) != 2 || !strings.Contains(payload.Rows[1].Content, "example.test/project") {
		t.Fatalf("actual candidates missing: %+v", payload)
	}
	encoded, _ := json.Marshal(payload.Rows)
	if strings.Contains(string(encoded), "candidate-") {
		t.Fatal("opaque references entered readable results")
	}
}

func TestComputerActivityReadsOuterPageAndSemanticContent(t *testing.T) {
	rows := structuredToolResults("computer.observe", map[string]any{"title": "Weather", "url": "file:///private/weather.html",
		"observation": map[string]any{"nodes": []any{
			map[string]any{"role": "RootWebArea", "canonical_role": "document", "name": ""},
			map[string]any{"role": "StaticText", "canonical_role": "text", "name": "Beijing 23°C"},
			map[string]any{"role": "AXTextField", "canonical_role": "searchbox", "name": "City", "value": "Beijing"},
		}}}, nil)
	encoded, _ := json.Marshal(rows)
	text := string(encoded)
	for _, want := range []string{"Weather", "weather.html", "Beijing 23°C", "City"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s: %s", want, text)
		}
	}
	for _, noise := range []string{"RootWebArea", "StaticText", "AXTextField", "/private/"} {
		if strings.Contains(text, noise) {
			t.Errorf("technical noise %s: %s", noise, text)
		}
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

func TestCanvasReadKeepsLiteralTypedResult(t *testing.T) {
	yaml := "metadata:\n  title: Readable canvas\n" + strings.Repeat("# unchanged context\n", 500)
	data, truncated := normalizeTruncatedToolPayload("tessiven.read", map[string]any{"title": "Readable canvas", "version": int64(3), "document_yaml": yaml})
	if truncated || data.(map[string]any)["document_yaml"] != yaml {
		t.Fatal("bounded YAML was converted to truncated JSON")
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "tessiven.read", Status: toolResultStatusSuccess, Data: data})
	if err != nil {
		t.Fatal(err)
	}
	if activity.Label != "Readable canvas" {
		t.Fatal(activity.Label)
	}
	body, _ := json.Marshal(activity)
	if !strings.Contains(string(body), "unchanged context") || !strings.Contains(string(body), "yaml") {
		t.Fatalf("literal result not visible: %s", body)
	}
}

func TestCanvasEditDetailsKeepReplacementFragmentsWithinOneCodeRow(t *testing.T) {
	edits := []any{}
	for i := 0; i < 50; i++ {
		edits = append(edits, map[string]any{"old_string": fmt.Sprintf("name: Before %d\nkind: api", i), "new_string": fmt.Sprintf("name: After %d\nkind: api", i)})
	}
	activity := floretActivityForToolCall("tessiven.edit", map[string]any{"summary": "Rename services", "edits": edits})
	payload := activity.Payload.(fltools.StructuredActivityPayload)
	if len(payload.Inputs) != 2 {
		t.Fatalf("batch exceeded activity input budget: %+v", payload)
	}
	var diff string
	for _, row := range payload.Inputs {
		if row.Language == "diff" {
			diff = row.Content
		}
	}
	if !strings.Contains(diff, "-name: Before 0\n-kind: api\n+name: After 0\n+kind: api") || !strings.Contains(diff, "+name: After 49") {
		t.Fatalf("replacement fragments not preserved: %s", diff)
	}
}

func TestComputerActivityResultFactsAndSafeResources(t *testing.T) {
	for _, tc := range []struct {
		name, tool, outcome string
		data                map[string]any
	}{
		{"empty inventory", "computer.targets", "no_targets", map[string]any{"candidates": []any{}}},
		{"selected browser", "computer.select_target", "selected", map[string]any{"selected": true, "target_kind": "browser.connected"}},
		{"blank document", "computer.observe", "empty_page", map[string]any{"url": "about:blank", "nodes": []any{map[string]any{"role": "RootWebArea"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: tc.tool, Status: toolResultStatusSuccess, activityInput: map[string]any{"description": "Inspect the target"}, Data: tc.data})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, chip := range activity.Chips {
				if chip.Kind == "computer_result" && chip.Value == tc.outcome {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing actual result: %+v", activity.Chips)
			}
			payload := activity.Payload.(fltools.StructuredActivityPayload)
			if !payload.RowsProvided || len(payload.Rows) != 0 || len(payload.Inputs) != 0 {
				t.Fatalf("empty confirmation acquired detail noise: %+v", payload)
			}
		})
	}
	rows := computerActivityResultRows("computer.targets", map[string]any{"default_candidate_ref": "default", "candidates": []any{
		map[string]any{"display_name": "Chrome", "candidate_ref": "other", "url": "https://user:secret@example.test/weather?token=private#fragment"},
		map[string]any{"display_name": "Chrome", "candidate_ref": "default", "new_tab": true, "state": "ready"},
	}})
	if rows[0].Meta != "default new_tab" {
		t.Fatalf("default lost from initial preview: %+v", rows)
	}
	body, _ := json.Marshal(fltools.StructuredActivityPayload{Rows: rows, RowsProvided: true})
	var record map[string]any
	_ = json.Unmarshal(body, &record)
	public, ok := sanitizeActivityPayloadValue(record, fltools.ActivityRendererStructured, "computer.targets")
	encoded, _ := json.Marshal(public)
	if !ok || !strings.Contains(string(encoded), "https://example.test/weather") || !strings.Contains(string(encoded), "default new_tab") {
		t.Fatalf("public candidate facts lost: %s", encoded)
	}
	for _, private := range []string{"secret", "private", "fragment", "candidate_ref"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("private resource entered public detail: %s", encoded)
		}
	}
	if got := computerActivityURL("file:///private/user/preview.html"); got != "preview.html" {
		t.Fatal(got)
	}
}

func TestComputerActivityPreservesPartialAndBoundedResults(t *testing.T) {
	controls := computerActivityResultRows("computer.observe", map[string]any{"nodes": []any{map[string]any{"canonical_role": "textbox", "name": "Notes", "value": strings.Repeat("文", activityPayloadStringLimit+1)}}})
	if len(controls) != 1 || !controls[0].Truncated || !utf8.ValidString(controls[0].Content) {
		t.Fatalf("bounded control value lost its truncation marker: %+v", controls)
	}
	data := map[string]any{"completed": false, "completed_actions": []any{"navigate"}, "observation": map[string]any{"title": "Weather", "format": "diff", "truncated": true, "nodes": []any{map[string]any{"role": "StaticText", "name": "Beijing 23°C"}}}}
	rows := computerActivityResultRows("computer.exec", data)
	if len(rows) != 2 || rows[0].Meta != "page_changes" || rows[1].Meta != "completed_actions" || rows[1].Content != "navigate" || !rows[1].Truncated {
		t.Fatalf("partial result lost: %+v", rows)
	}
	if computerActivityBlankPage(map[string]any{"url": "about:blank", "format": "diff", "nodes": []any{}}) {
		t.Fatal("an empty diff is not a blank page")
	}
	if computerActivityBlankPage(map[string]any{"url": "about:blank", "truncated": true, "nodes": []any{}}) {
		t.Fatal("truncated output cannot prove a blank page")
	}
	candidates := make([]any, structuredActivityRowLimit+1)
	for i := range candidates {
		candidates[i] = map[string]any{"display_name": fmt.Sprintf("Window %d", i)}
	}
	rows = computerActivityResultRows("computer.targets", map[string]any{"candidates": candidates})
	if len(rows) != structuredActivityRowLimit || !rows[len(rows)-1].Truncated {
		t.Fatal("candidate output must stay bounded with explicit truncation")
	}
}
