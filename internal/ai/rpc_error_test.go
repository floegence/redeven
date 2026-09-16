package ai

import (
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

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

func TestAIRPCErrorResponseConflict(t *testing.T) {
	if got := toAIRPCError(flruntime.ErrRequestConflict); got.Code != 409 {
		t.Fatalf("response conflict=%#v", got)
	}
}
