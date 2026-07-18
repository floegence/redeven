package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadTimelineUsesCanonicalFloretOrdinalOrder(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_order")
	thread, err := svc.CreateThread(ctx, meta, "order", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "done")
	for i := 1; i <= 3; i++ {
		_, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
			ThreadID: flruntime.ThreadID(thread.ThreadID),
			TurnID:   flruntime.TurnID(fmt.Sprintf("turn_%d", i)),
			RunID:    flruntime.RunID(fmt.Sprintf("run_%d", i)),
			Input:    fmt.Sprintf("user %d", i),
		})
		if err != nil {
			t.Fatalf("RunTurn %d: %v", i, err)
		}
	}
	response, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Messages) != 6 {
		t.Fatalf("message count = %d, want 6", len(response.Messages))
	}
	wantRoles := []string{"user", "assistant", "user", "assistant", "user", "assistant"}
	wantIDs := []string{"", "turn_1", "", "turn_2", "", "turn_3"}
	for index, value := range response.Messages {
		record := decodeTimelineMessageForTest(t, value)
		if record.Role != wantRoles[index] {
			t.Fatalf("message %d role = %q, want %q", index, record.Role, wantRoles[index])
		}
		if wantIDs[index] != "" && record.ID != wantIDs[index] {
			t.Fatalf("message %d id = %q, want %q", index, record.ID, wantIDs[index])
		}
	}
	last := decodeTimelineMessageForTest(t, response.Messages[len(response.Messages)-2])
	if last.Role != "user" || last.Content != "user 3" {
		t.Fatalf("latest user message is not last canonical turn: %#v", last)
	}
}

func TestThreadTimelineBeforeAndAfterPaginationPreservesCanonicalOrder(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_page")
	thread, err := svc.CreateThread(ctx, meta, "pages", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "done")
	for i := 1; i <= 3; i++ {
		if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(fmt.Sprintf("turn_%d", i)), RunID: flruntime.RunID(fmt.Sprintf("run_%d", i)), Input: fmt.Sprintf("user %d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	latest, nextBefore, hasMore, err := svc.listThreadTimelineMessages(ctx, meta.EndpointID, thread.ThreadID, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(latest) != 2 || !hasMore || nextBefore <= 0 || latest[0].MessageID == "" || latest[1].MessageID != "turn_3" {
		t.Fatalf("unexpected latest page: %#v next=%d more=%v", latest, nextBefore, hasMore)
	}
	older, _, _, err := svc.listThreadTimelineMessages(ctx, meta.EndpointID, thread.ThreadID, 2, nextBefore)
	if err != nil {
		t.Fatal(err)
	}
	if len(older) != 2 || older[1].MessageID != "turn_2" {
		t.Fatalf("unexpected older page: %#v", older)
	}
	after, _, moreAfter, err := svc.listThreadTimelineMessagesAfter(ctx, meta.EndpointID, thread.ThreadID, 2, older[1].RowID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 2 || after[1].MessageID != "turn_3" || moreAfter {
		t.Fatalf("unexpected after page: %#v more=%v", after, moreAfter)
	}
}

func TestThreadTimelineRejectsUnknownPaginationCursor(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_unknown_cursor")
	thread, err := svc.CreateThread(ctx, meta, "unknown cursor", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: "hello"}); err != nil {
		t.Fatal(err)
	}

	if _, _, _, err := svc.listThreadTimelineMessages(ctx, meta.EndpointID, thread.ThreadID, 2, 999); !errors.Is(err, ErrCanonicalTimelineResyncRequired) {
		t.Fatalf("before cursor error = %v, want canonical resync", err)
	}
	if _, _, _, err := svc.listThreadTimelineMessagesAfter(ctx, meta.EndpointID, thread.ThreadID, 2, 999, false); !errors.Is(err, ErrCanonicalTimelineResyncRequired) {
		t.Fatalf("after cursor error = %v, want canonical resync", err)
	}
}

func TestCanonicalThreadStateRequiresMatchingSnapshotAndTailPage(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_snapshot_consistency")
	thread, err := svc.CreateThread(ctx, meta, "snapshot consistency", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: "hello"}); err != nil {
		t.Fatal(err)
	}
	maintenance, err := svc.openFloretMaintenanceHost()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := maintenance.ReadThread(ctx, flruntime.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	page, err := maintenance.ListThreadTurns(ctx, flruntime.ListThreadTurnsRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), Tail: 1})
	if err != nil {
		t.Fatal(err)
	}
	latest, err := canonicalThreadStateFromPage(snapshot, page)
	if err != nil {
		t.Fatalf("canonical state: %v", err)
	}
	if latest == nil || latest.TurnID != "turn_1" || latest.RunID != "run_1" {
		t.Fatalf("latest = %#v", latest)
	}

	for _, test := range []struct {
		name   string
		mutate func(*flruntime.ThreadSnapshot, *flruntime.ThreadTurnsPage)
	}{
		{name: "thread identity", mutate: func(_ *flruntime.ThreadSnapshot, page *flruntime.ThreadTurnsPage) { page.ThreadID = "other" }},
		{name: "turn identity", mutate: func(_ *flruntime.ThreadSnapshot, page *flruntime.ThreadTurnsPage) { page.Turns[0].RunID = "other" }},
		{name: "projection identity", mutate: func(_ *flruntime.ThreadSnapshot, page *flruntime.ThreadTurnsPage) {
			page.Turns[0].Projection.RunID = "other"
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			changedSnapshot := snapshot
			changedPage := page
			changedPage.Turns = append([]flruntime.ThreadTurnSnapshot(nil), page.Turns...)
			test.mutate(&changedSnapshot, &changedPage)
			if _, err := canonicalThreadStateFromPage(changedSnapshot, changedPage); !errors.Is(err, ErrCanonicalTimelineResyncRequired) {
				t.Fatalf("error = %v, want canonical resync", err)
			}
		})
	}

	newerPage := page
	newerPage.ThroughOrdinal++
	if _, err := canonicalThreadStateFromPage(snapshot, newerPage); err != nil {
		t.Fatalf("adjacent canonical revisions must remain readable: %v", err)
	}
	startedSnapshot := snapshot
	startedSnapshot.LatestTurnID = "turn_started_only"
	startedSnapshot.LatestRunID = "run_started_only"
	if _, err := canonicalThreadStateFromPage(startedSnapshot, page); err != nil {
		t.Fatalf("thread lifecycle may be newer than the admitted turn tail: %v", err)
	}
	emptyStartedPage := flruntime.ThreadTurnsPage{ThreadID: snapshot.ID, ThroughOrdinal: snapshot.ThroughOrdinal}
	if latest, err := canonicalThreadStateFromPage(startedSnapshot, emptyStartedPage); err != nil || latest != nil {
		t.Fatalf("started-only turn must remain outside the admitted tail: latest=%#v err=%v", latest, err)
	}
}

