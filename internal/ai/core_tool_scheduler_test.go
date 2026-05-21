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
