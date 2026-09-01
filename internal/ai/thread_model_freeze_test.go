package ai

import (
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestCanonicalThreadBusyIncludesQueuedTurns(t *testing.T) {
	t.Parallel()
	if !canonicalThreadBusy(flruntime.ThreadView{Queue: []flruntime.QueuedInput{{ID: "queued"}}}) {
		t.Fatal("queued turn must freeze thread settings")
	}
}
