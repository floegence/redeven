package ai

import (
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestInMemoryToolRegistry_RejectsMissingPresentationSpec(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	err := reg.Register(ToolDef{Name: "custom.tool", Source: "builtin"}, signalToolHandler{})
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
		Name:         "terminal.exec",
		Source:       "builtin",
		Presentation: aitools.MustPresentationSpec("terminal.exec"),
	}
	if err := reg.Register(def, signalToolHandler{}); err != nil {
		t.Fatalf("Register with presentation spec: %v", err)
	}
	snapshot := reg.Snapshot()
	if len(snapshot) != 1 {
		t.Fatalf("snapshot len=%d, want 1", len(snapshot))
	}
	if snapshot[0].Presentation.Renderer != "command" {
		t.Fatalf("renderer=%q, want command", snapshot[0].Presentation.Renderer)
	}
}

func TestInMemoryToolRegistry_ReplacesByPriority(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	low := registryTestTool("file.read", "skill", 10)
	high := registryTestTool("file.read", "skill", 20)
	if err := reg.Register(low, signalToolHandler{}); err != nil {
		t.Fatalf("Register low priority: %v", err)
	}
	if err := reg.Register(high, signalToolHandler{}); err != nil {
		t.Fatalf("Register high priority replacement: %v", err)
	}
	snapshot := reg.Snapshot()
	if len(snapshot) != 1 {
		t.Fatalf("snapshot len=%d, want 1", len(snapshot))
	}
	if snapshot[0].Priority != 20 {
		t.Fatalf("priority=%d, want 20", snapshot[0].Priority)
	}
}

func TestInMemoryToolRegistry_ReplacesBySourceRank(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	skill := registryTestTool("file.read", "skill", 10)
	builtin := registryTestTool("file.read", "builtin", 10)
	if err := reg.Register(skill, signalToolHandler{}); err != nil {
		t.Fatalf("Register skill tool: %v", err)
	}
	if err := reg.Register(builtin, signalToolHandler{}); err != nil {
		t.Fatalf("Register builtin replacement: %v", err)
	}
	snapshot := reg.Snapshot()
	if len(snapshot) != 1 {
		t.Fatalf("snapshot len=%d, want 1", len(snapshot))
	}
	if snapshot[0].Source != "builtin" {
		t.Fatalf("source=%q, want builtin", snapshot[0].Source)
	}
}

func TestInMemoryToolRegistry_RejectsDuplicateWithSamePriorityAndSource(t *testing.T) {
	t.Parallel()

	reg := NewInMemoryToolRegistry()
	first := registryTestTool("file.read", "builtin", 10)
	second := registryTestTool("file.read", "builtin", 10)
	if err := reg.Register(first, signalToolHandler{}); err != nil {
		t.Fatalf("Register first tool: %v", err)
	}
	err := reg.Register(second, signalToolHandler{})
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
	if err := reg.Register(registryTestTool("file.read", "builtin", 10), signalToolHandler{}); err != nil {
		t.Fatalf("Register tool: %v", err)
	}
	if err := reg.Unregister(" file.read "); err != nil {
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
		registryTestTool("web.search", "builtin", 10),
		registryTestTool("write_todos", "builtin", 30),
		registryTestTool("file.read", "builtin", 10),
	} {
		if err := reg.Register(def, signalToolHandler{}); err != nil {
			t.Fatalf("Register %s: %v", def.Name, err)
		}
	}
	snapshot := reg.Snapshot()
	got := make([]string, 0, len(snapshot))
	for _, def := range snapshot {
		got = append(got, def.Name)
	}
	want := []string{"write_todos", "file.read", "web.search"}
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
