package ai

import (
	"encoding/json"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestPluginAuthorStatusRetainsNamingContextInLargeModelResult(t *testing.T) {
	encoded, err := encodeModelToolResult(ToolResult{ToolName: "plugin_author.status", Status: toolResultStatusSuccess, Data: map[string]any{
		"project":   map[string]any{"title": "Focus timer", "revision": 17},
		"workspace": map[string]any{"source_directory": "/managed/project/source"},
		"artifacts": []any{map[string]any{"artifact_id": "latest-build", "stages": strings.Repeat("build evidence ", 1000)}},
		"build":     map[string]any{"status": "failed", "error": strings.Repeat("compiler diagnostic ", 1000)},
	}})
	if err != nil {
		t.Fatal(err)
	}
	data, ok := encoded.result.Data.(map[string]any)
	if !ok || data["project"] == nil || data["workspace"] == nil {
		t.Fatal("status lost the structured project and source context needed to rename")
	}
	project := data["project"].(map[string]any)
	if project["revision"] != json.Number("17") || project["title"] != "Focus timer" {
		t.Fatal(project)
	}
	if !encoded.result.Truncated || len(encoded.text) > 16000 {
		t.Fatal("large build evidence must remain bounded and explicitly truncated")
	}
}

func TestPluginAuthorToolDefinitionsRespectRuntimeEffects(t *testing.T) {
	for _, def := range builtInPluginAuthorToolDefinitions() {
		normalized, err := floretToolDefinitionForSnapshot(def, PermissionSnapshot{PermissionType: "full_access"})
		if err != nil {
			t.Fatal(def.Name, err)
		}
		if _, err = fltools.ValidateDefinition(normalized); err != nil {
			t.Fatal(def.Name, err)
		}
		if def.Name == "plugin_author.build" && !def.HasCapability(ToolCapabilityShell) {
			t.Fatal("build lost command approval boundary")
		}
		if def.Name != "plugin_author.status" && !def.RequiresApproval {
			t.Fatal("mutation bypasses approval", def.Name)
		}
	}
}

func TestPluginAuthorInitializationUsesOnlyAnAuthorSlug(t *testing.T) {
	for _, def := range builtInPluginAuthorToolDefinitions() {
		if def.Name != "plugin_author.initialize" {
			continue
		}
		var schema struct {
			Properties map[string]json.RawMessage `json:"properties"`
			Required   []string                   `json:"required"`
		}
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		if _, ok := schema.Properties["slug"]; !ok {
			t.Fatal("author must select a short slug")
		}
		for _, retired := range []string{"plugin_id", "publisher_id", "repository_id"} {
			if _, ok := schema.Properties[retired]; ok {
				t.Fatal("generated identity exposed as author input", retired)
			}
		}
		if len(schema.Required) != 3 || schema.Required[0] != "slug" {
			t.Fatalf("unexpected initialization inputs: %v", schema.Required)
		}
		return
	}
	t.Fatal("missing initialize tool")
}
