package agentplugins

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	put(t, root, "plugin.json", `{"$schema":"`+ManifestSchema+`","name":"test-plugin"}`)
	put(t, root, "skills/review/SKILL.md", "---\nname: review\ndescription: Review changes\n---\nRead the changes.\n")
	return root
}
func put(t *testing.T, root, path, body string) {
	t.Helper()
	path = filepath.Join(root, path)
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path, []byte(body), 0600); e != nil {
		t.Fatal(e)
	}
}
func TestManifestFailureBoundaries(t *testing.T) {
	for _, tt := range []struct {
		name, extra string
		fail        bool
	}{{"unknown", `,"future":true`, false}, {"extensions scalar", `,"extensions":false`, false}, {"unknown namespace", `,"extensions":{"org.other":false}`, false}, {"null description", `,"description":null`, true}, {"unknown author", `,"author":{"extra":"x"}`, true}, {"arbitrary version", `,"version":"nightly"`, false}} {
		t.Run(tt.name, func(t *testing.T) {
			r := fixture(t)
			put(t, r, "plugin.json", `{"$schema":"`+ManifestSchema+`","name":"test"`+tt.extra+`}`)
			p, e := Load(r)
			if (e != nil) != tt.fail {
				t.Fatalf("err=%v", e)
			}
			if e == nil && len(p.Skills) != 1 {
				t.Fatal(p)
			}
		})
	}
}
func TestComponentsAreIndependentlyAdmitted(t *testing.T) {
	r := fixture(t)
	put(t, r, "skills/broken/SKILL.md", "---\nname: wrong\ndescription: invalid\n---\n")
	put(t, r, "skills/deep/nested/SKILL.md", "---\nname: nested\ndescription: nested\n---\n")
	put(t, r, "mcp.json", `{"$schema":"`+MCPSchema+`","mcpServers":{"valid":{"type":"streamable-http","url":"https://example.com/mcp?q=yes"},"bad":{"type":"stdio","command":"echo hello"},"legacy":{"type":"sse","url":"https://example.com/sse"}}}`)
	p, e := Load(r)
	if e != nil || len(p.Skills) != 1 || len(p.MCP) != 1 || len(p.Diagnostics) != 3 {
		t.Fatalf("%+v %v", p, e)
	}
	put(t, r, "mcp.json", `{"mcpServers":{}}`)
	p, e = Load(r)
	if e != nil || len(p.Skills) != 1 || len(p.MCP) != 0 {
		t.Fatal(p, e)
	}
}
func TestResolvedPathsAndVariables(t *testing.T) {
	r := fixture(t)
	data := t.TempDir()
	r, _ = filepath.EvalSymlinks(r)
	data, _ = filepath.EvalSymlinks(data)
	outside := t.TempDir()
	if e := os.Symlink(outside, filepath.Join(r, "escape")); e != nil {
		t.Fatal(e)
	}
	for _, p := range []string{"../other", "./escape/missing"} {
		if _, e := Within(r, filepath.Join(r, p)); e == nil {
			t.Fatal("accepted escape", p)
		}
	}
	c := MCP{Type: "stdio", Command: "node", Args: []string{"${PLUGIN_ROOT}/run.js", "${UNKNOWN}"}, Env: map[string]string{"DATA": "${PLUGIN_DATA}"}, CWD: "${PLUGIN_DATA}/cache"}
	got, e := c.Resolve(r, data)
	if e != nil {
		t.Fatal(e)
	}
	if got.Args[1] != "${UNKNOWN}" || got.CWD != filepath.Join(data, "cache") || got.Env["PLUGIN_ROOT"] != r || got.Env["PLUGIN_DATA"] != data {
		t.Fatalf("%+v", got)
	}
	c.CWD = "${PLUGIN_DATA}/../escape"
	if _, e = c.Resolve(r, data); e == nil {
		t.Fatal("data escape accepted")
	}
	c.CWD = ""
	got, e = c.Resolve(r, data)
	if e != nil || got.CWD != r {
		t.Fatal(got, e)
	}
}
func TestMCPClosedConfiguration(t *testing.T) {
	for _, raw := range []string{`{"type":"stdio","command":"node","env":{"PLUGIN_ROOT":"bad"}}`, `{"type":"stdio","command":"node","args":null}`, `{"type":"streamable-http","url":"http://192.168.1.1/mcp"}`, `{"type":"streamable-http","url":"https://example.com","headers":{"X-Key":"a","x-key":"b"}}`} {
		if _, e := parseMCP([]byte(raw)); e == nil {
			t.Fatal("accepted", raw)
		}
	}
	c, e := parseMCP([]byte(`{"type":"streamable-http","url":"http://127.0.1.2/mcp","headers":{"X-Test":"${LITERAL}"}}`))
	if e != nil || c.Headers["X-Test"] != "${LITERAL}" {
		t.Fatal(c, e)
	}
}
func TestSkillSymlinkFailureIsNarrow(t *testing.T) {
	r := fixture(t)
	outside := t.TempDir()
	put(t, outside, "SKILL.md", "text")
	if e := os.Symlink(outside, filepath.Join(r, "skills", "outside")); e != nil {
		t.Fatal(e)
	}
	p, e := Load(r)
	if e != nil || len(p.Skills) != 1 || len(p.Diagnostics) != 1 {
		t.Fatal(p, e)
	}
}
func TestPackageMetadataNeverRequiresSemver(t *testing.T) {
	r := fixture(t)
	b, _ := json.Marshal(Manifest{Schema: ManifestSchema, Name: "example.tools", Version: "nightly/main", Repository: "not-a-url"})
	put(t, r, "plugin.json", string(b))
	p, e := Load(r)
	if e != nil || !strings.Contains(p.Manifest.Version, "nightly") {
		t.Fatal(p, e)
	}
}

func TestMCPRejectsAmbiguousEnvironmentCase(t *testing.T) {
	if _, err := parseMCP([]byte("{\"type\":\"stdio\",\"command\":\"node\",\"env\":{\"Path\":\"first\",\"PATH\":\"second\"}}")); err == nil {
		t.Fatal("ambiguous environment accepted")
	}
}
