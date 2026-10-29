package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/floret/v7/tools"
)

type flowerHistoryNoFullView struct {
	flruntime.ThreadService
	flruntime.ThreadFactsSource
	flruntime.ThreadWindowSource
	flruntime.ThreadSummaryReader
	flruntime.ThreadBodyReader
	flruntime.ThreadBodyManifestReader
	flruntime.ThreadLiveBodyReader
	flruntime.ThreadItemRangeReader
	allowFullView *atomic.Bool
}

type flowerHistoryChunkRuntime struct {
	flruntime.ThreadService
	flruntime.ThreadFactsSource
	flruntime.ThreadSummaryReader
	body  flruntime.ThreadItemBody
	reads []flruntime.ThreadItemTextInput
}

func (r *flowerHistoryChunkRuntime) ItemBody(ctx context.Context, scope threadquery.Scope, input flruntime.ThreadItemBodyInput) (flruntime.ThreadItemBody, error) {
	if err := ctx.Err(); err != nil {
		return flruntime.ThreadItemBody{}, err
	}
	if len(scope.ThreadIDs) != 1 || scope.ThreadIDs[0] != input.ThreadID || input.ItemID != "output" {
		return flruntime.ThreadItemBody{}, threadquery.ErrRecordUnavailable
	}
	return r.body, nil
}
func (r *flowerHistoryChunkRuntime) ReadItemText(ctx context.Context, scope threadquery.Scope, input flruntime.ThreadItemTextInput) (flruntime.ThreadItemTextChunk, error) {
	var empty flruntime.ThreadItemTextChunk
	body, err := r.ItemBody(ctx, scope, flruntime.ThreadItemBodyInput{ThreadID: input.ThreadID, ItemID: input.ItemID})
	if err != nil {
		return empty, err
	}
	if input.RunID != body.RunID || input.SourceID != body.SourceID || input.EntryID != body.EntryID || input.Field != body.Field || input.ThroughBytes > body.Bytes {
		return empty, threadquery.ErrRecordUnavailable
	}
	r.reads = append(r.reads, input)
	return flruntime.ThreadItemTextChunk{ThreadID: input.ThreadID, ItemID: input.ItemID, RunID: input.RunID, SourceID: input.SourceID, EntryID: input.EntryID, Field: input.Field, Bytes: body.Bytes, ThroughBytes: input.ThroughBytes, OffsetBytes: input.OffsetBytes, Text: "🌸"}, nil
}

func (r *flowerHistoryChunkRuntime) View(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
	panic("chunk read must not load history")
}

