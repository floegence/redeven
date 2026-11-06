package ai

import (
	"encoding/json"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

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
