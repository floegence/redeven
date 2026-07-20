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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	for i := 1; i <= 3; i++ {
		_, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
			ThreadID: flruntime.ThreadID(thread.ThreadID),
			TurnID:   flruntime.TurnID(fmt.Sprintf("turn_%d", i)),
			RunID:    flruntime.RunID(fmt.Sprintf("run_%d", i)),
			Input:    flruntime.TurnInput{Text: fmt.Sprintf("user %d", i)},
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
		wantTurnID := fmt.Sprintf("turn_%d", index/2+1)
		if record.Role != wantRoles[index] {
			t.Fatalf("message %d role = %q, want %q", index, record.Role, wantRoles[index])
		}
		if wantIDs[index] != "" && record.ID != wantIDs[index] {
			t.Fatalf("message %d id = %q, want %q", index, record.ID, wantIDs[index])
		}
		if record.TurnID != wantTurnID {
			t.Fatalf("message %d turn_id = %q, want %q", index, record.TurnID, wantTurnID)
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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	for i := 1; i <= 3; i++ {
		if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(fmt.Sprintf("turn_%d", i)), RunID: flruntime.RunID(fmt.Sprintf("run_%d", i)), Input: flruntime.TurnInput{Text: fmt.Sprintf("user %d", i)}}); err != nil {
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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: flruntime.TurnInput{Text: "hello"}}); err != nil {
		t.Fatal(err)
	}

	if _, _, _, err := svc.listThreadTimelineMessages(ctx, meta.EndpointID, thread.ThreadID, 2, 999); !errors.Is(err, ErrCanonicalTimelineResyncRequired) {
		t.Fatalf("before cursor error = %v, want canonical resync", err)
	}
	if _, _, _, err := svc.listThreadTimelineMessagesAfter(ctx, meta.EndpointID, thread.ThreadID, 2, 999, false); !errors.Is(err, ErrCanonicalTimelineResyncRequired) {
		t.Fatalf("after cursor error = %v, want canonical resync", err)
	}
}

func TestReadCanonicalThreadStateUsesLatestAdmittedTurn(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_snapshot_consistency")
	thread, err := svc.CreateThread(ctx, meta, "snapshot consistency", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: flruntime.TurnInput{Text: "hello"}}); err != nil {
		t.Fatal(err)
	}
	snapshot, latest, err := svc.readCanonicalThreadState(ctx, thread.ThreadID)
	if err != nil {
		t.Fatalf("canonical state: %v", err)
	}
	if snapshot.ID != flruntime.ThreadID(thread.ThreadID) || latest == nil || latest.TurnID != "turn_1" || latest.RunID != "run_1" {
		t.Fatalf("latest = %#v", latest)
	}

	empty, err := svc.CreateThread(ctx, meta, "empty canonical state", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	emptySnapshot, emptyLatest, err := svc.readCanonicalThreadState(ctx, empty.ThreadID)
	if err != nil || emptySnapshot.ID != flruntime.ThreadID(empty.ThreadID) || emptyLatest != nil {
		t.Fatalf("empty canonical state: snapshot=%#v latest=%#v err=%v", emptySnapshot, emptyLatest, err)
	}
}

func TestUnmatchedLiveDraftTriggersResyncAndUsesCanonicalTimeline(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_resync")
	thread, err := svc.CreateThread(ctx, meta, "resync", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_1", RunID: "run_1", Input: flruntime.TurnInput{Text: "hello"}}); err != nil {
		t.Fatal(err)
	}
	state := FlowerLiveMaterializedState{Messages: map[string]FlowerLiveMessageDraft{
		"turn_stale": {ThreadID: thread.ThreadID, TurnID: "turn_stale", RunID: "run_stale", MessageID: "turn_stale", Role: "assistant", Status: "streaming"},
	}}
	projection, err := svc.buildFlowerTimelineProjection(ctx, meta.EndpointID, thread.ThreadID, state)
	if err != nil {
		t.Fatalf("buildFlowerTimelineProjection: %v", err)
	}
	if len(projection.Messages) != 2 || projection.Messages[0].Role != "user" || projection.Messages[1].MessageID != "turn_1" {
		t.Fatalf("projection messages=%#v, want canonical timeline without stale draft", projection.Messages)
	}
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(meta.EndpointID, thread.ThreadID)]
	svc.mu.Unlock()
	if stream == nil || len(stream.Events) == 0 || stream.Events[len(stream.Events)-1].Kind != FlowerLiveResyncRequired {
		t.Fatalf("missing resync event: %#v", stream)
	}
	if len(stream.State.Messages) != 0 {
		t.Fatalf("stale live drafts retained after resync: %#v", stream.State.Messages)
	}
}