func TestUnmatchedLiveDraftTriggersResyncInsteadOfTailAppend(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_resync")
	thread, err := svc.CreateThread(ctx, meta, "resync", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: "hello"}); err != nil {
		t.Fatal(err)
	}
	state := FlowerLiveMaterializedState{Messages: map[string]FlowerLiveMessageDraft{
		"turn_stale": {ThreadID: thread.ThreadID, TurnID: "turn_stale", RunID: "run_stale", MessageID: "turn_stale", Role: "assistant", Status: "streaming"},
	}}
	if _, err := svc.buildFlowerTimelineProjection(ctx, meta.EndpointID, thread.ThreadID, state); err == nil {
		t.Fatal("unmatched draft was accepted")
	}
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(meta.EndpointID, thread.ThreadID)]
	svc.mu.Unlock()
	if stream == nil || len(stream.Events) == 0 || stream.Events[len(stream.Events)-1].Kind != FlowerLiveResyncRequired {
		t.Fatalf("missing resync event: %#v", stream)
	}
}

func TestTerminalCanonicalTurnDropsStaleLiveDraftBeforeRendering(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_terminal_draft")
	thread, err := svc.CreateThread(ctx, meta, "terminal draft", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHost(t, svc.floretStore, "canonical terminal")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_terminal", RunID: "run_terminal", Input: "hello",
	}); err != nil {
		t.Fatal(err)
	}

	state := FlowerLiveMaterializedState{Messages: map[string]FlowerLiveMessageDraft{
		"turn_terminal": {
			ThreadID:  thread.ThreadID,
			TurnID:    "turn_terminal",
			RunID:     "run_terminal",
			MessageID: "turn_terminal",
			Role:      "assistant",
			Status:    "streaming",
		},
	}}
	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	svc.mu.Lock()
	stream := newFlowerLiveThreadStream()
	stream.State.Messages["turn_terminal"] = state.Messages["turn_terminal"]
	svc.flowerLiveByThread[threadKey] = stream
	svc.mu.Unlock()

	projection, err := svc.buildFlowerTimelineProjection(ctx, meta.EndpointID, thread.ThreadID, state)
	if err != nil {
		t.Fatalf("buildFlowerTimelineProjection: %v", err)
	}
	if len(projection.Messages) != 2 || projection.Messages[1].MessageID != "turn_terminal" || projection.Messages[1].Content != "canonical terminal" {
		t.Fatalf("projection messages=%#v, want canonical terminal replacement", projection.Messages)
	}
	svc.mu.Lock()
	_, stillLive := svc.flowerLiveByThread[threadKey].State.Messages["turn_terminal"]
	svc.mu.Unlock()
	if stillLive {
		t.Fatal("terminal canonical turn retained stale live draft")
	}
}

type timelineMessageRecord struct {
	ID      string `json:"id"`
	Role    string `json:"role"`
	Content string `json:"content"`
	Blocks  []struct {
		Content string `json:"content"`
	} `json:"blocks"`
}

func decodeTimelineMessageForTest(t *testing.T, value any) timelineMessageRecord {
	t.Helper()
	raw, err := json.Marshal(value)
	if rawMessage, ok := value.(json.RawMessage); ok {
		raw = rawMessage
		err = nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var record timelineMessageRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	if record.Content == "" && len(record.Blocks) > 0 {
		record.Content = record.Blocks[0].Content
	}
	return record
}

func timelineTestMeta(endpointID string) *session.Meta {
	return &session.Meta{EndpointID: endpointID, NamespacePublicID: "ns", ChannelID: "ch", UserPublicID: "user", UserEmail: "user@example.com", CanRead: true, CanWrite: true, CanExecute: true}
}
