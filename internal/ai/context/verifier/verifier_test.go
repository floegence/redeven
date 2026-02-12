package verifier

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
)

func TestVerify_PassWithSufficientSaving(t *testing.T) {
	t.Parallel()

	before := model.PromptPack{
		ActiveConstraints: []string{"must keep tests"},
		PendingTodos:      []model.MemoryItem{{MemoryID: "todo_1", Content: "fix tests"}},
		ExecutionEvidence: []model.ExecutionEvidence{{SpanID: "span_1", Summary: "long long long long long long long long long long"}},
		RecentDialogue:    []model.DialogueTurn{{UserText: "a very long request that includes many details"}, {AssistantText: "a very long answer with repeated lines and details"}},
	}
	after := model.PromptPack{
		ActiveConstraints: []string{"must keep tests"},
		PendingTodos:      []model.MemoryItem{{MemoryID: "todo_1", Content: "fix tests"}},
		ExecutionEvidence: []model.ExecutionEvidence{{SpanID: "span_1", Summary: "short evidence"}},
		RecentDialogue:    []model.DialogueTurn{{AssistantText: "short"}},
	}
	result := Verify(VerifyInput{Before: before, After: after, RequiredSavingRatio: 0.2})
	if !result.Pass {
		t.Fatalf("expected pass, got %+v", result)
	}
}

func TestVerify_FailWhenConstraintMissing(t *testing.T) {
	t.Parallel()

	before := model.PromptPack{ActiveConstraints: []string{"must not delete files"}}
	after := model.PromptPack{ActiveConstraints: nil}
	result := Verify(VerifyInput{Before: before, After: after, RequiredSavingRatio: 0})
	if result.Pass {
		t.Fatalf("expected fail")
	}
	if !result.MissingConstraints {
		t.Fatalf("expected MissingConstraints=true")
	}
}
