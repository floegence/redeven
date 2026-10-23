package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	flruntime.ThreadUpdateSource
	flruntime.ThreadWindowSource
	flruntime.ThreadSummaryReader
	flruntime.ThreadBodyReader
	flruntime.ThreadBodyManifestReader
	flruntime.ThreadLiveBodyReader
	allowFullView *atomic.Bool
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
		ThreadService: runtime, ThreadUpdateSource: runtime.(flruntime.ThreadUpdateSource),
		ThreadWindowSource: runtime.(flruntime.ThreadWindowSource), ThreadSummaryReader: runtime.(flruntime.ThreadSummaryReader),
		ThreadBodyReader: runtime.(flruntime.ThreadBodyReader), ThreadBodyManifestReader: runtime.(flruntime.ThreadBodyManifestReader),
		ThreadLiveBodyReader: runtime.(flruntime.ThreadLiveBodyReader), allowFullView: &allowFullView,
	}
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Bounded history", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	output := strings.Repeat("Unicode 中文🌸 tool output.\n", 300)
	answer := strings.Repeat("Final answer 中文🌸.\n", 4000)
	tool := tools.Define[struct{}](tools.Definition{Name: "inspect_history", ReadOnly: true, InputSchema: tools.StrictObject(map[string]any{}, nil), Permission: tools.PermissionSpec{Mode: tools.PermissionAllow}}, nil, nil,
		func(context.Context, tools.Invocation[struct{}]) (tools.Result, error) {
			return tools.Result{Text: "Inspection completed.", Activity: &tools.ActivityPresentation{Label: "Inspect history", Renderer: tools.ActivityRendererTerminal, Payload: tools.TerminalActivityPayload{Operation: "exec", Command: "inspect", Output: output, Status: "success"}}}, nil
		})
	count := 0
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 2)
		count++
		if count == 1 {
			calls := make([]flprovider.ToolCall, 180)
			for i := range calls {
				calls[i] = flprovider.ToolCall{ID: fmt.Sprintf("history-%03d", i), Name: "inspect_history", Args: "{}"}
			}
			events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: calls}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
		} else {
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: answer}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		}
		close(events)
		return events, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "history", Name: "History"}, SystemPrompt: "Inspect then answer.", Context: flconfig.ContextPolicy{ContextWindowTokens: 10000000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentLoopLimits(flruntime.LoopLimits{DuplicateToolLimit: 1000, NoProgressLimit: 1000, WallTime: time.Minute}))
	if err != nil {
		t.Fatal(err)
	}
	const key = "history-fixture"
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), key, floretEffectRequest{agent: agent, meta: *meta, req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	if _, err = svc.threadRuntime.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: key, Input: flruntime.UserInput{Text: "Inspect history"}}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Minute)
	for {
		summary, e := svc.threadRuntime.(flruntime.ThreadSummaryReader).Summary(t.Context(), identity.ThreadID(thread.ThreadID))
		if e != nil {
			t.Fatal(e)
		}
		if summary.Activity == flruntime.ThreadActivityIdle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fixture did not settle")
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
	allowFullView.Store(false)
	seen := map[string]bool{}
	input := FlowerHistoryRequest{}
	pages := 0
	firstBytes := 0
	var toolID, answerID string
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
		}
		for _, item := range page.Current.Items {
			if seen[item.ID] {
				t.Fatalf("duplicate pagination item %s", item.ID)
			}
			seen[item.ID] = true
			if item.Kind == flruntime.ThreadItemTool && len(item.ActivityBodies) > 0 {
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
	if len(seen) != len(full.Current.Items) || pages < 2 || toolID == "" || answerID == "" {
		t.Fatalf("history lost: got=%d full=%d pages=%d tool=%q answer=%q", len(seen), len(full.Current.Items), pages, toolID, answerID)
	}
	for _, id := range []string{toolID, answerID} {
		item, e := svc.GetFlowerHistoryItem(t.Context(), meta, thread.ThreadID, id)
		if e != nil {
			t.Fatal(e)
		}
		var expanded flowerPublicItem
		if e = json.Unmarshal(item, &expanded); e != nil {
			t.Fatal(e)
		}
		if expanded.Body != nil || len(expanded.ActivityBodies) > 0 {
			t.Fatal("expanded body remained partial")
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
	first := sub.subscriber.history
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
	if sub.subscriber.history != first || sub.subscriber.historyRevision != 1 {
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
	if sub.subscriber.history == first || sub.subscriber.historyRevision != 2 {
		t.Fatal("new interest not installed")
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
	stream := &FlowerLiveStreamSubscription{service: svc}
	if err := stream.resolveFlowerLiveRefresh(t.Context(), &flowerLiveEncodedBatch{readingRevision: 1}); !errors.Is(err, ErrFlowerLiveSync) {
		t.Fatalf("bounded pressure must re-establish the reading interest: %v", err)
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
	merged := mergeFlowerLiveAppendBatches(first, second)
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
	if mergeFlowerLiveAppendBatches(first, makeBatch(2, 3, "two", 5)) != nil {
		t.Fatal("appends crossed reading interests")
	}
}