func TestMismatchedLiveDraftIdentityResyncsBootstrapWithoutSendFailure(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_identity_resync")
	thread, err := svc.CreateThread(ctx, meta, "identity resync", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "canonical answer")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_identity", RunID: "run_identity", Input: flruntime.TurnInput{Text: "hello"},
	}); err != nil {
		t.Fatal(err)
	}

	for name, draft := range map[string]FlowerLiveMessageDraft{
		"wrong thread":  {ThreadID: "other", TurnID: "turn_identity", RunID: "run_identity", MessageID: "turn_identity", Role: "assistant", Status: "streaming"},
		"wrong turn":    {ThreadID: thread.ThreadID, TurnID: "other", RunID: "run_identity", MessageID: "turn_identity", Role: "assistant", Status: "streaming"},
		"wrong run":     {ThreadID: thread.ThreadID, TurnID: "turn_identity", RunID: "other", MessageID: "turn_identity", Role: "assistant", Status: "streaming"},
		"wrong message": {ThreadID: thread.ThreadID, TurnID: "turn_identity", RunID: "run_identity", MessageID: "other", Role: "assistant", Status: "streaming"},
	} {
		t.Run(name, func(t *testing.T) {
			threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
			svc.mu.Lock()
			stream := newFlowerLiveThreadStream()
			stream.State.Messages["turn_identity"] = draft
			svc.flowerLiveByThread[threadKey] = stream
			svc.mu.Unlock()

			bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
			if err != nil {
				t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
			}
			if len(bootstrap.TimelineMessages) != 2 || bootstrap.TimelineMessages[1].MessageID != "turn_identity" || bootstrap.TimelineMessages[1].Content != "canonical answer" {
				t.Fatalf("timeline=%#v, want canonical Floret replacement", bootstrap.TimelineMessages)
			}
			if len(bootstrap.LiveState.Messages) != 0 {
				t.Fatalf("bootstrap retained mismatched live drafts: %#v", bootstrap.LiveState.Messages)
			}
			if bootstrap.Cursor != 1 || bootstrap.RetainedFromSeq != 1 {
				t.Fatalf("bootstrap cursor boundary=%d/%d, want resync event boundary 1/1", bootstrap.Cursor, bootstrap.RetainedFromSeq)
			}
			svc.mu.Lock()
			events := append([]FlowerLiveEvent(nil), svc.flowerLiveByThread[threadKey].Events...)
			svc.mu.Unlock()
			if len(events) == 0 || events[len(events)-1].Kind != FlowerLiveResyncRequired {
				t.Fatalf("events=%#v, want trailing resync event", events)
			}
		})
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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "canonical terminal")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_terminal", RunID: "run_terminal", Input: flruntime.TurnInput{Text: "hello"},
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

func TestTerminalCanonicalReplacementRecoversMismatchedLiveDraft(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_timeline_terminal_identity_resync")
	thread, err := svc.CreateThread(ctx, meta, "terminal identity resync", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "canonical terminal")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_terminal_identity", RunID: "run_terminal_identity", Input: flruntime.TurnInput{Text: "hello"},
	}); err != nil {
		t.Fatal(err)
	}

	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	svc.mu.Lock()
	stream := newFlowerLiveThreadStream()
	stream.State.Messages["turn_terminal_identity"] = FlowerLiveMessageDraft{
		ThreadID: thread.ThreadID, TurnID: "turn_terminal_identity", RunID: "other_run", MessageID: "turn_terminal_identity", Role: "assistant", Status: "streaming",
	}
	svc.flowerLiveByThread[threadKey] = stream
	svc.mu.Unlock()

	settlementTarget := flruntime.PendingToolSettlementTarget{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_terminal_identity", RunID: "run_terminal_identity", ToolCallID: "exec-1", ToolName: "terminal.exec", Handle: "process-1",
	}
	settledProjection := flruntime.ThreadTurnProjection{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_terminal_identity", RunID: "run_terminal_identity", TraceID: "run_terminal_identity", Status: flruntime.TurnStatusCompleted, ThroughOrdinal: 2,
		Segments: []flruntime.ThreadTurnProjectionSegment{{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run_terminal_identity", thread.ThreadID, "turn_terminal_identity", "exec-1", "terminal.exec")}},
	}
	if err := svc.applyFloretPendingToolSettlementProjection(ctx, meta.EndpointID, thread.ThreadID, "run_terminal_identity", "turn_terminal_identity", pendingToolSettlementResultForTest(settlementTarget, flruntime.TurnProjectionAvailabilityReady, &settledProjection, "")); err != nil {
		t.Fatalf("applyFloretPendingToolSettlementProjection: %v", err)
	}

	response, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	var sawResync, sawReplacement bool
	for _, event := range response.Events {
		switch event.Kind {
		case FlowerLiveResyncRequired:
			sawResync = true
		case FlowerLiveTimelineReplaced:
			sawReplacement = true
			var payload FlowerLiveTimelineReplacedPayload
			if !decodeFlowerPayload(event.Payload, &payload) {
				t.Fatalf("replacement payload decode failed: %#v", event)
			}
			if len(payload.Messages) != 2 || payload.Messages[1].MessageID != "turn_terminal_identity" || payload.Messages[1].Content != "canonical terminal" {
				t.Fatalf("replacement messages=%#v, want canonical timeline", payload.Messages)
			}
			if len(payload.LiveState.Messages) != 0 {
				t.Fatalf("replacement retained mismatched live drafts: %#v", payload.LiveState.Messages)
			}
		}
	}
	if !sawResync || !sawReplacement {
		t.Fatalf("events=%#v, want resync followed by canonical replacement", response.Events)
	}
}

type timelineMessageRecord struct {
	ID      string `json:"id"`
	TurnID  string `json:"turn_id"`
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
