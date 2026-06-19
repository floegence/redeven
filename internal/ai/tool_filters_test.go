package ai

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestNewModeToolFilter_DefaultBlocksPlanMutatingTools(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(nil, true)
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "file.read", Mutating: false},
		{Name: "apply_patch", Mutating: true},
		{Name: "file.edit", Mutating: true},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 2 {
		t.Fatalf("plan filtered len=%d, want 2", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" || filteredPlan[1].Name != "file.read" {
		t.Fatalf("unexpected plan tools=%v", []string{filteredPlan[0].Name, filteredPlan[1].Name})
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 4 {
		t.Fatalf("act filtered len=%d, want 4", len(filteredAct))
	}

	filteredSignals := filter.FilterToolsForMode(config.AIModePlan, []ToolDef{{Name: "task_complete"}, {Name: "ask_user"}, {Name: "exit_plan_mode"}})
	if len(filteredSignals) != 3 {
		t.Fatalf("unexpected plan signals=%v", filteredSignals)
	}
	gotSignals := []string{filteredSignals[0].Name, filteredSignals[1].Name, filteredSignals[2].Name}
	if gotSignals[0] != "task_complete" || gotSignals[1] != "ask_user" || gotSignals[2] != "exit_plan_mode" {
		t.Fatalf("unexpected plan signals=%v", gotSignals)
	}
}

func TestNewModeToolFilter_ExecutionPolicyDoesNotDisablePlanReadonly(t *testing.T) {
	t.Parallel()

	filter := newModeToolFilter(&config.AIConfig{
		ExecutionPolicy: &config.AIExecutionPolicy{
			RequireUserApproval:    true,
			BlockDangerousCommands: true,
		},
	}, true)
	tools := []ToolDef{
		{Name: "terminal.exec", Mutating: false},
		{Name: "file.read", Mutating: false},
		{Name: "apply_patch", Mutating: true},
		{Name: "file.write", Mutating: true},
	}

	filteredPlan := filter.FilterToolsForMode(config.AIModePlan, tools)
	if len(filteredPlan) != 2 {
		t.Fatalf("plan filtered len=%d, want 2", len(filteredPlan))
	}
	if filteredPlan[0].Name != "terminal.exec" || filteredPlan[1].Name != "file.read" {
		t.Fatalf("unexpected plan tools=%v", []string{filteredPlan[0].Name, filteredPlan[1].Name})
	}

	filteredAct := filter.FilterToolsForMode(config.AIModeAct, tools)
	if len(filteredAct) != 4 {
		t.Fatalf("act filtered len=%d, want 4", len(filteredAct))
	}
}