func TestFlowerHistoryBodyBoundedAuthorizedResume(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	runtime := &flowerHistoryChunkRuntime{ThreadService: svc.threadRuntime, ThreadFactsSource: svc.threadRuntime.(flruntime.ThreadFactsSource), ThreadSummaryReader: svc.threadRuntime.(flruntime.ThreadSummaryReader), body: flruntime.ThreadItemBody{RunID: "run", SourceID: "output", Field: flruntime.ThreadBodyContent, Bytes: 100000}}
	svc.threadRuntime = runtime
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Body resume", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	input := FlowerHistoryBodyRequest{Field: flruntime.ThreadBodyContent, ItemID: "output", RunID: "run", SourceID: "output", OffsetBytes: 65536, ThroughBytes: 90000}
	chunk, err := svc.GetFlowerHistoryBody(t.Context(), meta, thread.ThreadID, input)
	if err != nil || chunk.OffsetBytes != input.OffsetBytes || chunk.ThroughBytes != input.ThroughBytes || chunk.Text != "🌸" {
		t.Fatalf("chunk=%+v err=%v", chunk, err)
	}
	if len(runtime.reads) != 1 || runtime.reads[0].LimitBytes != 16<<10 {
		t.Fatal("unbounded read")
	}
	for _, invalid := range []FlowerHistoryBodyRequest{
		{ItemID: "output", RunID: "old", SourceID: "output", ThroughBytes: 90000},
		{ItemID: "output", RunID: "run", SourceID: "another", ThroughBytes: 90000},
		{ItemID: "output", RunID: "run", SourceID: "output", ThroughBytes: 100001},
		{ItemID: "output", RunID: "run", SourceID: "output", OffsetBytes: -1, ThroughBytes: 90000},
	} {
		if _, err := svc.GetFlowerHistoryBody(t.Context(), meta, thread.ThreadID, invalid); err == nil {
			t.Fatal("invalid locator accepted")
		}
	}
	other := *meta
	other.NamespacePublicID = "unauthorized"
	if _, err := svc.GetFlowerHistoryBody(t.Context(), &other, thread.ThreadID, input); err == nil {
		t.Fatal("unauthorized read accepted")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := svc.GetFlowerHistoryBody(canceled, meta, thread.ThreadID, input); err == nil {
		t.Fatal("canceled read accepted")
	}
	runtime.body.RunID = ""
	if chunk, err := svc.GetFlowerHistoryBody(t.Context(), meta, thread.ThreadID, input); err != nil || !chunk.SourceChanged || chunk.Text != "" {
		t.Fatalf("sealed source must report an explicit handoff without bytes: %+v %v", chunk, err)
	}
	for _, invalid := range []FlowerHistoryBodyRequest{
		{ItemID: "output", RunID: "run", SourceID: "different", Field: flruntime.ThreadBodyContent},
		{ItemID: "output", RunID: "run", SourceID: "output", Field: flruntime.ThreadBodyReasoning},
		{ItemID: "output", SourceID: "output", Field: flruntime.ThreadBodyContent, ThroughBytes: 100001},
	} {
		if _, err := svc.GetFlowerHistoryBody(t.Context(), meta, thread.ThreadID, invalid); err == nil {
			t.Fatal("invalid canonical locator concealed as a source handoff")
		}
	}
	if _, err := svc.GetFlowerHistoryBody(t.Context(), &other, thread.ThreadID, input); err == nil {
		t.Fatal("source handoff bypassed authorization")
	}
	if len(runtime.reads) != 1 {
		t.Fatal("invalid requests read body bytes")
	}
}

func (r flowerHistoryNoFullView) View(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
	if r.allowFullView != nil && r.allowFullView.Load() {
		return r.ThreadService.View(ctx, threadID)
	}
	panic("history must not call full View")
}

func TestFlowerHistoryBoundedPagesAndExactBodies(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	runtime := svc.threadRuntime
	var allowFullView atomic.Bool
	allowFullView.Store(true)
	// Install the guard before activation starts workers. Only fixture setup
	// may read the complete view; history reads keep the same runtime owner.
	svc.threadRuntime = flowerHistoryNoFullView{
		ThreadService: runtime, ThreadFactsSource: runtime.(flruntime.ThreadFactsSource),
		ThreadWindowSource: runtime.(flruntime.ThreadWindowSource), ThreadSummaryReader: runtime.(flruntime.ThreadSummaryReader),
		ThreadBodyReader: runtime.(flruntime.ThreadBodyReader), ThreadBodyManifestReader: runtime.(flruntime.ThreadBodyManifestReader),
		ThreadLiveBodyReader: runtime.(flruntime.ThreadLiveBodyReader), allowFullView: &allowFullView,
		ThreadItemRangeReader: runtime.(flruntime.ThreadItemRangeReader),
	}
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Bounded history", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	// Several legal code rows exceed the single-item hydration budget while
	// retaining their exact source bytes through canonical normalization.
	output := strings.Repeat("Unicode 中文🌸 tool output.\n", 1800)
	answer := strings.Repeat("Final answer 中文🌸.\n", 4000)
	thought := strings.Repeat("Reasoning segment 中文🌸.\n", 1000)
	tool := tools.Define[struct{}](tools.Definition{Name: "inspect_history", ReadOnly: true, InputSchema: tools.StrictObject(map[string]any{}, nil), Permission: tools.PermissionSpec{Mode: tools.PermissionAllow}}, nil, nil,
		func(context.Context, tools.Invocation[struct{}]) (tools.Result, error) {
			return tools.Result{Text: "Inspection completed.", Activity: &tools.ActivityPresentation{Label: "Inspect history", Renderer: tools.ActivityRendererStructured, Payload: tools.StructuredActivityPayload{Rows: []tools.StructuredActivityRow{
				{Content: output, Format: tools.StructuredActivityRowFormatCode},
				{Content: output, Format: tools.StructuredActivityRowFormatCode},
				{Content: output, Format: tools.StructuredActivityRowFormatCode},
			}}}}, nil
		})
	count := 0
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 3)
		count++
		if count == 1 {
			calls := make([]flprovider.ToolCall, 180)
			for i := range calls {
				calls[i] = flprovider.ToolCall{ID: fmt.Sprintf("history-%03d", i), Name: "inspect_history", Args: "{}"}
			}
			events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: calls}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
		} else {
			events <- flprovider.Event{Type: flprovider.EventReasoning, Text: thought}
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: answer}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		}
		close(events)
		return events, nil
	})
	// This fixture persists 180 large tool results under race instrumentation.
	// Its setup deadline is separate from the measured page/body budgets.
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "history", Name: "History"}, SystemPrompt: "Inspect then answer.", Context: flconfig.ContextPolicy{ContextWindowTokens: 10000000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentLoopLimits(flruntime.LoopLimits{DuplicateToolLimit: 1000, NoProgressLimit: 1000, WallTime: 5 * time.Minute}))
	if err != nil {
		t.Fatal(err)
	}
	const key = "history-fixture"
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), key, floretEffectRequest{agent: agent, meta: *meta, req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	if _, err = svc.threadRuntime.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: key, Input: flruntime.UserInput{Text: "Inspect history"}}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Minute)
	for {
		summary, e := svc.threadRuntime.(flruntime.ThreadSummaryReader).Summary(t.Context(), identity.ThreadID(thread.ThreadID))
		if e != nil {
			t.Fatal(e)
		}
		if summary.Activity == flruntime.ThreadActivityIdle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("fixture did not settle: %+v", summary)
		}
		time.Sleep(10 * time.Millisecond)
	}
	full, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	fullBytes, err := json.Marshal(full)
	if err != nil {
		t.Fatal(err)
	}
	canonicalItems := make(map[string]json.RawMessage)
	for _, item := range full.Current.Items {
		value, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		canonicalItems[item.ID] = value
	}
	allowFullView.Store(false)
	// The product adapter consumes the published canonical range API, including
	// source identity, retained islands and the exact final-answer boundary.
	var toolsInOrder []string
	for _, item := range full.Current.Items {
		if item.Kind == flruntime.ThreadItemTool {
			toolsInOrder = append(toolsInOrder, item.ID)
		}
	}
	for _, mode := range []string{"turn", "tools"} {
		page, e := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRequest{
			SkipFolded: mode, AnchorID: toolsInOrder[100], Direction: flruntime.ThreadWindowBefore, Limit: 40,
			RetainItemIDs: []string{toolsInOrder[100], full.Current.Items[len(full.Current.Items)-1].ID},
		})
		if e != nil {
			t.Fatal(e)
		}
		if page.Window.SkippedRange == nil || page.Window.SkippedRange.LeafID != page.Window.LeafID || page.Window.HasBefore {
			t.Fatalf("folded %s range did not reach the original request: %+v", mode, page.Window)
		}
		if len(page.Window.SequenceGaps) == 0 {
			t.Fatal("folded canonical tools lost continuity evidence")
		}
		ids := map[string]bool{}
		for _, item := range page.Current.Items {
			ids[item.ID] = true
		}
		for _, id := range []string{full.Current.Items[0].ID, toolsInOrder[0], toolsInOrder[100], page.Window.SkippedRange.LastItemID, full.Current.Items[len(full.Current.Items)-1].ID} {
			if !ids[id] {
				t.Fatalf("folded %s lost protected endpoint %s", mode, id)
			}
		}
		encoded, e := json.Marshal(page)
		if e != nil || len(page.Current.Items) > 150 || len(encoded) > 600<<10 {
			t.Fatal("unbounded folded history", len(encoded), e)
		}
	}
	sparse, e := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRequest{ItemIDs: []string{toolsInOrder[0], toolsInOrder[1], toolsInOrder[50], toolsInOrder[51], toolsInOrder[100], toolsInOrder[101]}})
	if e != nil || len(sparse.Window.SequenceGaps) != 2 {
		t.Fatalf("sparse canonical tools lost continuity: %+v %v", sparse, e)
	}
	if _, e := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRequest{SkipFolded: "unknown"}); !errors.Is(e, threadquery.ErrInvalidQuery) {
		t.Fatalf("invalid folded mode accepted: %v", e)
	}
	materialsStart := time.Now()
	materialsPages := 0
	materialsCursor := ""
	for {
		page, e := svc.GetTaskMaterials(t.Context(), meta, thread.ThreadID, materialsCursor)
		if e != nil {
			t.Fatal(e)
		}
		if len(page.Items) != 0 {
			t.Fatal("text history produced materials")
		}
		materialsPages++
		if page.NextCursor == "" {
			break
		}
		if page.NextCursor == materialsCursor || materialsPages > 10 {
			t.Fatal("materials pagination did not advance")
		}
		materialsCursor = page.NextCursor
	}
	if materialsPages < 4 {
		t.Fatalf("unbounded materials history: %d pages", materialsPages)
	}
	t.Logf("materials: %d bounded windows over 180 large tool results in %s, no full View", materialsPages, time.Since(materialsStart))
	seen := map[string]bool{}
	input := FlowerHistoryRequest{}
	pages := 0
	firstBytes := 0
	var toolID, answerID, thinkingID string
	timing := make(map[string][2]time.Time)
	for {
		page, e := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, input)
		if e != nil {
			t.Fatal(e)
		}
		encoded, e := json.Marshal(page)
		if e != nil {
			t.Fatal(e)
		}
		if len(page.Current.Items) > 150 || len(encoded) > 600<<10 {
			t.Fatalf("unbounded page: items=%d bytes=%d", len(page.Current.Items), len(encoded))
		}
		if pages == 0 {
			firstBytes = len(encoded)
			if len(page.Current.Items) != 50 {
				t.Fatalf("initial history window: got %d items, want 50", len(page.Current.Items))
			}
		}
		for _, item := range page.Current.Items {
			if len(item.Text) > 1024 {
				t.Fatalf("history preview exceeded 1 KiB: item=%s bytes=%d", item.ID, len(item.Text))
			}
			if item.ActivitySummary != nil && item.Activity != nil && item.Activity.Presentation != nil {
				t.Fatalf("history summary included an unopened activity body: %s", item.ID)
			}
			if seen[item.ID] {
				t.Fatalf("duplicate pagination item %s", item.ID)
			}
			seen[item.ID] = true
			if item.Kind == flruntime.ThreadItemThinking || item.Kind == flruntime.ThreadItemAssistant {
				if item.OutputStartedAt == nil || item.OutputEndedAt == nil || !item.OutputStartedAt.Equal(*item.OutputEndedAt) {
					t.Fatalf("single-chunk timing lost in bounded history: %+v", item)
				}
				timing[item.ID] = [2]time.Time{*item.OutputStartedAt, *item.OutputEndedAt}
				if item.Kind == flruntime.ThreadItemThinking {
					thinkingID = item.ID
				}
			}
			if item.Kind == flruntime.ThreadItemTool && item.ActivitySummary != nil {
				toolID = item.ID
			}
			if item.Kind == flruntime.ThreadItemAssistant && item.Body != nil {
				answerID = item.ID
			}
		}
		pages++
		if !page.Window.HasBefore {
			break
		}
		input.AnchorID = page.Window.FirstItemID
	}
	if len(seen) != len(full.Current.Items) || pages < 2 || toolID == "" || answerID == "" || thinkingID == "" {
		t.Fatalf("history lost: got=%d full=%d pages=%d tool=%q answer=%q", len(seen), len(full.Current.Items), pages, toolID, answerID)
	}
	for _, id := range []string{toolID, answerID, thinkingID} {
		item, e := svc.GetFlowerHistoryItem(t.Context(), meta, thread.ThreadID, id)
		if e != nil {
			t.Fatal(e)
		}
		var actual, canonical any
		if err := json.Unmarshal(item, &actual); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(canonicalItems[id], &canonical); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, canonical) {
			t.Fatalf("expanded item %s differs from the complete canonical view", id)
		}
		var expanded flowerPublicItem
		if e = json.Unmarshal(item, &expanded); e != nil {
			t.Fatal(e)
		}
		if expanded.Body != nil || len(expanded.ActivityBodies) > 0 {
			t.Fatal("expanded body remained partial")
		}
		if want, ok := timing[id]; ok {
			if expanded.OutputStartedAt == nil || expanded.OutputEndedAt == nil || !expanded.OutputStartedAt.Equal(want[0]) || !expanded.OutputEndedAt.Equal(want[1]) {
				t.Fatalf("hydration changed source timing: %+v", expanded)
			}
		}
		if id == thinkingID && expanded.Text != thought {
			t.Fatal("thinking body changed")
		}
		if id == answerID && expanded.Text != answer {
			t.Fatal("answer body changed")
		}
		if id == toolID && (!strings.Contains(string(item), "Unicode") || !strings.Contains(string(item), "中文")) {
			t.Fatal("tool body missing")
		}
	}
	if firstBytes*5 >= len(fullBytes) {
		t.Fatalf("insufficient reduction: full=%d first=%d", len(fullBytes), firstBytes)
	}
	t.Logf("canonical full=%d bytes; first page=%d bytes; reduction=%.1f%%; pages=%d items=%d", len(fullBytes), firstBytes, 100*(1-float64(firstBytes)/float64(len(fullBytes))), pages, len(seen))
	other := *meta
	other.NamespacePublicID = "unauthorized"
	if _, e := svc.GetFlowerThreadHistory(t.Context(), &other, thread.ThreadID, FlowerHistoryRequest{}); e == nil {
		t.Fatal("unauthorized page accepted")
	}
	if _, e := svc.GetFlowerHistoryItem(t.Context(), &other, thread.ThreadID, answerID); e == nil {
		t.Fatal("unauthorized body accepted")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, e := readFlowerHistory(canceled, svc.threadRuntime, threadquery.Scope{Authority: "test", ThreadIDs: []identity.ThreadID{identity.ThreadID(thread.ThreadID)}}, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(thread.ThreadID)}); e == nil {
		t.Fatal("canceled read accepted")
	}
}

