package ai

import (
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
