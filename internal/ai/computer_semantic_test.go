package ai

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func semanticTestTree() map[string]any {
	return map[string]any{
		"semantic_schema_version": 2, "document_id": "fixture:1", "truncated": false,
		"nodes": []any{
			map[string]any{"ref": "root", "role": "AXWindow", "platform_role": "AXWindow", "name": "Settings", "child_refs": []string{"input"}, "states": map[string]any{}, "actions": []string{"read"}},
			map[string]any{"ref": "input", "parent_ref": "root", "child_refs": []string{}, "role": "AXTextField", "platform_role": "AXTextField", "name": "Endpoint", "description": "Enter a valid URL", "states": map[string]any{"invalid": true, "busy": false}, "actions": []string{"read", "fill"}},
		},
	}
}

func TestComputerSemanticSnapshotPreservesTreeAndStates(t *testing.T) {
	got, err := normalizeComputerObservation(semanticTestTree())
	if err != nil {
		t.Fatal(err)
	}
	nodes := got["nodes"].([]any)
	field := nodes[1].(map[string]any)
	if field["canonical_role"] != "textbox" || field["platform_role"] != "AXTextField" || field["description"] != "Enter a valid URL" {
		t.Fatalf("field semantics: %#v", field)
	}
	if got["roots"].([]any)[0] != "root" || field["parent_ref"] != "root" || field["states"].(map[string]any)["invalid"] != true {
		t.Fatalf("tree or state lost: %#v", got)
	}
}

func TestComputerSemanticSnapshotRejectsInvalidProtocolAndGraph(t *testing.T) {
	for _, mutate := range []func(map[string]any){
		func(tree map[string]any) { delete(tree, "semantic_schema_version") },
		func(tree map[string]any) { tree["semantic_schema_version"] = 1 },
		func(tree map[string]any) { tree["nodes"].([]any)[1].(map[string]any)["ref"] = "root" },
		func(tree map[string]any) { tree["nodes"].([]any)[1].(map[string]any)["parent_ref"] = "missing" },
		func(tree map[string]any) {
			tree["nodes"].([]any)[0].(map[string]any)["parent_ref"] = "input"
			tree["nodes"].([]any)[1].(map[string]any)["child_refs"] = []string{"root"}
		},
	} {
		tree := semanticTestTree()
		mutate(tree)
		if _, err := normalizeComputerObservation(tree); err == nil {
			t.Fatal("invalid snapshot accepted")
		}
	}
}

func TestComputerSemanticRolesAndUnknownStates(t *testing.T) {
	for platform, want := range map[string]string{"AXButton": "button", "push button": "button", "text": "textbox", "RootWebArea": "document", "StaticText": "text", "AXCheckBox": "checkbox", "unrecognized": "other"} {
		if got := computerCanonicalRole(platform); got != want {
			t.Fatalf("role %q = %q, want %q", platform, got, want)
		}
	}
	tree := semanticTestTree()
	delete(tree["nodes"].([]any)[1].(map[string]any)["states"].(map[string]any), "busy")
	got, err := normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := got["nodes"].([]any)[1].(map[string]any)["states"].(map[string]any)["busy"]; exists {
		t.Fatal("unknown state fabricated")
	}
}

func TestComputerSemanticSnapshotBoundsAndPrivacy(t *testing.T) {
	tree := semanticTestTree()
	field := tree["nodes"].([]any)[1].(map[string]any)
	field["role"], field["platform_role"], field["value"] = "password text", "password text", "secret"
	if _, err := normalizeComputerObservation(tree); err == nil {
		t.Fatal("protected field accepted")
	}
	tree = semanticTestTree()
	tree["nodes"].([]any)[1].(map[string]any)["bounds"] = map[string]any{"x": 0, "y": 0, "width": -1, "height": 20}
	if _, err := normalizeComputerObservation(tree); err == nil {
		t.Fatal("invalid geometry accepted")
	}
	// Unsupported platform properties never become arbitrary model-visible data.
	tree = semanticTestTree()
	tree["nodes"].([]any)[1].(map[string]any)["internal_secret"] = "secret"
	got, err := normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(got)
	if string(body) == "" || got["nodes"].([]any)[1].(map[string]any)["internal_secret"] != nil {
		t.Fatal("unknown field exported")
	}
}

