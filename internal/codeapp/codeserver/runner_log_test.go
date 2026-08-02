package codeserver

import "testing"

func TestCodeServerStartLogAttrsSanitizesDynamicStrings(t *testing.T) {
	attrs := codeServerStartLogAttrs("space\nforged", 8443, "/work/project\rname", "/tmp/socket\nforged")
	want := []any{
		"code_space_id", "space forged",
		"port", 8443,
		"workspace", "project name",
		"session_socket", "/tmp/socket forged",
	}
	if len(attrs) != len(want) {
		t.Fatalf("codeServerStartLogAttrs() length = %d, want %d", len(attrs), len(want))
	}
	for i := range want {
		if attrs[i] != want[i] {
			t.Fatalf("codeServerStartLogAttrs()[%d] = %#v, want %#v", i, attrs[i], want[i])
		}
	}
}
