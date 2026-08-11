package ai

import (
	"testing"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
)

func TestContinuationRetryLogicalRequestIDIsStableAndSourceScoped(t *testing.T) {
	source := &flruntime.ThreadTurnSnapshot{
		TurnID: "turn-failed",
		RunID: "run-failed",
		Status: flruntime.TurnStatusFailed,
		CanRetry: true,
	}
	firstID, firstExecution, err := continuationRetryLogicalRequestID("thread-a", source)
	if err != nil {
		t.Fatal(err)
	}
	secondID, secondExecution, err := continuationRetryLogicalRequestID("thread-a", source)
	if err != nil {
		t.Fatal(err)
	}
	if firstID == "" || firstID != secondID || firstExecution == "" || firstExecution != secondExecution {
		t.Fatalf("retry identities are not stable: first=(%q,%q) second=(%q,%q)", firstID, firstExecution, secondID, secondExecution)
	}
	otherID, _, err := continuationRetryLogicalRequestID("thread-a", &flruntime.ThreadTurnSnapshot{
		TurnID: "turn-second-failure", RunID: "run-second-failure", Status: flruntime.TurnStatusFailed, CanRetry: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if otherID == firstID {
		t.Fatal("a later failed continuation reused the prior retry mutation identity")
	}
	if _, err := identity.ParseLogicalRequestID(firstID.String()); err != nil {
		t.Fatalf("derived retry identity is invalid: %v", err)
	}
}

func TestContinuationRetryRequiresCanonicalRetryableFailure(t *testing.T) {
	for _, turn := range []*flruntime.ThreadTurnSnapshot{
		nil,
		{TurnID: "turn", RunID: "run", Status: flruntime.TurnStatusCompleted, CanRetry: false},
		{TurnID: "turn", RunID: "run", Status: flruntime.TurnStatusFailed, CanRetry: false},
	} {
		if _, _, err := continuationRetryLogicalRequestID("thread", turn); err == nil {
			t.Fatalf("non-retryable turn unexpectedly produced an identity: %#v", turn)
		}
	}
}

func TestCanonicalContinuationRetryAlreadyAcceptedOnlyForLiveOrCompletedRetry(t *testing.T) {
	retry := &flruntime.ThreadTurnSnapshot{RetrySource: &flruntime.ThreadTurnRetrySource{TurnID: "turn-source"}}
	for _, status := range []flruntime.ThreadStatus{
		flruntime.ThreadStatusRunning,
		flruntime.ThreadStatusWaiting,
		flruntime.ThreadStatusCompleted,
	} {
		if !canonicalContinuationRetryAlreadyAccepted(flruntime.ThreadSnapshot{Status: status}, retry) {
			t.Fatalf("status %q was not accepted as an idempotent retry replay", status)
		}
	}
	if canonicalContinuationRetryAlreadyAccepted(flruntime.ThreadSnapshot{Status: flruntime.ThreadStatusFailed}, retry) {
		t.Fatal("failed retry was treated as completed instead of allowing another retry")
	}
	if canonicalContinuationRetryAlreadyAccepted(flruntime.ThreadSnapshot{Status: flruntime.ThreadStatusCompleted}, &flruntime.ThreadTurnSnapshot{}) {
		t.Fatal("ordinary completed turn was treated as a retry replay")
	}
}
