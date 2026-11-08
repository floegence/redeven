package ai

import (
	"reflect"
	"sort"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestPermissionToolFilter_VisibilityMatrix(t *testing.T) {
	t.Parallel()

	filter := newPermissionToolFilter(true)
	all := []ToolDef{
		{Name: "file_read", Visibility: ToolVisibilitySharedReadonly},
		{Name: "file_read_many", Visibility: ToolVisibilitySharedReadonly},
		{Name: "file_search", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "path_find", Visibility: ToolVisibilitySharedReadonly},
		{Name: "web_fetch", Visibility: ToolVisibilitySharedReadonly},
		{Name: "web_search_pages", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf_get_index", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf_search", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf_open", Visibility: ToolVisibilitySharedReadonly},
		{Name: "todo_write", Visibility: ToolVisibilityInteraction},
		{Name: "user_ask", Visibility: ToolVisibilityControl},
		{Name: "subagent_manage", Visibility: ToolVisibilityDelegationControl},
		{Name: "terminal_exec", Visibility: ToolVisibilityStandard},
		{Name: "file_write", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "file_apply_patch", Visibility: ToolVisibilityStandard, Mutating: true},
		{Name: "skill_use", Visibility: ToolVisibilityStandard},
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
				"user_ask",
				"path_find",
				"okf_get_index",
				"okf_open",
				"okf_search",
				"file_read",
				"file_read_many",
				"file_search",
				"subagent_manage",
				"web_search_pages",
				"web_fetch",
				"todo_write",
			},
		},
		{
			name:           "approval required",
			permissionType: FlowerPermissionApprovalRequired,
			want: []string{
				"file_apply_patch",
				"user_ask",
				"file_write",
				"path_find",
				"okf_get_index",
				"okf_open",
				"okf_search",
				"file_read",
				"file_read_many",
				"subagent_manage",
				"terminal_exec",
				"skill_use",
				"web_search_pages",
				"web_fetch",
				"todo_write",
			},
		},
		{
			name:           "full access",
			permissionType: FlowerPermissionFullAccess,
			want: []string{
				"file_apply_patch",
				"user_ask",
				"file_write",
				"path_find",
				"okf_get_index",
				"okf_open",
				"okf_search",
				"file_read",
				"file_read_many",
				"subagent_manage",
				"terminal_exec",
				"skill_use",
				"web_search_pages",
				"web_fetch",
				"todo_write",
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := toolNames(filter.FilterTools(tc.permissionType, all))
			sort.Strings(tc.want)
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
		{Name: "user_ask", Visibility: ToolVisibilityControl},
		{Name: "todo_write", Visibility: ToolVisibilityInteraction},
		{Name: "subagent_manage", Visibility: ToolVisibilityDelegationControl},
	}

	got := toolNames(filter.FilterTools(FlowerPermissionReadonly, all))
	want := []string{"subagent_manage", "todo_write"}
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
				for _, blocked := range []string{"terminal_exec", "file_write", "file_apply_patch", "skill_use"} {
					if containsString(names, blocked) {
						t.Fatalf("readonly tool set includes %q: %v", blocked, names)
					}
				}
				for _, required := range []string{"file_read", "file_read_many", "file_search", "path_find", "web_fetch", "subagent_manage"} {
					if !containsString(names, required) {
						t.Fatalf("readonly tool set missing %q: %v", required, names)
					}
				}
				return
			}
			for _, blocked := range []string{"file_search"} {
				if containsString(names, blocked) {
					t.Fatalf("%s tool set includes readonly-exclusive %q: %v", permissionType, blocked, names)
				}
			}
			for _, required := range []string{"file_read", "file_read_many", "path_find"} {
				if !containsString(names, required) {
					t.Fatalf("%s missing shared file tool %s", permissionType, required)
				}
			}
			if !containsString(names, "terminal_exec") || !containsString(names, "subagent_manage") || !containsString(names, "web_fetch") {
				t.Fatalf("%s tool set missing standard delegation surface: %v", permissionType, names)
			}
		})
	}
}

func TestBuiltInControlSignalDefinitionsExposeOnlyAskUser(t *testing.T) {
	t.Parallel()

	if got := toolNames(builtInControlSignalDefinitions()); !reflect.DeepEqual(got, []string{"user_ask"}) {
		t.Fatalf("control signals=%v, want [user_ask]", got)
	}
	for i, def := range builtInControlSignalDefinitions() {
		if def.Description != flruntime.CoreControlDefinitions()[i].Description {
			t.Fatalf("host overrides runtime question scope: %s", def.Description)
		}
	}
}

func TestRunCapabilityContractKeepsOnlyAvailableInteractionSignal(t *testing.T) {
	t.Parallel()

	contract := resolveRunCapabilityContract(nil, nil, []ToolDef{
		{Name: "user_ask"},
	}, false)
	if !reflect.DeepEqual(contract.AllowedSignals, []string{"user_ask"}) {
		t.Fatalf("allowed signals=%v, want [user_ask]", contract.AllowedSignals)
	}
}
