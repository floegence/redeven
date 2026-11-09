package automation

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redevplugin/v3/pkg/schedule"
)

func TestScheduleDispatchPinnedVersionPauseRestartAndRevocation(t *testing.T) {
	store, engine, run := fixture(t, []Node{agent("one")})
	path := filepath.Join(t.TempDir(), "schedules.sqlite")
	plans, err := schedule.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = plans.Close() }()
	adapter := &Schedules{Store: store, Plans: plans, Authorize: engine.Executor.Authorize}
	input := ScheduleInput{Version: 1, Enabled: true, Cadence: schedule.Cadence{Kind: "interval", IntervalMS: 1000}, Overlap: "queue", Missed: "latest", QueueLimit: 2}
	plan, err := adapter.Save(t.Context(), testOwner, run.WorkflowID, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = adapter.Save(t.Context(), testOwner, run.WorkflowID, input); !errors.Is(err, ErrConflict) {
		t.Fatal("stale plan accepted", err)
	}
	claims, err := plans.Tick(t.Context(), plan.NextAt.Add(time.Millisecond), false, 10)
	if err != nil || len(claims) != 1 {
		t.Fatal(claims, err)
	}
	claim := claims[0]
	// Admission succeeds, then the process loses its response before Accept.
	first, err := adapter.Submit(t.Context(), claim)
	if err != nil || first.Reference == "" {
		t.Fatal(first, err)
	}
	if err = plans.Close(); err != nil {
		t.Fatal(err)
	}
	plans, err = schedule.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	adapter.Plans = plans
	retained, err := plans.Claims(t.Context(), scheduleOwner(testOwner), run.WorkflowID)
	if err != nil || len(retained) != 1 || retained[0].State != "unknown" {
		t.Fatal(retained, err)
	}
	second, err := adapter.Inspect(t.Context(), retained[0])
	if err != nil || second.Reference != first.Reference {
		t.Fatal("lost original admission", second, err)
	}
	if err = plans.Accept(t.Context(), claim.Owner, claim.ID, second.Reference); err != nil {
		t.Fatal(err)
	}
	rows, _ := store.Runs(t.Context(), testOwner, run.WorkflowID)
	if len(rows) != 2 {
		t.Fatal("duplicate scheduled execution", len(rows))
	}
	if err = adapter.Pause(t.Context(), testOwner, run.WorkflowID); err != nil {
		t.Fatal(err)
	}
	scheduled, _ := store.Run(t.Context(), testOwner, first.Reference)
	if scheduled.CancelRequested {
		t.Fatal("pause canceled an admitted run")
	}
	if next, err := plans.Tick(t.Context(), plan.NextAt.Add(time.Hour), false, 10); err != nil || len(next) != 0 {
		t.Fatal("paused plan dispatched", next, err)
	}
	// A future published version never changes the original pinned run.
	workflow, _ := store.Get(t.Context(), testOwner, run.WorkflowID)
	grant, _ := store.Grant(t.Context(), testOwner, workflow.ID)
	if _, err = store.Publish(t.Context(), testOwner, workflow.ID, workflow.Revision, grant); err != nil {
		t.Fatal(err)
	}
	if scheduled.DefinitionVersion != 1 {
		t.Fatal("publication rewrote admitted version")
	}
	current, _ := adapter.Get(t.Context(), testOwner, workflow.ID)
	input.Revision = current.Revision
	input.Version = 2
	plan, err = adapter.Save(t.Context(), testOwner, workflow.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	// The old claim still blocks overlap until the canonical target settles.
	if err = plans.Resolve(t.Context(), claim.Owner, claim.ID, "completed", time.Now()); err != nil {
		t.Fatal(err)
	}
	next, err := plans.Tick(t.Context(), plan.NextAt.Add(time.Millisecond), false, 10)
	if err != nil || len(next) != 1 {
		t.Fatal(next, err)
	}
	engine.Executor.(*testExecutor).revoked = true
	denied, err := adapter.Submit(t.Context(), next[0])
	if err != nil || denied.Outcome != "not_committed" {
		t.Fatal("revoked dispatch admitted", denied, err)
	}
	if _, err = store.RunForRequest(t.Context(), testOwner, next[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("denied run persisted", err)
	}
	if _, err = adapter.Get(context.Background(), Owner{"foreign", "env"}, workflow.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign plan read", err)
	}
}
