package ai

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestBuiltInToolDefinitions_StrictSchemaCompatible(t *testing.T) {
	t.Parallel()

	defs := builtInToolDefinitions()
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

func TestBuiltInToolDefinitions_TargetScopedToolsExposeTargetID(t *testing.T) {
	t.Parallel()

	targetScoped := map[string]bool{
		"file.read":     true,
		"file.edit":     true,
		"file.write":    true,
		"apply_patch":   true,
		"terminal.exec": true,
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
