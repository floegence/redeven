package toolnames

import "testing"

func TestHistoricalCatalogIsPortableAndUnambiguous(t *testing.T) {
	seen := map[string]bool{}
	for old, current := range historical {
		if old == current || seen[current] {
			t.Fatalf("ambiguous mapping %s -> %s", old, current)
		}
		if err := Validate(current); err != nil {
			t.Fatal(err)
		}
		seen[current] = true
		if Historical(current) != current {
			t.Fatalf("mapping is not idempotent: %s", current)
		}
	}
}

func TestMCPAllowlistMigrationPreservesReleasedIdentity(t *testing.T) {
	for _, old := range []string{"mcp_server-with-hyphens_0123456789abcdef", "mcp_ap_abcdef_0123456789abcdef"} {
		current := MCP(old)
		if err := Validate(current); err != nil {
			t.Fatal(err)
		}
		if MigrateAllowlistName(old) != current || MigrateAllowlistName(current) != current {
			t.Fatal("allowlist identity changed")
		}
	}
	for _, name := range []string{"mcp_unknown", "web_search", "plugin.custom"} {
		if MigrateAllowlistName(name) != name {
			t.Fatalf("guessed unknown name %s", name)
		}
	}
}
