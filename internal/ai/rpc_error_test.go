package ai

import "testing"

func TestToAIRPCErrorDoesNotExposeLegacyStopAuthorityErrors(t *testing.T) {
	t.Parallel()
	got := toAIRPCError(ErrThreadContinuationRetryUnavailable)
	if got == nil || got.Code != 400 {
		t.Fatalf("toAIRPCError=%#v, want ordinary command error", got)
	}
}