func TestFlowerHistoryObserverOwnershipAndSupersession(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Reading interest", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	if ready := nextFlowerLiveStreamFrame(t, sub); ready.Kind != FlowerLiveStreamReady {
		t.Fatal("missing ready")
	}
	request := FlowerHistoryRequest{ObserverID: sub.subscriber.observerID, ReadingRevision: 1}
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err != nil {
		t.Fatal(err)
	}
	first := sub.subscriber.history.subscription
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err == nil {
		t.Fatal("accepted obsolete revision")
	}
	invalid := request
	invalid.ReadingRevision = 2
	invalid.AnchorID = "missing"
	invalid.Direction = flruntime.ThreadWindowAround
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, invalid); err == nil {
		t.Fatal("accepted unavailable anchor")
	}
	if sub.subscriber.history.subscription != first || sub.subscriber.history.revision != 1 {
		t.Fatal("failed read replaced accepted interest")
	}
	foreign := *meta
	foreign.UserPublicID = "another-viewer"
	request.ReadingRevision = 2
	if _, err = svc.GetFlowerThreadHistory(t.Context(), &foreign, thread.ThreadID, request); err == nil {
		t.Fatal("observer crossed viewer authority")
	}
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err != nil {
		t.Fatal(err)
	}
	if sub.subscriber.history.subscription != first || sub.subscriber.history.revision != 2 {
		t.Fatal("replacement did not reuse the ordered observation owner")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	request.ReadingRevision = 3
	if _, err = svc.GetFlowerThreadHistory(canceled, meta, thread.ThreadID, request); err == nil {
		t.Fatal("canceled read accepted")
	}
	sub.Close()
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err == nil {
		t.Fatal("closed observer accepted")
	}
}

