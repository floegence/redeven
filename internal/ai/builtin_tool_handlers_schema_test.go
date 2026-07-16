package ai

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestBuiltInToolDefinitions_StrictSchemaCompatible(t *testing.T) {
	t.Parallel()

	defs := builtInModelCapabilityDefinitions()
	for _, def := range defs {
		def := def
		t.Run(def.Name, func(t *testing.T) {
			t.Parallel()

			var schema map[string]any
			if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
				t.Fatalf("parse schema: %v", err)
			}
			validateProviderRootSchema(t, def.Name, schema)
			validateStrictObjectSchema(t, def.Name, schema)
		})
	}
}

func TestBuiltInToolDefinitions_ApplyPatchContractIsCanonical(t *testing.T) {
	t.Parallel()

	var applyPatch ToolDef
	for _, def := range builtInToolDefinitions() {
		if def.Name == "apply_patch" {
			applyPatch = def
			break
		}
	}
	if applyPatch.Name == "" {
		t.Fatal("apply_patch definition not found")
	}
	if !strings.Contains(applyPatch.Description, "Use ONLY the canonical Begin/End Patch format") {
		t.Fatalf("description missing canonical patch contract: %q", applyPatch.Description)
	}
	if !strings.Contains(applyPatch.Description, "every content line must start with `+`") {
		t.Fatalf("description missing add-file content-line prefix rule: %q", applyPatch.Description)
	}
	if strings.Contains(applyPatch.Description, "diff --git") {
		t.Fatalf("description should not recommend unified diff: %q", applyPatch.Description)
	}

	var schema map[string]any
	if err := json.Unmarshal(applyPatch.InputSchema, &schema); err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema missing properties: %#v", schema)
	}
	patchSchema, ok := props["patch"].(map[string]any)
	if !ok {
		t.Fatalf("schema missing patch property: %#v", props)
	}
	description := fmt.Sprint(patchSchema["description"])
	if !strings.Contains(description, "*** Begin Patch") || !strings.Contains(description, "*** End Patch") {
		t.Fatalf("patch property description missing canonical envelope: %q", description)
	}
	if !strings.Contains(description, "*** Update File:") || !strings.Contains(description, "@@") {
		t.Fatalf("patch property description missing file op guidance: %q", description)
	}
	if !strings.Contains(description, "every new content line must begin with `+`") {
		t.Fatalf("patch property description missing add-file content-line prefix rule: %q", description)
	}
}

func TestBuiltInToolDefinitions_TerminalSchemasAreCanonical(t *testing.T) {
	t.Parallel()

	var terminalExec, terminalRead, terminalTerminate ToolDef
	for _, def := range builtInToolDefinitions() {
		switch def.Name {
		case "terminal.exec":
			terminalExec = def
		case "terminal.read":
			terminalRead = def
		case "terminal.terminate":
			terminalTerminate = def
		}
	}
	if terminalExec.Name == "" || terminalRead.Name == "" || terminalTerminate.Name == "" {
		t.Fatalf("terminal definitions missing: exec=%q read=%q terminate=%q", terminalExec.Name, terminalRead.Name, terminalTerminate.Name)
	}

	var execSchema map[string]any
	if err := json.Unmarshal(terminalExec.InputSchema, &execSchema); err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	if ap, ok := execSchema["additionalProperties"].(bool); !ok || ap {
		t.Fatalf("terminal.exec must keep a closed schema: %#v", execSchema["additionalProperties"])
	}
	execProps, ok := execSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.exec schema missing properties: %#v", execSchema)
	}
	yieldSchema, ok := execProps["yield_ms"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.exec schema missing yield_ms: %#v", execProps)
	}
	if _, ok := execProps["timeout_ms"]; ok {
		t.Fatalf("terminal.exec schema retained timeout_ms: %#v", execProps)
	}
	if fmt.Sprint(yieldSchema["type"]) != "integer" || fmt.Sprint(yieldSchema["maximum"]) != "30000" {
		t.Fatalf("yield_ms maximum=%v, want 30000", yieldSchema["maximum"])
	}

	var readSchema map[string]any
	if err := json.Unmarshal(terminalRead.InputSchema, &readSchema); err != nil {
		t.Fatalf("parse terminal.read schema: %v", err)
	}
	readProps, ok := readSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.read schema missing properties: %#v", readSchema)
	}
	descriptionSchema, ok := readProps["description"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.read schema missing description: %#v", readProps)
	}
	if fmt.Sprint(descriptionSchema["minLength"]) != "1" || fmt.Sprint(descriptionSchema["maxLength"]) != "120" {
		t.Fatalf("terminal.read description bounds=%#v, want 1..120", descriptionSchema)
	}
	description := strings.ToLower(fmt.Sprint(descriptionSchema["description"]))
	if !strings.Contains(description, "user's language") || !strings.Contains(description, "new output") || !strings.Contains(description, "never use a generic label") {
		t.Fatalf("terminal.read description guidance is incomplete: %q", description)
	}
	afterSeqSchema, ok := readProps["after_seq"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.read schema missing after_seq: %#v", readProps)
	}
	afterSeqDescription := strings.ToLower(fmt.Sprint(afterSeqSchema["description"]))
	if !strings.Contains(afterSeqDescription, "last output sequence already consumed") ||
		!strings.Contains(afterSeqDescription, "previous result's last_seq exactly") ||
		!strings.Contains(afterSeqDescription, "never invent") ||
		!strings.Contains(afterSeqDescription, "never") || !strings.Contains(afterSeqDescription, "backward") {
		t.Fatalf("terminal.read after_seq guidance is incomplete: %q", afterSeqDescription)
	}
	for _, removed := range []string{"wait_ms", "max_bytes"} {
		if _, exists := readProps[removed]; exists {
			t.Fatalf("terminal.read schema retained %s: %#v", removed, readProps)
		}
	}
	required, _ := readSchema["required"].([]any)
	if !containsAnyString(required, "process_id") || !containsAnyString(required, "description") || !containsAnyString(required, "after_seq") {
		t.Fatalf("terminal.read required=%#v, want process_id, description, and after_seq", required)
	}
	toolDescription := strings.ToLower(terminalRead.Description)
	for _, phrase := range []string{
		"read only the new output produced after after_seq",
		"never replays output already consumed",
		"after_seq: 0 for the first read",
		"previous result's last_seq unchanged",
		"empty output means no new output",
		"has_more is true",
		"status is running and has_more is false",
		"new output since after_seq",
	} {
		if !strings.Contains(toolDescription, phrase) {
			t.Fatalf("terminal.read description missing %q: %q", phrase, terminalRead.Description)
		}
	}

	var terminateSchema map[string]any
	if err := json.Unmarshal(terminalTerminate.InputSchema, &terminateSchema); err != nil {
		t.Fatalf("parse terminal.terminate schema: %v", err)
	}
	terminateProps, ok := terminateSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.terminate schema missing properties: %#v", terminateSchema)
	}
	terminateDescriptionSchema, ok := terminateProps["description"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.terminate schema missing description: %#v", terminateProps)
	}
	if fmt.Sprint(terminateDescriptionSchema["minLength"]) != "1" || fmt.Sprint(terminateDescriptionSchema["maxLength"]) != "120" {
		t.Fatalf("terminal.terminate description bounds=%#v, want 1..120", terminateDescriptionSchema)
	}
	terminateDescription := strings.ToLower(fmt.Sprint(terminateDescriptionSchema["description"]))
	if !strings.Contains(terminateDescription, "user's language") || !strings.Contains(terminateDescription, "command or task being stopped") || !strings.Contains(terminateDescription, "never use a generic label") {
		t.Fatalf("terminal.terminate description guidance is incomplete: %q", terminateDescription)
	}
	terminateRequired, _ := terminateSchema["required"].([]any)
	if !containsAnyString(terminateRequired, "process_id") || !containsAnyString(terminateRequired, "description") {
		t.Fatalf("terminal.terminate required=%#v, want process_id and description", terminateRequired)
	}
	terminateToolDescription := strings.ToLower(terminalTerminate.Description)
	if !strings.Contains(terminateToolDescription, "every call") || !strings.Contains(terminateToolDescription, "user's language") || !strings.Contains(terminateToolDescription, "command or task being stopped") {
		t.Fatalf("terminal.terminate tool description is incomplete: %q", terminalTerminate.Description)
	}
}

