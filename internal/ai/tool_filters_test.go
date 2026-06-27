package ai

import (
	"reflect"
	"testing"
)

func TestPermissionToolFilter_VisibilityMatrix(t *testing.T) {
	t.Parallel()

	filter := newPermissionToolFilter(true)
	all := []ToolDef{
		{Name: "read_file", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "read_files", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "rgrep", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "find", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "web_fetch", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "file.read", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "web.search", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf.index", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf.search", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf.open", Visibility: ToolVisibilitySharedReadonly},
		{Name: "write_todos", Visibility: ToolVisibilityInteraction},
		{Name: "ask_user", Visibility: ToolVisibilityControl},
		{Name: "task_complete", Visibility: ToolVisibilityControl},
		{Name: "subagents", Visibility: ToolVisibilityDelegationControl},
		{Name: "terminal.exec", Visibility: ToolVisibilityStandard},
		{Name: "file.edit", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "file.write", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "apply_patch", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "use_skill", Visibility: ToolVisibilityStandard},
	}

	tests := []struct {
		name           string
		permissionType FlowerPermissionType
		want           []string
	}{
		{
			name:           "readonly",
			permissionType: FlowerPermissionReadonly,
			want: []string{
				"ask_user",
				"find",
				"okf.index",
				"okf.open",
				"okf.search",
				"read_file",
				"read_files",
				"rgrep",
				"subagents",
				"task_complete",
				"web.search",
				"web_fetch",
				"write_todos",
			},
		},
		{
			name:           "approval required",
			permissionType: FlowerPermissionApprovalRequired,
			want: []string{
				"apply_patch",
				"ask_user",
				"file.edit",
				"file.write",
				"okf.index",
				"okf.open",
				"okf.search",
				"subagents",
				"task_complete",
				"terminal.exec",
				"use_skill",
				"web.search",
				"write_todos",
			},
		},
		{
			name:           "full access",
			permissionType: FlowerPermissionFullAccess,
			want: []string{
				"apply_patch",
				"ask_user",
				"file.edit",
				"file.write",
				"okf.index",
				"okf.open",
				"okf.search",
				"subagents",
				"task_complete",
				"terminal.exec",
				"use_skill",
				"web.search",
				"write_todos",
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := toolNames(filter.FilterTools(tc.permissionType, all))
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("tools=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestPermissionToolFilter_HidesUserInteractionWhenDisabled(t *testing.T) {
	t.Parallel()

	filter := newPermissionToolFilter(false)
	all := []ToolDef{
		{Name: "ask_user", Visibility: ToolVisibilityControl},
		{Name: "task_complete", Visibility: ToolVisibilityControl},
		{Name: "write_todos", Visibility: ToolVisibilityInteraction},
		{Name: "subagents", Visibility: ToolVisibilityDelegationControl},
	}

	got := toolNames(filter.FilterTools(FlowerPermissionReadonly, all))
	want := []string{"subagents", "task_complete", "write_todos"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tools=%v, want %v", got, want)
	}
}

func TestPermissionSnapshotConsistencyForBuiltinMatrix(t *testing.T) {
	t.Parallel()

	allTools := builtInToolDefinitions()
	allSignals := builtInControlSignalDefinitions()
	filter := newPermissionToolFilter(true)

	for _, permissionType := range []FlowerPermissionType{
		FlowerPermissionReadonly,
		FlowerPermissionApprovalRequired,
		FlowerPermissionFullAccess,
	} {
		permissionType := permissionType
		t.Run(permissionTypeString(permissionType), func(t *testing.T) {
			t.Parallel()

			activeTools := filter.FilterTools(permissionType, allTools)
			activeSignals := filter.FilterTools(permissionType, allSignals)
			snapshot := buildPermissionSnapshot(permissionType, activeTools, activeSignals)
			if err := validatePermissionSnapshotConsistency(snapshot); err != nil {
				t.Fatalf("validatePermissionSnapshotConsistency: %v", err)
			}
			names := toolNames(activeTools)
			if permissionType == FlowerPermissionReadonly {
				for _, blocked := range []string{"terminal.exec", "file.edit", "file.write", "apply_patch", "use_skill"} {
					if containsString(names, blocked) {
						t.Fatalf("readonly tool set includes %q: %v", blocked, names)
					}
				}
				for _, required := range []string{"read_file", "read_files", "rgrep", "find", "web_fetch", "subagents"} {
					if !containsString(names, required) {
						t.Fatalf("readonly tool set missing %q: %v", required, names)
					}
				}
				return
			}
			for _, blocked := range []string{"read_file", "read_files", "rgrep", "find", "web_fetch"} {
				if containsString(names, blocked) {
					t.Fatalf("%s tool set includes readonly-exclusive %q: %v", permissionType, blocked, names)
				}
			}
			if !containsString(names, "terminal.exec") || !containsString(names, "subagents") {
				t.Fatalf("%s tool set missing standard delegation surface: %v", permissionType, names)
			}
		})
	}
}