func TestFlowerHistoryCommittedBaselineSurvivesCanceledWaiter(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Canceled response", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	stream, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	nextFlowerLiveStreamFrame(t, stream)
	if _, err = svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRequest{ObserverID: stream.subscriber.observerID, ReadingRevision: 1}); err != nil {
		t.Fatal(err)
	}
	nextBaseline := func(want uint64) {
		t.Helper()
		for {
			frame := nextFlowerLiveStreamFrame(t, stream)
			var envelope FlowerLiveStreamEnvelope
			if err := json.Unmarshal(frame.Data, &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Kind != FlowerLiveStreamThreadBatch || envelope.ReadingRevision == 0 {
				continue
			}
			if envelope.ReadingRevision != want || envelope.Current == nil || envelope.HistoryInvalidated != nil {
				t.Fatalf("committed baseline %d lost: %s", want, frame.Data)
			}
			return
		}
	}
	nextBaseline(1)
	scope, err := svc.flowerHistoryScope(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	svc.mu.Lock()
	interest := &stream.subscriber.history
	subscription := interest.subscription
	// The HTTP caller has left, but Floret has committed its selection. A
	// newer waiter may already exist before Next consumes that older baseline.
	interest.requested = 3
	pending := &flowerHistoryPending{revision: 3, result: make(chan flowerHistoryReadResult, 1)}
	interest.pending = pending
	svc.mu.Unlock()
	for _, requestID := range []string{"2", "3"} {
		if err := subscription.SetWindow(t.Context(), scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestID: requestID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, revision := range []uint64{2, 3} {
		nextBaseline(revision)
	}
	select {
	case result := <-pending.result:
		if result.err != nil || result.window == nil {
			t.Fatalf("replacement result: %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("new waiter was not completed")
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if interest.subscription != subscription || interest.revision != 3 {
		t.Fatal("baseline replaced observation owner")
	}
}

func TestFlowerHistoryBackgroundFactsExcludeBodies(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	nextFlowerLiveStreamFrame(t, sub)
	update := flruntime.ThreadUpdate{ThreadID: "background", TurnID: "turn", RunID: "run", BaseVersion: 1, ViewVersion: 2,
		Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityIdle}, Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAdded, ItemID: "secret", Item: &flruntime.ThreadItem{ID: "secret", TurnID: "turn", RunID: "run", Kind: flruntime.ThreadItemAssistant, Text: strings.Repeat("hidden body", 100000)}}}}
	svc.broadcastFlowerRuntimeUpdate(meta.EndpointID, "", update)
	frame := nextFlowerLiveStreamFrame(t, sub)
	if len(frame.Data) > 4096 || strings.Contains(string(frame.Data), "hidden body") {
		t.Fatalf("background history leaked: %d bytes", len(frame.Data))
	}
	var envelope FlowerLiveStreamEnvelope
	if err = json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.FactsOnly || envelope.Update == nil || len(envelope.Update.Items) != 0 {
		t.Fatal("background update was not facts-only")
	}
}

func TestFlowerHistoryPressureRecoveryNeverReadsFullView(t *testing.T) {
	svc := &Service{threadRuntime: flowerHistoryNoFullView{}}
	subscriber := &flowerLiveSubscriber{history: flowerHistoryInterest{revision: 1}}
	stream := &FlowerLiveStreamSubscription{service: svc, subscriber: subscriber}
	if err := stream.resolveFlowerLiveRefresh(t.Context(), &flowerLiveEncodedBatch{readingRevision: 1, route: flowerLiveRoute{threadID: "thread", wireID: "thread"}}); err != nil {
		t.Fatal(err)
	}
	if subscriber.closed || len(subscriber.queue) != 1 {
		t.Fatal("window failure invalidated workspace")
	}
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(subscriber.queue[0].data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.HistoryInvalidated == nil || envelope.ReadingRevision != 1 {
		t.Fatal("missing bounded recovery notice")
	}
}

func TestFlowerHistoryMergedAppendsRetainReadingRevision(t *testing.T) {
	makeBatch := func(base uint64, offset int, text string, revision uint64) *flowerLiveEncodedBatch {
		update := flruntime.ThreadUpdate{ThreadID: "thread", TurnID: "turn", RunID: "run", BaseVersion: base, ViewVersion: base + 1,
			Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive},
			Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "text", Append: &flruntime.ThreadTextAppend{OffsetBytes: offset, Text: text}}}}
		return newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread", Update: &update, ReadingRevision: revision})
	}
	first, second := makeBatch(1, 0, "one", 4), makeBatch(2, 3, "two", 4)
	merged := mergeFlowerLiveGrowthBatches(first, second)
	if merged == nil || merged.readingRevision != 4 {
		t.Fatal("compatible window appends did not merge")
	}
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(merged.data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ReadingRevision != 4 || envelope.Update.Items[0].Append.Text != "onetwo" {
		t.Fatal("merged wire append lost its reading revision or text")
	}
	if mergeFlowerLiveGrowthBatches(first, makeBatch(2, 3, "two", 5)) != nil {
		t.Fatal("appends crossed reading interests")
	}
}

func TestFlowerHistoryCoalescesBodyGrowth(t *testing.T) {
	makeBatch := func(base uint64, size int, run identity.RunID) *flowerLiveEncodedBatch {
		update := flruntime.ThreadUpdate{ThreadID: "thread", TurnID: "turn", RunID: run, BaseVersion: base, ViewVersion: base + 1,
			Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive},
			Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemBodyUpdated, ItemID: "output", Body: &flruntime.ThreadItemBody{RunID: run, SourceID: "output", Field: flruntime.ThreadBodyContent, Bytes: size, PreviewBytes: 100}}}}
		return newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread", Update: &update, ReadingRevision: 3})
	}
	merged := makeBatch(1, 70000, "run")
	for i := 2; i <= 2000; i++ {
		merged = mergeFlowerLiveGrowthBatches(merged, makeBatch(uint64(i), 70000+i, "run"))
		if merged == nil {
			t.Fatal("body growth did not coalesce")
		}
	}
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(merged.data, &envelope); err != nil {
		t.Fatal(err)
	}
	if len(merged.data) > 4096 || envelope.Update.BaseVersion != 1 || envelope.Update.ViewVersion != 2001 || envelope.Update.Items[0].Body.Bytes != 72000 || envelope.ReadingRevision != 3 {
		t.Fatalf("invalid merged extent: %s", merged.data)
	}
	if mergeFlowerLiveGrowthBatches(merged, makeBatch(2001, 72001, "other-run")) != nil {
		t.Fatal("merged across runs")
	}
	if mergeFlowerLiveGrowthBatches(merged, makeBatch(2001, 71000, "run")) != nil {
		t.Fatal("accepted shrinking extent")
	}
}

