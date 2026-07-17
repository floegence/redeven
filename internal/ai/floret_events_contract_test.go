package ai

import (
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

func TestValidateFloretRuntimeEventRequiresConfiguredProductAssociation(t *testing.T) {
	t.Parallel()

	r := &run{}
	r.expectFloretRuntimeEventIdentity("run-1", "thread-1", "turn-1", true)
	valid := flruntime.Event{
		Type:     observation.EventTypeStepStart,
		RunID:    "run-1",
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Step:     1,
	}
	if err := r.validateFloretRuntimeEvent(valid); err != nil {
		t.Fatalf("validate matching event: %v", err)
	}
	wrongRun := valid
	wrongRun.RunID = "run-2"
	if err := r.validateFloretRuntimeEvent(wrongRun); err == nil {
		t.Fatal("event from another run was accepted")
	}
	wrongThread := valid
	wrongThread.ThreadID = "thread-2"
	if err := r.validateFloretRuntimeEvent(wrongThread); err == nil {
		t.Fatal("event from another thread was accepted")
	}

	r.expectFloretRuntimeEventIdentity("", "thread-1", "", false)
	standaloneCompaction := valid
	standaloneCompaction.RunID = "floret-generated-run"
	standaloneCompaction.TurnID = ""
	if err := r.validateFloretRuntimeEvent(standaloneCompaction); err != nil {
		t.Fatalf("validate standalone compaction association: %v", err)
	}
}
