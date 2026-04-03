package ai

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestNewModeToolFilter_DefaultBlocksPlanMutatingTools(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(nil, defaultStructuredProtocolProfile(), true)
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "file.read", Mutating: false},
		{Name: "apply_patch", Mutating: true},
		{Name: "file.edit", Mutating: true},
		{Name: "exit_plan_mode", Mutating: false},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 3 {
		t.Fatalf("plan filtered len=%d, want 3", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" || filteredPlan[1].Name != "file.read" || filteredPlan[2].Name != "exit_plan_mode" {
		t.Fatalf("unexpected plan tools=%v", []string{filteredPlan[0].Name, filteredPlan[1].Name, filteredPlan[2].Name})
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 4 {
		t.Fatalf("act filtered len=%d, want 4", len(filteredAct))
	}
}

func TestNewModeToolFilter_ExecutionPolicyDoesNotDisablePlanReadonly(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(&config.AIConfig{
		ExecutionPolicy: &config.AIExecutionPolicy{
			RequireUserApproval:    true,
			BlockDangerousCommands: true,
		},
	}, defaultStructuredProtocolProfile(), true)
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "file.read", Mutating: false},
		{Name: "apply_patch", Mutating: true},
		{Name: "file.write", Mutating: true},
		{Name: "exit_plan_mode", Mutating: false},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 3 {
		t.Fatalf("plan filtered len=%d, want 3", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" || filteredPlan[1].Name != "file.read" || filteredPlan[2].Name != "exit_plan_mode" {
		t.Fatalf("unexpected plan tools=%v", []string{filteredPlan[0].Name, filteredPlan[1].Name, filteredPlan[2].Name})
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 4 {
		t.Fatalf("act filtered len=%d, want 4", len(filteredAct))
	}
}
