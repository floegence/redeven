package ai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const extensionSVGFixture = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#267" d="M4 4h24v24H4z"/></svg>`

func TestExtensionIconValidation(t *testing.T) {
	for _, body := range []string{
		"", "not an image", `<html><svg/></html>`, `<svg/>`, extensionSVGFixture + "garbage",
		extensionSVGFixture + extensionSVGFixture,
		`<!DOCTYPE svg [<!ENTITY file SYSTEM "file:///etc/passwd">]>` + extensionSVGFixture,
		strings.Replace(extensionSVGFixture, "<path", `<script>alert(1)</script><path`, 1),
		strings.Replace(extensionSVGFixture, "<path", `<foreignObject/><path`, 1),
		strings.Replace(extensionSVGFixture, "<path", `<image href="https://example.com/track"/><path`, 1),
		strings.Replace(extensionSVGFixture, "<path", `<path onload="alert(1)"`, 1),
		strings.Repeat(" ", maxExtensionIconBytes) + extensionSVGFixture,
	} {
		if extensionIconData([]byte(body)) != "" {
			t.Fatalf("invalid icon accepted: %.150s", body)
		}
	}
	for _, format := range []string{"png", "jpeg", "gif", "svg+xml"} {
		var data bytes.Buffer
		bitmap := image.NewRGBA(image.Rect(0, 0, 32, 32))
		switch format {
		case "png":
			_ = png.Encode(&data, bitmap)
		case "jpeg":
			_ = jpeg.Encode(&data, bitmap, nil)
		case "gif":
			_ = gif.Encode(&data, bitmap, nil)
		default:
			data.WriteString(extensionSVGFixture)
		}
		source := extensionIconData(data.Bytes())
		if !strings.HasPrefix(source, "data:image/"+format+";base64,") || extensionIconFromDataURI(source) != source || extensionIconByteSize(source) != data.Len() {
			t.Fatalf("%s did not normalize and round trip", format)
		}
	}
	var large bytes.Buffer
	_ = png.Encode(&large, image.NewRGBA(image.Rect(0, 0, 2049, 1)))
	if extensionIconData(large.Bytes()) != "" {
		t.Fatal("oversized image dimensions accepted")
	}
	for _, source := range []string{"https://example.com/icon.png", "file:///icon.png", "data:image/svg+xml;base64,%%%%", "data:text/html;base64," + base64.StdEncoding.EncodeToString([]byte(extensionSVGFixture))} {
		if extensionIconFromDataURI(source) != "" {
			t.Fatalf("unsupported icon URI accepted: %q", source)
		}
	}
	boundary := extensionSVGFixture + strings.Repeat(" ", maxExtensionIconBytes-len(extensionSVGFixture))
	if !validMCPCatalogIcons([]ExtensionIcon{{Source: extensionIconData([]byte(boundary))}}) {
		t.Fatal("exactly bounded icon was rejected")
	}
}

func TestSkillCatalogIconsPackageAssets(t *testing.T) {
	mgr := newSkillManager(t.TempDir(), t.TempDir())
	mgr.userHome = t.TempDir()
	root := filepath.Join(mgr.userHome, ".agents", "skills", "review")
	for _, dir := range []string{"agents", "assets"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("SKILL.md", "---\nname: review\ndescription: Review changes\n---\nReview the changes.")
	write("assets/small.svg", extensionSVGFixture)
	large := strings.Replace(extensionSVGFixture, "#267", "#528", 1)
	write("assets/large.svg", large)
	write("agents/openai.yaml", "interface:\n  display_name: Review\n  icon_small: ./assets/small.svg\n  icon_large: ./assets/large.svg\n")
	path := filepath.Join(root, "SKILL.md")
	want := extensionIconData([]byte(extensionSVGFixture))
	if got := skillCatalogIcons(path); len(got) != 1 || got[0].Source != want {
		t.Fatalf("did not prefer small package-relative asset: %+v", got)
	}
	catalog := mgr.Reload()
	found := false
	for _, skill := range catalog.Skills {
		if skill.Path == path {
			found = true
			if len(skill.Icons) != 1 || skill.Icons[0].Source != want {
				t.Fatal("catalog omitted package icon")
			}
			skill.Icons[0].Source = "changed"
		}
	}
	if !found {
		t.Fatal("fixture was not discovered")
	}
	for _, skill := range mgr.Catalog().Skills {
		if skill.Path == path && skill.Icons[0].Source != want {
			t.Fatal("caller mutated cached icons")
		}
	}
	modelCatalog, _ := json.Marshal(mgr.List(""))
	if strings.Contains(string(modelCatalog), "data:image") || strings.Contains(string(modelCatalog), "\"icons\"") {
		t.Fatal("presentation leaked into model metadata")
	}
	write("assets/small.svg", "invalid")
	if got := skillCatalogIcons(path); len(got) != 1 || got[0].Source != extensionIconData([]byte(large)) {
		t.Fatal("invalid small asset did not fall back to large asset")
	}
	outside := filepath.Join(t.TempDir(), "outside.svg")
	if err := os.WriteFile(outside, []byte(extensionSVGFixture), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "assets", "escape.svg")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(root), "outside.svg"), []byte(extensionSVGFixture), 0600); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"./assets/escape.svg", "../outside.svg", outside, "assets", "missing.svg"} {
		write("agents/openai.yaml", "interface:\n  icon_small: "+source+"\n")
		if got := skillCatalogIcons(path); len(got) != 0 {
			t.Fatalf("invalid path read: %q", source)
		}
	}
	for _, metadata := range []string{"interface: [", strings.Repeat("\n", 33<<10) + "interface:\n  icon_small: ./assets/small.svg\n"} {
		write("agents/openai.yaml", metadata)
		write("assets/small.svg", extensionSVGFixture)
		if got := skillCatalogIcons(path); len(got) != 0 {
			t.Fatal("malformed or oversized package data accepted")
		}
	}
	write("agents/openai.yaml", "interface:\n  icon_small: ./assets/small.svg\n")
	write("assets/small.svg", strings.Repeat(" ", maxExtensionIconBytes)+extensionSVGFixture)
	if len(skillCatalogIcons(path)) != 0 {
		t.Fatal("oversized asset accepted")
	}
	if err := os.Remove(filepath.Join(root, "agents", "openai.yaml")); err != nil {
		t.Fatal(err)
	}
	outsideMetadata := filepath.Join(t.TempDir(), "openai.yaml")
	if err := os.WriteFile(outsideMetadata, []byte("interface:\n  icon_small: ./assets/large.svg\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideMetadata, filepath.Join(root, "agents", "openai.yaml")); err != nil {
		t.Fatal(err)
	}
	if len(skillCatalogIcons(path)) != 0 || len(skillCatalogIcons("system:review/SKILL.md")) != 0 {
		t.Fatal("escaped metadata or virtual path accepted")
	}
}

