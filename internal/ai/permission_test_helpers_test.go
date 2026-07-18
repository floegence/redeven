package ai

import "testing"

func allowToolsForTest(t *testing.T, r *run, names ...string) {
	t.Helper()
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	tools := make([]ToolDef, 0, len(names))
	for _, name := range names {
		def, _, ok := registry.resolve(name)
		if !ok {
			t.Fatalf("resolve tool %q", name)
		}
		tools = append(tools, def)
	}
	r.permissionType = FlowerPermissionFullAccess
	if len(tools) > 0 {
		readonlyOnly := true
		for _, def := range tools {
			if def.Visibility != ToolVisibilityReadonlyExclusive {
				readonlyOnly = false
				break
			}
		}
		if readonlyOnly {
			r.permissionType = FlowerPermissionReadonly
		}
	}
	r.permissionSnapshot = permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(r.permissionType, tools, nil),
		r.endpointID,
		r.threadID,
		r.id,
	)
}