func semanticFixtureNode(ref, role, name string) map[string]any {
	return map[string]any{"ref": ref, "role": role, "platform_role": role, "name": name, "child_refs": []string{}, "states": map[string]any{}, "actions": []string{"read"}}
}
func semanticFixtureText(name string) map[string]any {
	return map[string]any{"semantic_schema_version": 2, "document_id": name, "nodes": []any{semanticFixtureNode("text", "StaticText", name)}, "truncated": false}
}

func TestComputerSemanticRelationsAndFocus(t *testing.T) {
	tree := semanticTestTree()
	nodes := tree["nodes"].([]any)
	nodes[0].(map[string]any)["states"] = map[string]any{"focused": true}
	field := nodes[1].(map[string]any)
	field["states"] = map[string]any{"focused": true, "checked": "mixed", "invalid": "spelling", "required": true, "busy": true}
	field["relations"] = map[string][]string{"described_by": {"root"}}
	got, err := normalizeComputerObservation(tree)
	if err != nil || got["focus_ref"] != "input" {
		t.Fatalf("nested platform focus: %v %v", got, err)
	}
	if got["nodes"].([]any)[1].(map[string]any)["relations"].(map[string]any)["described_by"].([]any)[0] != "root" {
		t.Fatal("description relation lost")
	}
	field["relations"] = map[string][]string{"controls": {"missing"}}
	if _, err := normalizeComputerObservation(tree); err == nil {
		t.Fatal("dangling relation accepted")
	}
	field["relations"] = map[string][]string{"controls": {"root", "root"}}
	if _, err := normalizeComputerObservation(tree); err == nil {
		t.Fatal("duplicate relation accepted")
	}
	delete(field, "relations")
	tree["nodes"] = append(nodes, semanticFixtureNode("other", "button", "Other"))
	tree["nodes"].([]any)[2].(map[string]any)["states"] = map[string]any{"focused": true}
	got, err = normalizeComputerObservation(tree)
	if err != nil || got["focus_ref"] != nil {
		t.Fatalf("unrelated platform focus must remain unspecified: %v %v", got, err)
	}
}

func TestComputerSemanticByteBudgetPreservesTree(t *testing.T) {
	tree := semanticTestTree()
	nodes := tree["nodes"].([]any)
	for i := 0; i < 150; i++ {
		ref := strings.Repeat("x", i+1)
		node := semanticFixtureNode(ref, "StaticText", strings.Repeat("a", 2000))
		node["parent_ref"] = "root"
		nodes[0].(map[string]any)["child_refs"] = append(nodes[0].(map[string]any)["child_refs"].([]string), ref)
		nodes = append(nodes, node)
	}
	tree["nodes"] = nodes
	got, err := normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(got)
	if len(body) > computerSemanticMaxBytes || got["truncated"] != true || len(got["nodes"].([]any)) >= len(nodes) {
		t.Fatalf("unbounded snapshot: %d bytes", len(body))
	}
	if _, err := normalizeComputerObservation(got); err != nil {
		t.Fatalf("pruned snapshot is not self-consistent: %v", err)
	}
}