func TestMCPCatalogIconFetchIsolation(t *testing.T) {
	var requests, leaked, escaped atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { escaped.Add(1) }))
	defer other.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Referer") != "" {
			leaked.Add(1)
		}
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, other.URL, http.StatusFound)
		case "/large":
			_, _ = w.Write([]byte(strings.Repeat("x", maxExtensionIconBytes+1)))
		case "/slow":
			<-r.Context().Done()
		default:
			_, _ = w.Write([]byte(extensionSVGFixture))
		}
	}))
	defer server.Close()
	input := MCPServerInput{Transport: "http", URL: server.URL + "/mcp", Headers: map[string]string{"Authorization": "private", "Cookie": "private"}}
	want := extensionIconData([]byte(extensionSVGFixture))
	icons := mcpCatalogIcons(t.Context(), input, []mcp.Icon{{Source: server.URL + "/icon", Theme: "dark"}, {Source: want, Theme: "light"}})
	if len(icons) != 2 || icons[0].Source != want || icons[0].Theme != "dark" || icons[1].Theme != "light" || requests.Load() != 1 || leaked.Load() != 0 {
		t.Fatalf("icons or isolated fetch: %+v, requests=%d, leaked=%d", icons, requests.Load(), leaked.Load())
	}
	for _, source := range []string{server.URL + "/redirect", other.URL + "/icon", server.URL + "/large", "file:///etc/passwd", server.URL + "/slow"} {
		if len(mcpCatalogIcons(t.Context(), input, []mcp.Icon{{Source: source}})) != 0 {
			t.Fatalf("unavailable or unsafe icon accepted: %s", source)
		}
	}
	if escaped.Load() != 0 {
		t.Fatal("icon followed a redirect or fetched a foreign origin")
	}
	before := requests.Load()
	if got := mcpCatalogIcons(t.Context(), MCPServerInput{Transport: "stdio"}, []mcp.Icon{{Source: server.URL}, {Source: want}}); len(got) != 1 || requests.Load() != before {
		t.Fatal("stdio discovery made an HTTP icon request")
	}
	if validMCPCatalogIcons([]ExtensionIcon{{Source: want, Theme: "unknown"}}) || validMCPCatalogIcons([]ExtensionIcon{{Source: want}, {Source: want}}) || validMCPCatalogIcons([]ExtensionIcon{{Source: server.URL}}) {
		t.Fatal("invalid persisted icon metadata accepted")
	}
}

func TestMCPIconDiscoveryPersistenceAndIdentity(t *testing.T) {
	want := extensionIconData([]byte(extensionSVGFixture))
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1", Icons: []mcp.Icon{{Source: want, Theme: "light"}}}, nil)
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
	var requests atomic.Int32
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); handler.ServeHTTP(w, r) }))
	defer httpServer.Close()
	dir := t.TempDir()
	manager, err := openMCPManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "local", Name: "Local tools", Transport: "http", URL: httpServer.URL, Enabled: true}
	view, err := manager.Save(t.Context(), input)
	if err != nil || len(view.Servers[0].Icons) != 1 || view.Servers[0].Icons[0].Source != want {
		t.Fatalf("discovery did not expose icons: %+v, %v", view, err)
	}
	before := requests.Load()
	reopened, err := openMCPManager(dir)
	if err != nil || !reflect.DeepEqual(reopened.List(), view) || requests.Load() != before {
		t.Fatalf("restart did not retain icons without connecting: %v", err)
	}
	record := manager.servers[0]
	tool := mcpToolRecord{Name: "echo", Schema: json.RawMessage(`{"type":"object"}`)}
	identity := mcpToolName(record, tool)
	record.Icons = []ExtensionIcon{{Source: "changed"}}
	if mcpToolName(record, tool) != identity {
		t.Fatal("presentation changed tool execution identity")
	}
	view.Servers[0].Icons[0].Source = "mutated"
	if manager.List().Servers[0].Icons[0].Source != want {
		t.Fatal("catalog caller mutated saved icon metadata")
	}
	input.Revision = view.Servers[0].Revision
	input.Enabled = false
	view, err = manager.Save(t.Context(), input)
	if err != nil || len(view.Servers[0].Icons) != 1 || requests.Load() != before {
		t.Fatal("disabling lost icons or connected the server")
	}
	input.Revision = view.Servers[0].Revision
	input.URL += "/changed"
	view, err = manager.Save(t.Context(), input)
	if err != nil || len(view.Servers[0].Icons) != 0 {
		t.Fatal("changed connection retained an unrelated icon")
	}
}
