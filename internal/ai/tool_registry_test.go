package ai

import (
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestInMemoryToolRegistry_RejectsMissingPresentationSpec(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	err := reg.Register(ToolDef{Name: "custom_tool", Source: "builtin"})
	if err == nil {
		t.Fatalf("Register succeeded without presentation spec")
	}
	if !strings.Contains(err.Error(), "presentation") {
		t.Fatalf("Register error=%q, want presentation failure", err)
	}
}

func TestInMemoryToolRegistry_AcceptsDeclaredPresentationSpec(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	def := ToolDef{
		Name:         "terminal_exec",
		Source:       "builtin",
		Presentation: aitools.MustPresentationSpec("terminal_exec"),
	}
	if err := reg.Register(def); err != nil {
		t.Fatalf("Register with presentation spec: %v", err)
	}
	snapshot := reg.Snapshot()
	if len(snapshot) != 1 {
		t.Fatalf("snapshot len=%d, want 1", len(snapshot))
	}
	if snapshot[0].Presentation.Renderer != "terminal" {
		t.Fatalf("renderer=%q, want terminal", snapshot[0].Presentation.Renderer)
	}
}

func TestInMemoryToolRegistry_RejectsOverridesAndReservedNames(t *testing.T) {
	for _, source := range []string{"mcp", "skill", "subagent"} {
		reg := NewInMemoryToolRegistry()
		if err := reg.Register(registryTestTool("file_read", source, 999)); err == nil {
			t.Fatalf("%s occupied a first-party name", source)
		}
	}
	reg := NewInMemoryToolRegistry()
	if err := reg.Register(registryTestTool("file_read", "builtin", 10)); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(registryTestTool("file_read", "floret", 999)); err == nil {
		t.Fatal("priority replaced a registered handler")
	}
	if reg.Snapshot()[0].Source != "builtin" {
		t.Fatal("failed registration changed handler")
	}
}

func TestInMemoryToolRegistry_RejectsDuplicateWithSamePriorityAndSource(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	first := registryTestTool("file_read", "builtin", 10)
	second := registryTestTool("file_read", "builtin", 10)
	if err := reg.Register(first); err != nil {
		t.Fatalf("Register first tool: %v", err)
	}
	err := reg.Register(second)
	if err == nil {
		t.Fatalf("Register duplicate succeeded, want conflict")
	}
	if !strings.Contains(err.Error(), "tool_registry_conflict") {
		t.Fatalf("Register duplicate error=%q, want registry conflict", err)
	}
}

func TestInMemoryToolRegistry_UnregisterRemovesTool(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	if err := reg.Register(registryTestTool("file_read", "builtin", 10)); err != nil {
		t.Fatalf("Register tool: %v", err)
	}
	if err := reg.Unregister(" file_read "); err != nil {
		t.Fatalf("Unregister: %v", err)
	}
	if snapshot := reg.Snapshot(); len(snapshot) != 0 {
		t.Fatalf("snapshot len=%d, want 0", len(snapshot))
	}
}

func TestInMemoryToolRegistry_SnapshotSortsByPriorityThenName(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	for _, def := range []ToolDef{
		registryTestTool("web_search_pages", "builtin", 10),
		registryTestTool("todo_write", "builtin", 30),
		registryTestTool("file_read", "builtin", 10),
	} {
		if err := reg.Register(def); err != nil {
			t.Fatalf("Register %s: %v", def.Name, err)
		}
	}
	snapshot := reg.Snapshot()
	got := make([]string, 0, len(snapshot))
	for _, def := range snapshot {
		got = append(got, def.Name)
	}
	want := []string{"todo_write", "file_read", "web_search_pages"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("snapshot order=%v, want %v", got, want)
	}
}

func registryTestTool(name string, source string, priority int) ToolDef {
	return ToolDef{
		Name:         name,
		Source:       source,
		Priority:     priority,
		Presentation: aitools.MustPresentationSpec(name),
	}
}