func TestFlowerHistoryInterestWaitHonorsCancellation(t *testing.T) {
	interest := &flowerHistoryInterest{}
	release, err := interest.lock(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err = interest.lock(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("blocked reader cancellation: %v", err)
	}
}

func TestFlowerHistoryReleaseFencesPendingAndPreservesOtherInterest(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "release", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	stream, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	input := FlowerHistoryRequest{ObserverID: stream.subscriber.observerID, ReadingRevision: 1}
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, input); err != nil {
		t.Fatal(err)
	}
	old := stream.subscriber.history.subscription
	childCtx, childCancel := context.WithCancel(t.Context())
	defer childCancel()
	svc.mu.Lock()
	stream.subscriber.subagentHistory.cancel = childCancel
	svc.mu.Unlock()
	if err := svc.ReleaseFlowerHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRelease{ObserverID: input.ObserverID, ReadingRevision: 2}); err != nil {
		t.Fatal(err)
	}
	if stream.subscriber.closed || stream.subscriber.history.subscription != nil || childCtx.Err() != nil {
		t.Fatal("release affected workspace or other interest")
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	for {
		if _, err := old.Next(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("released observer remains active")
			}
			break
		}
	}
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, input); err == nil {
		t.Fatal("released revision reinstalled")
	}
	input.ReadingRevision = 3
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, input); err != nil {
		t.Fatal(err)
	}
	if err := svc.ReleaseFlowerHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRelease{ObserverID: input.ObserverID, ReadingRevision: 2}); err != nil {
		t.Fatal(err)
	}
	if stream.subscriber.history.subscription == nil {
		t.Fatal("stale release canceled newer reading")
	}
}

