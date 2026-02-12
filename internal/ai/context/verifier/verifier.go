package verifier

import (
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
)

// VerifyInput contains source and compressed prompt packs.
type VerifyInput struct {
	Before              model.PromptPack
	After               model.PromptPack
	RequiredSavingRatio float64
}

// VerifyResult reports compression quality gates.
type VerifyResult struct {
	Pass                bool
	SavingRatio         float64
	MissingConstraints  bool
	MissingPendingTodos bool
	MissingEvidenceRefs bool
	Reason              string
}

func Verify(in VerifyInput) VerifyResult {
	beforeText := in.Before.ApproxText()
	afterText := in.After.ApproxText()
	beforeRunes := len([]rune(beforeText))
	afterRunes := len([]rune(afterText))
	saving := 0.0
	if beforeRunes > 0 {
		saving = float64(beforeRunes-afterRunes) / float64(beforeRunes)
	}

	required := in.RequiredSavingRatio
	if required <= 0 {
		required = 0.35
	}

	missingConstraints := !containsAllStrings(in.After.ActiveConstraints, in.Before.ActiveConstraints)
	missingTodos := !containsAllMemory(in.After.PendingTodos, in.Before.PendingTodos)
	missingEvidence := !containsAllEvidenceIDs(in.After.ExecutionEvidence, in.Before.ExecutionEvidence)

	pass := !missingConstraints && !missingTodos && !missingEvidence && saving >= required
	reasonParts := make([]string, 0, 4)
	if missingConstraints {
		reasonParts = append(reasonParts, "constraints_lost")
	}
	if missingTodos {
		reasonParts = append(reasonParts, "pending_todos_lost")
	}
	if missingEvidence {
		reasonParts = append(reasonParts, "evidence_refs_lost")
	}
	if saving < required {
		reasonParts = append(reasonParts, "saving_below_threshold")
	}
	reason := strings.Join(reasonParts, ",")

	return VerifyResult{
		Pass:                pass,
		SavingRatio:         saving,
		MissingConstraints:  missingConstraints,
		MissingPendingTodos: missingTodos,
		MissingEvidenceRefs: missingEvidence,
		Reason:              reason,
	}
}

func containsAllStrings(after []string, before []string) bool {
	if len(before) == 0 {
		return true
	}
	set := make(map[string]struct{}, len(after))
	for _, v := range after {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		set[v] = struct{}{}
	}
	for _, v := range before {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := set[v]; !ok {
			return false
		}
	}
	return true
}

func containsAllMemory(after []model.MemoryItem, before []model.MemoryItem) bool {
	if len(before) == 0 {
		return true
	}
	set := map[string]struct{}{}
	for _, item := range after {
		id := strings.TrimSpace(item.MemoryID)
		if id == "" {
			continue
		}
		set[id] = struct{}{}
	}
	for _, item := range before {
		id := strings.TrimSpace(item.MemoryID)
		if id == "" {
			continue
		}
		if _, ok := set[id]; !ok {
			return false
		}
	}
	return true
}

func containsAllEvidenceIDs(after []model.ExecutionEvidence, before []model.ExecutionEvidence) bool {
	if len(before) == 0 {
		return true
	}
	set := map[string]struct{}{}
	for _, ev := range after {
		id := strings.TrimSpace(ev.SpanID)
		if id == "" {
			continue
		}
		set[id] = struct{}{}
	}
	for _, ev := range before {
		id := strings.TrimSpace(ev.SpanID)
		if id == "" {
			continue
		}
		if _, ok := set[id]; !ok {
			return false
		}
	}
	return true
}
