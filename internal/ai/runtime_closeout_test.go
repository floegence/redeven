package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestFinalizeIfContextCanceledWithRuntimeCloseout_FinalizesStructuredSuccess(t *testing.T) {
	t.Parallel()

	r := &run{messageID: "msg_runtime_closeout_timeout"}
	r.ensureAssistantMessageStarted()
	if err := r.appendTextDelta("Verified final answer with concrete evidence."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	state := runtimeState{
		CompletedActionFacts: []string{"file.write: updated note"},
	}
	if !r.finalizeIfContextCanceledWithRuntimeCloseout(ctx, 2, state, TaskComplexityStandard, config.AIModeAct, defaultStructuredProtocolProfile(), false) {
		t.Fatalf("expected runtime closeout recovery on canceled context")
	}
	if got := r.getFinalizationReason(); got != finalizationReasonProtocolCloseout {
		t.Fatalf("finalization_reason=%q, want %q", got, finalizationReasonProtocolCloseout)
	}
	if got := r.getEndReason(); got != "complete" {
		t.Fatalf("end_reason=%q, want complete", got)
	}
}
