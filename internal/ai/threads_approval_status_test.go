package ai

import (
	"context"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

func TestGetThreadAndListThreadsUseCanonicalFloretStatus(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_canonical_status")
	thread, err := svc.CreateThread(ctx, meta, "canonical status", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "complete")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_status", RunID: "run_status", Input: "work"}); err != nil {
		t.Fatal(err)
	}
	view, err := svc.GetThread(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if view.RunStatus != string(RunStateSuccess) || view.ActiveRunID != "" || view.LastMessagePreview == "" {
		t.Fatalf("unexpected canonical thread view: %#v", view)
	}
	list, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Threads) != 1 || list.Threads[0].RunStatus != string(RunStateSuccess) || list.Threads[0].LastMessagePreview != view.LastMessagePreview {
		t.Fatalf("list did not use canonical state: %#v", list.Threads)
	}
}

func TestGetThreadReturnsConsistencyErrorWhenFloretThreadIsMissing(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_missing_canonical")
	thread, err := svc.CreateThread(ctx, meta, "missing", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host, err := svc.openFloretMaintenanceHost()
	if err != nil {
		t.Fatal(err)
	}
	if err := host.DeleteThread(ctx, flruntime.ThreadID(thread.ThreadID)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetThread(ctx, meta, thread.ThreadID); err == nil {
		t.Fatal("missing canonical Floret thread was treated as idle")
	}
}
