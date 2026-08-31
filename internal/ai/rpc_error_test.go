package ai

import "testing"

func TestToAIRPCErrorDoesNotExposeLegacyStopAuthorityErrors(t *testing.T) {
	t.Parallel()
	got := toAIRPCError(ErrThreadContinuationRetryUnavailable)
	if got == nil || got.Code != 400 {
		t.Fatalf("toAIRPCError=%#v, want ordinary command error", got)
	}
}

func TestToAIRPCErrorMapsThreadModelConflict(t *testing.T) {
	t.Parallel()
	got := toAIRPCError(ErrThreadModelConflict)
	if got == nil || got.Code != 409 {
		t.Fatalf("toAIRPCError=%#v, want conflict", got)
	}
}