func TestComputerSemanticPortableSelectorUsesAuthoritativeRoles(t *testing.T) {
	for _, role := range []string{"tabpanel", "listbox", "option", "radiogroup", "tooltip", "separator"} {
		if computerCanonicalRole(role) != role {
			t.Fatalf("product semantic role %q is not portable", role)
		}
	}
	for canonical, aliases := range computerRoleAliases {
		for _, alias := range aliases {
			if computerCanonicalRole(alias) != canonical {
				t.Fatalf("conflicting alias %q", alias)
			}
		}
		args, _ := json.Marshal(map[string]any{"action": "wait", "selector": map[string]any{"canonical_role": canonical, "name": "Later control", "root_ref": "root"}})
		call, err := resolveComputerCanonicalSelector(TargetToolCall{Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		_ = json.Unmarshal(call.Arguments, &decoded)
		selector := decoded["selector"].(map[string]any)
		if selector["canonical_role"] != nil || selector["root_ref"] != "root" || len(selector["roles"].([]any)) != len(aliases) {
			t.Fatalf("selector projection: %s", call.Arguments)
		}
	}
	for _, selector := range []map[string]any{{"canonical_role": "other", "name": "Unknown"}, {"canonical_role": "button", "name": "Apply", "role": "AXButton"}, {"canonical_role": "button", "name": "Apply", "root_ref": 1}} {
		args, _ := json.Marshal(map[string]any{"selector": selector})
		if _, err := resolveComputerCanonicalSelector(TargetToolCall{Arguments: args}); err == nil {
			t.Fatal("invalid selector accepted")
		}
	}
}

func TestComputerSemanticScriptDispatchesPortableSelector(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		calls++
		var arguments struct {
			Selector struct {
				Roles         []string `json:"roles"`
				CanonicalRole string   `json:"canonical_role"`
				Name          string   `json:"name"`
				Root          string   `json:"root_ref"`
			} `json:"selector"`
		}
		if err := json.Unmarshal(call.Arguments, &arguments); err != nil {
			t.Fatal(err)
		}
		selector := arguments.Selector
		if !slices.Equal(selector.Roles, computerRoleAliases["textbox"]) || selector.CanonicalRole != "" || selector.Name != "Endpoint" || selector.Root != "root" {
			t.Errorf("adapter received unresolved selector: %s", call.Arguments)
			return TargetToolResult{}, computerTargetFailure(call, "INVALID_REQUEST")
		}
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, `await ui.getByRole('textbox', {name:'Endpoint',root_ref:'root'}).fill('https://example.test');`)
	if err != nil || calls != 1 || result.Result.(map[string]any)["completed"] != true {
		t.Fatalf("portable script did not reach the adapter: %+v %v", result, err)
	}
}

func TestComputerSemanticStateDiffAndDocumentReset(t *testing.T) {
	var output computerObservationOutput
	tree := semanticTestTree()
	first, _ := normalizeComputerObservation(tree)
	if output.render(first, "", false).(map[string]any)["format"] != "full" {
		t.Fatal("first tree was not full")
	}
	field := tree["nodes"].([]any)[1].(map[string]any)
	field["states"] = map[string]any{"busy": true, "invalid": false}
	second, _ := normalizeComputerObservation(tree)
	diff := output.render(second, "", false).(map[string]any)
	if diff["format"] != "diff" || len(diff["nodes"].([]any)) != 1 || diff["nodes"].([]any)[0].(map[string]any)["states"].(map[string]any)["busy"] != true {
		t.Fatalf("state diff lost: %v", diff)
	}
	tree["document_id"] = "fixture:2"
	third, _ := normalizeComputerObservation(tree)
	if output.render(third, "", false).(map[string]any)["format"] != "full" {
		t.Fatal("different revision reused prior diff")
	}
}

func TestComputerSemanticRuntimeRejectsContentWithoutReplayingEffect(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		calls++
		tree := semanticTestTree()
		field := tree["nodes"].([]any)[1].(map[string]any)
		field["role"], field["platform_role"], field["platform_subrole"], field["value"] = "AXTextField", "AXTextField", "AXSecureTextField", "private content"
		return TargetToolResult{Result: map[string]any{"observation": tree, "action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, `await ui.click(1,2); await ui.click(3,4);`)
	if err == nil || calls != 1 {
		t.Fatalf("failed observation replayed: %v, calls=%d", err, calls)
	}
	payload := result.Result.(map[string]any)
	body, _ := json.Marshal(payload)
	if payload["observation"] != nil || strings.Contains(string(body), "private content") || payload["action_executed"] != true {
		t.Fatalf("unsafe failure projection: %s", body)
	}
	if !slices.Contains(payload["completed_actions"].([]string), "pointer_click") {
		t.Fatal("confirmed effect lost")
	}
}
