package ai

import "testing"

func TestNormalizeTaskComplexity(t *testing.T) {
	t.Parallel()

	if got := normalizeTaskComplexity("simple"); got != TaskComplexitySimple {
		t.Fatalf("simple => %q", got)
	}
	if got := normalizeTaskComplexity("complex"); got != TaskComplexityComplex {
		t.Fatalf("complex => %q", got)
	}
	if got := normalizeTaskComplexity("unknown"); got != TaskComplexityStandard {
		t.Fatalf("unknown => %q", got)
	}
}

func TestNormalizeTodoPolicy(t *testing.T) {
	t.Parallel()

	if got := normalizeTodoPolicy("none"); got != TodoPolicyNone {
		t.Fatalf("none => %q", got)
	}
	if got := normalizeTodoPolicy("required"); got != TodoPolicyRequired {
		t.Fatalf("required => %q", got)
	}
	if got := normalizeTodoPolicy("anything"); got != TodoPolicyRecommended {
		t.Fatalf("fallback => %q", got)
	}
}

func TestNormalizeMinimumTodoItems(t *testing.T) {
	t.Parallel()

	if got := normalizeMinimumTodoItems(TodoPolicyNone, 9); got != 0 {
		t.Fatalf("none policy => %d, want 0", got)
	}
	if got := normalizeMinimumTodoItems(TodoPolicyRecommended, 9); got != 0 {
		t.Fatalf("recommended policy => %d, want 0", got)
	}
	if got := normalizeMinimumTodoItems(TodoPolicyRequired, 1); got != 3 {
		t.Fatalf("required min clamp => %d, want 3", got)
	}
	if got := normalizeMinimumTodoItems(TodoPolicyRequired, 5); got != 5 {
		t.Fatalf("required keep => %d, want 5", got)
	}
}
