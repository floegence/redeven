package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/toolnames"
)

func TestFirstPartyToolNamingContract(t *testing.T) {
	seen := map[string]bool{}
	for _, def := range builtInModelCapabilityDefinitions() {
		if err := toolnames.Validate(def.Name); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(def.Name, "_") || !toolnames.IsFirstParty(def.Name) {
			t.Fatalf("tool %q is absent from the reviewed name catalog", def.Name)
		}
		if seen[def.Name] {
			t.Fatalf("duplicate %s", def.Name)
		}
		seen[def.Name] = true
		if strings.Contains(def.Description, "Documentation name:") {
			t.Fatal("provider alias guidance returned")
		}
	}
	for _, old := range []string{"terminal.exec", "read_file", "find", "ask_user"} {
		if seen[old] {
			t.Fatalf("legacy alias exposed: %s", old)
		}
	}
}
func TestMCPToolNamesArePortableDistinctAndStable(t *testing.T) {
	tool := mcpToolRecord{Name: "A.Tool / 名称", Schema: json.RawMessage(`{"type":"object"}`)}
	a := mcpServerRecord{MCPServerInput: MCPServerInput{ID: "server-with-hyphens", Name: "Example"}}
	b := a
	b.ID = "server_with_hyphens"
	first := mcpToolName(a, tool)
	// Frozen names from the released pre-migration algorithms, including their
	// exact configuration fingerprint; allowlist migration must reach dispatch.
	if first != toolnames.MigrateAllowlistName("mcp_server-with-hyphens_b6ebe4059a78f72b") {
		t.Fatal("released MCP allowlist lost its capability")
	}
	if err := toolnames.Validate(first); err != nil {
		t.Fatal(err)
	}
	if first != mcpToolName(a, tool) || first == mcpToolName(b, tool) {
		t.Fatal("unstable or colliding MCP name")
	}
	a.pluginID = "plugin"
	if mcpToolName(a, tool) != toolnames.MigrateAllowlistName("mcp_server-with-hyphens_aa5fa3b59088fac4") {
		t.Fatal("released plugin MCP allowlist lost its capability")
	}
	if err := toolnames.Validate(mcpToolName(a, tool)); err != nil {
		t.Fatal(err)
	}
}

func TestBrowserScriptMethodsKeepTheirJavaScriptNames(t *testing.T) {
	for _, method := range []string{"browser.navigate", "browser.back", "browser.reload"} {
		if got := computerOperationDiagnostic(map[string]any{"phase": "validation", "field": "arguments", "expected": "documented_fields", "method": method}); got["method"] != method {
			t.Fatalf("script diagnostic lost method %s: %+v", method, got)
		}
	}
	for action, want := range map[string]string{"navigate": "browser_navigate", "back": "browser_go_back", "reload": "browser_reload"} {
		call, err := computerScriptOperation(TargetToolCall{}, map[string]any{"action": action})
		if err != nil || call.ToolName != want {
			t.Fatalf("%s: %+v %v", action, call, err)
		}
	}
}
