package ai

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestNewModeToolFilter_DefaultBlocksPlanMutatingTools(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(nil)
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "apply_patch", Mutating: true},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 1 {
		t.Fatalf("plan filtered len=%d, want 1", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" {
		t.Fatalf("plan filtered tool=%q, want %q", filteredPlan[0].Name, "terminal.exec")
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 2 {
		t.Fatalf("act filtered len=%d, want 2", len(filteredAct))
	}
}

func TestNewModeToolFilter_ExecutionPolicyDoesNotDisablePlanReadonly(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(&config.AIConfig{
		ExecutionPolicy: &config.AIExecutionPolicy{
			RequireUserApproval:    true,
			BlockDangerousCommands: true,
		},
	})
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "apply_patch", Mutating: true},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 1 {
		t.Fatalf("plan filtered len=%d, want 1", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" {
		t.Fatalf("plan filtered tool=%q, want %q", filteredPlan[0].Name, "terminal.exec")
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 2 {
		t.Fatalf("act filtered len=%d, want 2", len(filteredAct))
	}
}
