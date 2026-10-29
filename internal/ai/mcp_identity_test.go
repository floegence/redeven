package ai

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPAutomaticIdentity(t *testing.T) {
	for _, test := range []struct {
		name, title, serverName, customName, want string
	}{
		{"title", "Project tools", "project-mcp", "", "Project tools"},
		{"protocol name", "", "project-mcp", "", "project-mcp"},
		{"custom name", "Project tools", "project-mcp", "My workspace", "My workspace"},
		{"unicode", "项目工具", "project-mcp", "", "项目工具"},
		{"custom unicode", "Project tools", "project-mcp", "我的工具", "我的工具"},
		{"blank metadata", " ", " ", "", "127.0.0.1"},
		{"control characters", "Bad\nTitle", "project-mcp", "", "project-mcp"},
		{"bounded unicode", strings.Repeat("工", 60), "project-mcp", "", strings.Repeat("工", 40)},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := mcp.NewServer(&mcp.Implementation{Name: test.serverName, Title: test.title, Version: "1"}, nil)
			upstream := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true}))
			defer upstream.Close()
			dir := t.TempDir()
			manager, err := openMCPManager(dir)
			if err != nil {
				t.Fatal(err)
			}
			input := MCPServerInput{Transport: "http", URL: upstream.URL, Enabled: true, Name: test.customName, Headers: map[string]string{"Authorization": "private-token"}}
			view, err := manager.Save(t.Context(), input)
			if err != nil {
				t.Fatal(err)
			}
			first := view.Servers[0]
			if first.Name != test.want || !utf8.ValidString(first.Name) || !mcpIDPattern.MatchString(first.ID) || strings.HasPrefix(first.ID, "ap_") || first.CheckedAt == 0 {
				t.Fatalf("unexpected automatic identity: %+v", first)
			}
			input.ID, input.Revision, input.Name, input.Headers = first.ID, first.Revision, "Renamed", nil
			view, err = manager.Save(t.Context(), input)
			if err != nil {
				t.Fatal(err)
			}
			view, err = manager.Check(t.Context(), first.ID, view.Servers[0].Revision)
			if err != nil {
				t.Fatal(err)
			}
			if view.Servers[0].ID != first.ID || view.Servers[0].Name != "Renamed" || manager.servers[0].Headers["Authorization"] != "private-token" || !manager.HasDependency(SkillMCPDependency{Name: first.ID, URL: upstream.URL}) {
				t.Fatal("rename/check changed identity, credentials, or dependency resolution")
			}
			input.Revision, input.Name = view.Servers[0].Revision, ""
			view, err = manager.Save(t.Context(), input)
			if err != nil || view.Servers[0].Name != "Renamed" || view.Servers[0].ID != first.ID {
				t.Fatalf("omitted edit name changed saved identity: %v", err)
			}
			reopened, err := openMCPManager(dir)
			if err != nil || reopened.List().Servers[0].ID != first.ID {
				t.Fatalf("reopen: %v", err)
			}
		})
	}
}

func TestMCPAutomaticIdentityOfflineAndConflicts(t *testing.T) {
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		input MCPServerInput
		want  string
	}{
		{MCPServerInput{Transport: "http", URL: "https://tools.example.com/mcp"}, "tools.example.com"},
		{MCPServerInput{Transport: "stdio", Command: "/opt/tools/project-mcp"}, "project-mcp"},
		{MCPServerInput{Transport: "stdio", Command: "/opt/tools/project-mcp"}, "project-mcp"},
	} {
		view, err := manager.Save(t.Context(), test.input)
		if err != nil {
			t.Fatal(err)
		}
		last := view.Servers[len(view.Servers)-1]
		if last.Name != test.want || last.CheckedAt != 0 {
			t.Fatalf("offline identity: %+v", last)
		}
	}
	if len(manager.List().Servers) != 3 {
		t.Fatal("automatic IDs collided")
	}
	before, _ := os.ReadFile(manager.path)
	for _, input := range []MCPServerInput{
		{Revision: 1, Transport: "stdio", Command: "fixture"},
		{ID: manager.servers[0].ID, Transport: "stdio", Command: "fixture"},
	} {
		if _, err := manager.Save(t.Context(), input); !errors.Is(err, errMCPConflict) {
			t.Fatalf("stale/duplicate identity: %v", err)
		}
	}
	for _, id := range []string{"123", "ap_reserved", "invalid id"} {
		if _, err := manager.Save(t.Context(), MCPServerInput{ID: id, Transport: "stdio", Command: "fixture"}); err == nil {
			t.Fatalf("invalid custom ID %q accepted", id)
		}
	}
	for range 2 {
		if _, err := manager.Save(t.Context(), MCPServerInput{Transport: "http", URL: "http://127.0.0.1:1/mcp", Enabled: true}); err == nil {
			t.Fatal("unavailable connection saved")
		}
	}
	after, _ := os.ReadFile(manager.path)
	if !bytes.Equal(before, after) || len(manager.List().Servers) != 3 {
		t.Fatal("failed creation changed configuration")
	}
}

func TestMCPAutomaticIdentityPersistenceFailure(t *testing.T) {
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// A file at the parent path forces persistence to fail without permissions assumptions.
	if err := os.WriteFile(filepath.Dir(manager.path), []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{Transport: "stdio", Command: "project-mcp"}
	if _, err := manager.Save(t.Context(), input); err == nil {
		t.Fatal("persistence failure accepted")
	}
	if len(manager.List().Servers) != 0 || manager.revision != 0 {
		t.Fatal("failed persistence committed generated identity")
	}
}
