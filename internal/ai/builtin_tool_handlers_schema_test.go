package ai

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
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

func TestAskUserResponseModesMatchFloret(t *testing.T) {
	coreDefinitions := flruntime.CoreControlDefinitions()
	if len(coreDefinitions) != 1 || coreDefinitions[0].Name != flruntime.CoreControlAskUser {
		t.Fatalf("Floret control definitions = %#v", coreDefinitions)
	}

	var redevenDefinition ToolDef
	for _, definition := range builtInControlSignalDefinitions() {
		if definition.Name == flruntime.CoreControlAskUser {
			redevenDefinition = definition
			break
		}
	}
	if redevenDefinition.Name == "" {
		t.Fatal("Redeven ask_user definition not found")
	}
	var redevenSchema map[string]any
	if err := json.Unmarshal(redevenDefinition.InputSchema, &redevenSchema); err != nil {
		t.Fatalf("parse Redeven ask_user schema: %v", err)
	}

	coreModes := schemaResponseModeEnum(t, coreDefinitions[0].InputSchema)
	redevenModes := schemaResponseModeEnum(t, redevenSchema)
	wantModes := []any{"write", "select_or_write"}
	if !reflect.DeepEqual(coreModes, wantModes) {
		t.Fatalf("Floret response_mode enum = %#v, want %#v", coreModes, wantModes)
	}
	if !reflect.DeepEqual(redevenModes, coreModes) {
		t.Fatalf("Redeven response_mode enum = %#v, want Floret enum %#v", redevenModes, coreModes)
	}

	questionProperties := schemaQuestionProperties(t, redevenSchema)
	responseMode := questionProperties["response_mode"].(map[string]any)
	if !strings.Contains(fmt.Sprint(responseMode["description"]), "separate custom-text answer") {
		t.Fatalf("response_mode description omits the custom answer: %q", responseMode["description"])
	}
}

func schemaResponseModeEnum(t *testing.T, schema map[string]any) []any {
	t.Helper()
	questionProperties := schemaQuestionProperties(t, schema)
	responseMode, ok := questionProperties["response_mode"].(map[string]any)
	if !ok {
		t.Fatalf("schema response_mode is missing: %#v", questionProperties)
	}
	switch values := responseMode["enum"].(type) {
	case []string:
		out := make([]any, len(values))
		for index, value := range values {
			out[index] = value
		}
		return out
	case []any:
		return values
	default:
		t.Fatalf("schema response_mode enum is missing: %#v", responseMode)
		return nil
	}
}

func schemaQuestionProperties(t *testing.T, schema map[string]any) map[string]any {
	t.Helper()
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema properties are missing: %#v", schema)
	}
	questions, ok := properties["questions"].(map[string]any)
	if !ok {
		t.Fatalf("schema questions are missing: %#v", properties)
	}
	item, ok := questions["items"].(map[string]any)
	if !ok {
		t.Fatalf("schema question item is missing: %#v", questions)
	}
	questionProperties, ok := item["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema question properties are missing: %#v", item)
	}
	return questionProperties
}

func TestSubagentsSpawnSchemaUsesParentProvidedInstructions(t *testing.T) {
	t.Parallel()

	var definition ToolDef
	for _, item := range builtInToolDefinitions() {
		if item.Name == "subagents" {
			definition = item
			break
		}
	}
	if definition.Name == "" {
		t.Fatal("subagents definition not found")
	}
	var schema map[string]any
	if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema has no properties: %#v", schema)
	}
	spawn, ok := properties["action"].(map[string]any)
	if !ok || !strings.Contains(fmt.Sprint(spawn["enum"]), "spawn") {
		t.Fatalf("schema action does not include spawn: %#v", properties["action"])
	}
	if _, exists := properties["agent_type"]; exists {
		t.Fatal("subagents schema still exposes agent_type")
	}
	for _, required := range []string{"task_name", "task_description", "message"} {
		if _, exists := properties[required]; !exists {
			t.Errorf("subagents schema is missing %q", required)
		}
	}
	if !strings.Contains(definition.Description, "execution authorization in message") || strings.Contains(definition.Description, "agent_type") {
		t.Fatalf("subagents description does not match direct delegation: %q", definition.Description)
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
	if !strings.Contains(applyPatch.Description, "Begin/End Patch") {
		t.Fatalf("description missing canonical patch contract: %q", applyPatch.Description)
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
	if !strings.Contains(description, "Prefix added lines with +") {
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
	stdinSchema, ok := execProps["stdin"].(map[string]any)
	if !ok || !strings.Contains(fmt.Sprint(stdinSchema["description"]), "does not close stdin or send EOF") {
		t.Fatal("terminal.exec stdin must describe its interactive input boundary")
	}
	if !strings.Contains(terminalExec.Description, "exit_code") || !strings.Contains(terminalExec.Description, "status=running") || !strings.Contains(terminalExec.Description, "process_id") || !strings.Contains(terminalExec.Description, "Waits 5 seconds by default") || !strings.Contains(terminalExec.Description, "not the command's runtime") || !strings.Contains(fmt.Sprint(stdinSchema["description"]), "Echo alone is not command completion") {
		t.Fatal("terminal.exec must distinguish completion, running processes and PTY echo")
	}
	yieldDescription := fmt.Sprint(yieldSchema["description"])
	if !strings.Contains(yieldDescription, "omitted or 0 uses 5000") || !strings.Contains(yieldDescription, "command runtime timeout") {
		t.Fatalf("terminal.exec yield_ms description must explain its default and scope: %q", yieldDescription)
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
	if !strings.Contains(description, "user's language") || !strings.Contains(description, "command/task") {
		t.Fatalf("terminal.read description guidance is incomplete: %q", description)
	}
	afterSeqSchema, ok := readProps["after_seq"].(map[string]any)
	if !ok {
		t.Fatalf("terminal.read schema missing after_seq: %#v", readProps)
	}
	afterSeqDescription := strings.ToLower(fmt.Sprint(afterSeqSchema["description"]))
	if !strings.Contains(afterSeqDescription, "0 for the first read") || !strings.Contains(afterSeqDescription, "previous result's last_seq unchanged") {
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
		"new output after after_seq",
		fmt.Sprintf("waiting up to %d seconds", terminalProcessModelReadWaitMS/1000),
		"returning sooner when output arrives or the process ends",
		"wait_expired means only the read window ended",
		"if has_more or you still need the running command's result",
		"running remains active even with empty output and an unchanged cursor",
		"do not restart the command or add sleeps",
		"cancellation interrupts the read",
	} {
		if !strings.Contains(toolDescription, phrase) {
			t.Fatalf("terminal.read description missing %q: %q", phrase, terminalRead.Description)
		}
	}
	if terminalProcessModelReadWaitMS != 60_000 {
		t.Fatalf("model terminal.read wait=%dms, want 60000ms", terminalProcessModelReadWaitMS)
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
	if !strings.Contains(terminateDescription, "user's language") || !strings.Contains(terminateDescription, "command/task being stopped") {
		t.Fatalf("terminal.terminate description guidance is incomplete: %q", terminateDescription)
	}
	terminateRequired, _ := terminateSchema["required"].([]any)
	if !containsAnyString(terminateRequired, "process_id") || !containsAnyString(terminateRequired, "description") {
		t.Fatalf("terminal.terminate required=%#v, want process_id and description", terminateRequired)
	}
}

func TestBuiltInToolDefinitions_TargetScopedToolsExposeTargetID(t *testing.T) {
	t.Parallel()

	targetScoped := map[string]bool{
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
