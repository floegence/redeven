package ai

import (
	"testing"
	"time"
)

func TestFlowerIdentityStaysStableWhenRuntimeFactsChange(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root})
	for i, permission := range []FlowerPermissionType{FlowerPermissionApprovalRequired, FlowerPermissionReadonly} {
		surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, permission)
		if err != nil {
			t.Fatal(err)
		}
		assertFlowerSystemPrompt(t, surface.SystemPrompt)
		now := func() time.Time { return time.Date(2026, 10, 20+i, 12, 0, 0, 0, time.UTC) }
		snapshot, err := r.collectModelContextSnapshot(t.Context(), permission, now)
		if err != nil {
			t.Fatal(err)
		}
		facts := modelContextSnapshotText(snapshot)
		for _, want := range []string{root, "- Current date: " + now().Format("2006-01-02"), "- Timezone: UTC", "- Permission type: " + string(permission)} {
			assertPromptContains(t, facts, want)
			assertPromptNotContains(t, surface.SystemPrompt, want)
		}
	}
}
