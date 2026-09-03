package ai

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type executionAuthorityViewResult struct {
	view flruntime.ThreadView
	err  error
}

type executionAuthorityTestViewer struct {
	results map[string]executionAuthorityViewResult
	calls   map[string]int
}

func (viewer *executionAuthorityTestViewer) View(_ context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
	if viewer.calls == nil {
		viewer.calls = make(map[string]int)
	}
	viewer.calls[threadID.String()]++
	result, ok := viewer.results[threadID.String()]
	if !ok {
		return flruntime.ThreadView{}, flruntime.ErrThreadNotFound
	}
	return result.view, result.err
}

func TestExecutionAuthorityPruningUsesCanonicalThreadView(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const cutoff = int64(1000)
	failed := flruntime.TurnOutcomeFailed
	completed := flruntime.TurnOutcomeCompleted
	viewer := &executionAuthorityTestViewer{results: map[string]executionAuthorityViewResult{
		"thread_active":   {view: flruntime.ThreadView{ThreadID: "thread_active", TurnID: "turn_active", Activity: flruntime.ThreadActivityActive}},
		"thread_waiting":  {view: flruntime.ThreadView{ThreadID: "thread_waiting", TurnID: "turn_waiting", Activity: flruntime.ThreadActivityActive, Attention: flruntime.AttentionSummary{InputCount: 1}}},
		"thread_queued":   {view: flruntime.ThreadView{ThreadID: "thread_queued", Activity: flruntime.ThreadActivityIdle, Queue: []flruntime.QueuedInput{{RequestKey: "request_queued"}}}},
		"thread_failed":   {view: flruntime.ThreadView{ThreadID: "thread_failed", TurnID: "turn_failed", Activity: flruntime.ThreadActivityIdle, LastOutcome: &failed}},
		"thread_complete": {view: flruntime.ThreadView{ThreadID: "thread_complete", TurnID: "turn_complete", Activity: flruntime.ThreadActivityIdle, LastOutcome: &completed}},
		"thread_recent":   {view: flruntime.ThreadView{ThreadID: "thread_recent", TurnID: "turn_recent", Activity: flruntime.ThreadActivityIdle, LastOutcome: &completed}},
		"thread_error":    {err: errors.New("canonical store unavailable")},
		"thread_deleted":  {err: flruntime.ErrThreadDeleted},
	}}
	authorities := []threadstore.ExecutionAuthority{
		{RequestKey: "request_active", ThreadID: "thread_active", TurnID: "turn_active", CreatedAtUnixMs: 1},
		{RequestKey: "request_waiting", ThreadID: "thread_waiting", TurnID: "turn_waiting", CreatedAtUnixMs: 1},
		{RequestKey: "request_queued", ThreadID: "thread_queued", CreatedAtUnixMs: 1},
		{RequestKey: "request_failed", ThreadID: "thread_failed", TurnID: "turn_failed", CreatedAtUnixMs: 1},
		{RequestKey: "request_complete", ThreadID: "thread_complete", TurnID: "turn_complete", CreatedAtUnixMs: cutoff},
		{RequestKey: "request_recent", ThreadID: "thread_recent", TurnID: "turn_recent", CreatedAtUnixMs: cutoff + 1},
		{RequestKey: "request_error", ThreadID: "thread_error", TurnID: "turn_error", CreatedAtUnixMs: 1},
		{RequestKey: "request_missing", ThreadID: "thread_missing", CreatedAtUnixMs: cutoff + 1},
		{RequestKey: "request_deleted", ThreadID: "thread_deleted", CreatedAtUnixMs: cutoff + 1},
	}
	for index := range authorities {
		authorities[index].EndpointID = "endpoint"
		authorities[index].UserPublicID = "user"
		if err := store.PutExecutionAuthority(t.Context(), authorities[index]); err != nil {
			t.Fatal(err)
		}
	}
	var cursor threadstore.ExecutionAuthorityCursor
	var removed int64
	for page := 0; page < 10; page++ {
		next, count, err := pruneExecutionAuthorityPage(t.Context(), store, viewer, cursor, cutoff, 2)
		if err != nil {
			t.Fatal(err)
		}
		removed += count
		cursor = next
		if cursor == (threadstore.ExecutionAuthorityCursor{}) {
			break
		}
	}
	if removed != 3 || cursor != (threadstore.ExecutionAuthorityCursor{}) {
		t.Fatalf("removed=%d cursor=%#v, want 3 and reset cursor", removed, cursor)
	}
	for _, requestKey := range []string{"request_complete", "request_missing", "request_deleted"} {
		if authority, err := store.GetExecutionAuthority(t.Context(), requestKey); err != nil || authority != nil {
			t.Fatalf("deleted authority %q=%#v err=%v", requestKey, authority, err)
		}
	}
	for _, requestKey := range []string{"request_active", "request_waiting", "request_queued", "request_failed", "request_recent", "request_error"} {
		if authority, err := store.GetExecutionAuthority(t.Context(), requestKey); err != nil || authority == nil {
			t.Fatalf("preserved authority %q=%#v err=%v", requestKey, authority, err)
		}
	}
	for threadID, calls := range viewer.calls {
		if calls != 1 {
			t.Fatalf("View(%q) calls=%d, want one per page-local thread", threadID, calls)
		}
	}
}
