package ai

import "testing"

func containsString(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func TestDefaultSubagentToolAllowlists_ExcludeAskUser(t *testing.T) {
	readonlyAllowlist := defaultSubagentToolAllowlistReadonly()
	if containsString(readonlyAllowlist, "ask_user") {
		t.Fatalf("readonly default allowlist unexpectedly contains ask_user")
	}
	workerAllowlist := defaultSubagentToolAllowlistWorker()
	if containsString(workerAllowlist, "ask_user") {
		t.Fatalf("worker default allowlist unexpectedly contains ask_user")
	}
}

func TestSanitizeSubagentToolAllowlist_FiltersDisallowedAndDuplicates(t *testing.T) {
	in := []string{"ask_user", "subagents", "terminal.exec", "terminal.exec", "task_complete"}
	got := sanitizeSubagentToolAllowlist(in, defaultSubagentToolAllowlistWorker(), false)
	if len(got) != 2 || got[0] != "terminal.exec" || got[1] != "task_complete" {
		t.Fatalf("sanitizeSubagentToolAllowlist()=%v, want [terminal.exec task_complete]", got)
	}
}

func TestSanitizeReadonlyAllowlist_DropsMutatingAndAskUser(t *testing.T) {
	got := sanitizeReadonlyAllowlist([]string{"apply_patch", "ask_user", "terminal.exec"})
	if len(got) != 1 || got[0] != "terminal.exec" {
		t.Fatalf("sanitizeReadonlyAllowlist()=%v, want [terminal.exec]", got)
	}
}

func TestSanitizeSubagentToolAllowlist_FallbacksWhenInputEmptyOrInvalid(t *testing.T) {
	fallback := defaultSubagentToolAllowlistWorker()
	got := sanitizeSubagentToolAllowlist([]string{"ask_user"}, fallback, false)
	if len(got) == 0 {
		t.Fatalf("sanitizeSubagentToolAllowlist() returned empty allowlist")
	}
	if containsString(got, "ask_user") {
		t.Fatalf("fallback allowlist unexpectedly contains ask_user")
	}
}

func TestRegisterBuiltInTools_OmitsAskUserWhenNoUserInteraction(t *testing.T) {
	reg := NewInMemoryToolRegistry()
	r := &run{
		allowSubagentDelegate: true,
		noUserInteraction:     true,
		webSearchToolEnabled:  true,
	}
	if err := registerBuiltInTools(reg, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	if _, _, ok := reg.resolve("ask_user"); ok {
		t.Fatalf("ask_user should be excluded when no-user-interaction policy is enabled")
	}
	if _, _, ok := reg.resolve("task_complete"); !ok {
		t.Fatalf("task_complete should remain available")
	}
}

func TestRegisterBuiltInTools_IncludesAskUserByDefault(t *testing.T) {
	reg := NewInMemoryToolRegistry()
	r := &run{
		allowSubagentDelegate: true,
		noUserInteraction:     false,
		webSearchToolEnabled:  true,
	}
	if err := registerBuiltInTools(reg, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	if _, _, ok := reg.resolve("ask_user"); !ok {
		t.Fatalf("ask_user should be registered when no-user-interaction policy is disabled")
	}
}