func TestBuiltInToolDefinitions_TargetScopedToolsExposeTargetID(t *testing.T) {
	t.Parallel()

	targetScoped := map[string]bool{
		"file.read":   true,
		"file.edit":   true,
		"file.write":  true,
		"apply_patch": true,
	}
	seen := map[string]bool{}
	for _, def := range builtInToolDefinitions() {
		if !targetScoped[def.Name] {
			continue
		}
		seen[def.Name] = true
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatalf("%s parse schema: %v", def.Name, err)
		}
		props, ok := schema["properties"].(map[string]any)
		if !ok {
			t.Fatalf("%s schema missing properties", def.Name)
		}
		targetID, ok := props["target_id"].(map[string]any)
		if !ok {
			t.Fatalf("%s schema missing target_id", def.Name)
		}
		if fmt.Sprint(targetID["type"]) != "string" {
			t.Fatalf("%s target_id type=%v, want string", def.Name, targetID["type"])
		}
		description := strings.TrimSpace(fmt.Sprint(targetID["description"]))
		if !strings.Contains(description, "explicitly routes") || strings.Contains(description, "before the thread starts") {
			t.Fatalf("%s target_id description should avoid implicit remote execution wording: %q", def.Name, description)
		}
	}
	for name := range targetScoped {
		if !seen[name] {
			t.Fatalf("target-scoped tool %s not found", name)
		}
	}
}

func validateProviderRootSchema(t *testing.T, toolName string, schema map[string]any) {
	t.Helper()
	disallowed := []string{"oneOf", "anyOf", "allOf", "enum", "not"}
	for _, key := range disallowed {
		if _, exists := schema[key]; exists {
			t.Fatalf("%s: provider-incompatible top-level key %q", toolName, key)
		}
	}
}

func validateStrictObjectSchema(t *testing.T, path string, schema map[string]any) {
	t.Helper()
	if schema == nil {
		t.Fatalf("%s: schema is nil", path)
	}
	typ := strings.TrimSpace(fmt.Sprint(schema["type"]))
	if typ == "" {
		t.Fatalf("%s: missing type", path)
	}
	switch typ {
	case "object":
		ap, ok := schema["additionalProperties"]
		if !ok {
			t.Fatalf("%s: missing additionalProperties", path)
		}
		if b, ok := ap.(bool); !ok || b {
			t.Fatalf("%s: additionalProperties must be false", path)
		}
		props, ok := schema["properties"].(map[string]any)
		if !ok {
			return
		}
		for name, raw := range props {
			child, ok := raw.(map[string]any)
			if !ok {
				t.Fatalf("%s.%s: property schema must be object", path, name)
			}
			validateStrictObjectSchema(t, path+"."+name, child)
		}
	case "array":
		rawItems, ok := schema["items"]
		if !ok {
			t.Fatalf("%s: array schema missing items", path)
		}
		child, ok := rawItems.(map[string]any)
		if !ok {
			t.Fatalf("%s: array items schema must be object", path)
		}
		validateStrictObjectSchema(t, path+"[]", child)
	default:
		return
	}
}