func TestFlowerHistoryChildInterestIsBoundedAndIndependent(t *testing.T) {
	f := newParentEventForkFixture(t)
	meta := testSendTurnMeta()
	if err := f.service.ensureChildThreadSettings(t.Context(), &run{sessionMeta: meta, endpointID: meta.EndpointID, threadID: f.source, permissionType: FlowerPermissionReadonly}, f.child.String(), f.source); err != nil {
		t.Fatal(err)
	}
	stream, err := f.service.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	rootRequest := FlowerHistoryRequest{ObserverID: stream.subscriber.observerID, ReadingRevision: 1, Limit: 1}
	if _, err := f.service.GetFlowerThreadHistory(t.Context(), meta, f.source, rootRequest); err != nil {
		t.Fatal(err)
	}
	root := stream.subscriber.history.subscription
	child, err := f.service.GetFlowerSubagentHistory(t.Context(), meta, f.source, f.child.String(), rootRequest)
	if err != nil {
		t.Fatal(err)
	}
	if child.Window == nil || len(child.Current.Items) > 1 || child.Summary.ParentThreadID != f.source {
		t.Fatal("child did not use bounded canonical membership")
	}
	if stream.subscriber.history.subscription != root || stream.subscriber.subagentHistory.subscription == nil {
		t.Fatal("child replaced root interest")
	}
	if err := f.service.ReleaseFlowerHistory(t.Context(), meta, f.child.String(), FlowerHistoryRelease{ObserverID: rootRequest.ObserverID, ReadingRevision: 2, Subagent: true}); err != nil {
		t.Fatal(err)
	}
	if stream.subscriber.history.subscription != root || stream.subscriber.subagentHistory.subscription != nil || stream.subscriber.closed {
		t.Fatal("closing child affected root")
	}
}

func TestFlowerHistoryRequestedRevisionCannotMoveBackwards(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "monotonic", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	stream, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	request := FlowerHistoryRequest{ObserverID: stream.subscriber.observerID, ReadingRevision: 1}
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err != nil {
		t.Fatal(err)
	}
	svc.mu.Lock()
	sub := stream.subscriber.history.subscription
	stream.subscriber.history.requested = 3 // A newer waiter cancelled before its baseline arrived.
	svc.mu.Unlock()
	request.ReadingRevision = 2
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err == nil {
		t.Fatal("older request replaced newer intent")
	}
	if err := svc.ReleaseFlowerHistory(t.Context(), meta, thread.ThreadID, FlowerHistoryRelease{ObserverID: request.ObserverID, ReadingRevision: 2}); err != nil {
		t.Fatal(err)
	}
	svc.mu.Lock()
	retained := stream.subscriber.history.subscription == sub && stream.subscriber.history.requested == 3
	svc.mu.Unlock()
	if !retained {
		t.Fatal("older release discarded newer intent")
	}
	request.ReadingRevision = 4
	if _, err := svc.GetFlowerThreadHistory(t.Context(), meta, thread.ThreadID, request); err != nil {
		t.Fatal(err)
	}
}
