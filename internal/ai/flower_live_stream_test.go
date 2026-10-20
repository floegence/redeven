package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

func TestFlowerLiveEncodingFailureRetainsCauseAndLogsSafeCurrentContext(t *testing.T) {
	for _, child := range []bool{false, true} {
		t.Run(fmt.Sprintf("subagent_%t", child), func(t *testing.T) {
			svc := newFlowerLiveMemoryTestService()
			var logs bytes.Buffer
			svc.log = slog.New(slog.NewJSONHandler(&logs, nil))
			subscriber := &flowerLiveSubscriber{
				id: 1, endpointID: "env-encoding-diagnostic", queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit),
			}
			svc.flowerLiveSubscribers[subscriber.id] = subscriber
			svc.flowerLiveSubscribersByEndpoint[subscriber.endpointID] = 1
			current := flruntime.ThreadView{
				ThreadID: "thread-encoding-diagnostic", TurnID: "turn-encoding-diagnostic", RunID: "run-encoding-diagnostic", ViewVersion: 4457,
				Turns:   []flruntime.ThreadTurn{{TurnID: "turn-encoding-diagnostic", RunID: "private-invalid-run\nvalue"}},
				Failure: &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEngineContract, Message: "private-provider-diagnostic"},
			}
			envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "parent-encoding-diagnostic"}
			if child {
				current.RunID = "private-invalid-active-run\nvalue"
				envelope.SubagentCurrent = &current
			} else {
				envelope.Current = &current
			}
			batch := newFlowerLiveEncodedBatch(envelope)
			var marshalErr *json.MarshalerError
			if !errors.Is(batch.err, ErrFlowerLiveSync) || !errors.Is(batch.err, identity.ErrInvalid) || !errors.As(batch.err, &marshalErr) {
				t.Fatalf("encoding cause was lost: %v", batch.err)
			}
			if enqueueFlowerLiveSubscriberLocked(svc, subscriber, batch) {
				t.Fatal("invalid current envelope was admitted")
			}
			public := &FlowerLiveStreamSubscription{service: svc, subscriber: subscriber}
			if frame, err := public.Next(t.Context()); frame != nil || err != ErrFlowerLiveSync || errors.Is(err, identity.ErrInvalid) {
				t.Fatalf("public error contract changed: frame=%#v error=%v", frame, err)
			}
			var diagnostic map[string]any
			if err := json.Unmarshal(logs.Bytes(), &diagnostic); err != nil {
				t.Fatal(err)
			}
			if diagnostic["reason"] != string(flowerLiveSubscriberCloseEncoding) || diagnostic["kind"] != string(FlowerLiveStreamThreadBatch) || diagnostic["thread_id"] != envelope.ThreadID {
				t.Fatalf("encoding context missing: %#v", diagnostic)
			}
			prefix, threadField := "", "current_thread_id"
			expectedRunID := "run-encoding-diagnostic"
			if child {
				prefix, threadField, expectedRunID = "subagent_", "subagent_thread_id", "[invalid]"
			}
			if diagnostic[threadField] != current.ThreadID.String() || diagnostic[prefix+"turn_id"] != current.TurnID.String() || diagnostic[prefix+"run_id"] != expectedRunID || diagnostic[prefix+"view_version"] != float64(current.ViewVersion) {
				t.Fatalf("current identity diagnostics missing: %#v", diagnostic)
			}
			message, _ := diagnostic["error"].(string)
			if !strings.Contains(message, identity.ErrInvalid.Error()) || strings.ContainsAny(message, "\r\n") {
				t.Fatalf("encoding diagnostic error=%q", message)
			}
			if strings.Contains(logs.String(), "private-invalid") || strings.Contains(logs.String(), "private-provider-diagnostic") {
				t.Fatalf("private runtime data crossed the diagnostic boundary: %s", &logs)
			}
		})
	}
}

func TestFlowerWorkspaceStreamEncodesActivityUpdatesThroughFinalAnswer(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Activity stream regression", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	firstObserved, secondObserved := make(chan struct{}), make(chan struct{})
	releaseFirst, releaseSecond := sync.OnceFunc(func() { close(firstObserved) }), sync.OnceFunc(func() { close(secondObserved) })
	t.Cleanup(releaseFirst)
	t.Cleanup(releaseSecond)
	tool := tools.Define[struct{}](tools.Definition{
		Name: "inspect_activity", ReadOnly: true, InputSchema: tools.StrictObject(map[string]any{}, nil),
		Permission: tools.PermissionSpec{Mode: tools.PermissionAllow},
	}, nil, nil, func(ctx context.Context, invocation tools.Invocation[struct{}]) (tools.Result, error) {
		for index, observed := range []<-chan struct{}{firstObserved, secondObserved} {
			invocation.UpdateActivity(tools.ActivityUpdate{
				Activity: &tools.ActivityPresentation{Label: fmt.Sprintf("activity-update-%d", index+1), Renderer: tools.ActivityRendererTerminal,
					Payload: tools.TerminalActivityPayload{Operation: "exec", Command: "inspect", Output: fmt.Sprintf("activity-output-%d", index+1), Status: "running"}},
				Metadata: map[string]any{"run_id": invocation.RunID.String(), "turn_id": invocation.TurnID.String()},
			})
			select {
			case <-observed:
			case <-ctx.Done():
				return tools.Result{}, ctx.Err()
			}
		}
		return tools.Result{Text: "Inspection complete."}, nil
	})
	var calls atomic.Int32
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 2)
		switch calls.Add(1) {
		case 1:
			events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "call-activity", Name: "inspect_activity", Args: `{}`}}}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
		case 2:
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Final activity answer."}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		default:
			t.Error("unexpected provider request after the final answer")
		}
		close(events)
		return events, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile: flconfig.AgentProfile{ID: "activity-assistant", Name: "Activity assistant"}, SystemPrompt: "Inspect, then answer.",
		Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(
		func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
			return effect(ctx, flruntime.EffectAuthorizationProof{
				EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint,
				ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID,
				PolicyRevision: "test-policy", AuditReference: "test-audit", AuditHash: "test-audit-hash", AuthorizedAt: time.Now().UTC(),
			})
		})))
	if err != nil {
		t.Fatal(err)
	}
	const requestKey = "request-activity-stream"
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), requestKey, floretEffectRequest{agent: agent, meta: *meta,
		req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}
	admitted, err := svc.threadRuntime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), Input: flruntime.UserInput{Text: "Inspect activity."}, RequestKey: requestKey})
	if err != nil {
		t.Fatal(err)
	}
	seenFirst, seenSecond, snapshots := false, false, 0
	for {
		frame, err := readFlowerLiveStreamEnvelope(ctx, subscription)
		if err != nil {
			t.Fatalf("live stream stopped before the final answer: %v", err)
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatalf("published envelope is invalid: %v", err)
		}
		if envelope.Current == nil || envelope.ThreadID != thread.ThreadID {
			continue
		}
		current := envelope.Current
		snapshots++
		if current.TurnID != admitted.TurnID || current.RunID != admitted.RunID {
			t.Fatalf("current execution identity changed: current=%s/%s admitted=%s/%s", current.TurnID, current.RunID, admitted.TurnID, admitted.RunID)
		}
		for _, turn := range current.Turns {
			if turn.TurnID != admitted.TurnID || turn.RunID != admitted.RunID {
				t.Fatalf("historical turn identity changed after activity: %+v", turn)
			}
		}
		if strings.Contains(string(frame.Data), "activity-update-1") {
			seenFirst = true
			releaseFirst()
		}
		if strings.Contains(string(frame.Data), "activity-update-2") {
			seenSecond = true
			releaseSecond()
		}
		if current.Activity != flruntime.ThreadActivityIdle {
			continue
		}
		if current.LastOutcome == nil || *current.LastOutcome != flruntime.TurnOutcomeCompleted || !strings.Contains(string(frame.Data), "Final activity answer.") || !seenFirst || !seenSecond || snapshots < 3 {
			t.Fatalf("final current lost activity or answer: snapshots=%d activity=%t/%t frame=%s", snapshots, seenFirst, seenSecond, frame.Data)
		}
		break
	}
	detail, err := svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(detail)
	if err != nil || !strings.Contains(string(encoded), "Final activity answer.") {
		t.Fatalf("canonical final detail is not publishable: %s, %v", encoded, err)
	}
}

func TestFlowerWorkspaceStreamAcceptsEmptySelectionAndReceivesBackgroundThreadUpdates(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_workspace")
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatalf("workspace subscribe: %v", err)
	}
	defer subscription.Close()
	if got := nextFlowerLiveStreamFrame(t, subscription).Kind; got != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", got)
	}
	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID:    identity.ThreadID("background-thread"),
		ViewVersion: 1, Activity: flruntime.ThreadActivityActive,
	})
	frame := nextFlowerLiveStreamFrame(t, subscription)
	if frame.Kind != FlowerLiveStreamThreadBatch {
		t.Fatalf("workspace update kind=%q, want thread.batch", frame.Kind)
	}
}

func TestFlowerWorkspaceStreamBaselinesAndBroadcastsCanonicalComputerStatus(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_computer_status", EndpointID: "env_computer_status",
		UserPublicID: "user_computer_status", NamespacePublicID: "namespace_computer_status",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(ctx, meta, "Computer recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const turnID, runID, callID, interactionID = "turn-computer-status", "run-computer-status", "call-computer-status", "tool-input:computer-status"
	current := flruntime.ThreadView{
		ThreadID: identity.ThreadID(thread.ThreadID), TurnID: turnID, RunID: runID,
		Activity: flruntime.ThreadActivityActive, Attention: flruntime.AttentionSummary{InputCount: 1},
		Items: []flruntime.ThreadItem{{
			ID: callID, TurnID: turnID, RunID: runID, Kind: flruntime.ThreadItemTool,
			Activity: &observation.ActivityItem{ItemID: callID, ToolID: callID, ToolName: "browser.navigate", Kind: observation.ActivityKindTool,
				Status: observation.ActivityStatusSuccess, Presentation: &tools.ActivityPresentation{Chips: []tools.ActivityChip{{Kind: "computer_assistance", Value: "login"}}, TargetRefs: []tools.ActivityTargetRef{{Kind: "computer_control", Label: "Browser", ResourceRef: "browser-main"}}}},
		}},
		Interactions: []flruntime.ThreadInteraction{{
			ID: interactionID, TurnID: turnID, RunID: runID, Kind: flruntime.ThreadInteractionInput, ToolCallID: callID,
			Input: &flruntime.InputPresentation{Summary: "External step", Questions: []flruntime.InputQuestion{{ID: "computer_control", Kind: "select", Options: []string{"Return control to Flower"}}}},
		}},
	}
	canonical, err := svc.threadRuntime.List(ctx, flruntime.ThreadScope{})
	if err != nil || len(canonical) != 1 {
		t.Fatalf("initial canonical list=%#v, err=%v", canonical, err)
	}
	summary := canonical[0]
	summary.Activity, summary.TurnID, summary.RunID = flruntime.ThreadActivityActive, turnID, runID
	summary.Attention = flruntime.AttentionSummary{InputCount: 1}
	summary.PendingInput = current.Interactions[0].Input
	runtime := &authorityContinuityRuntime{ThreadService: svc.threadRuntime}
	runtime.list = func(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
		return []flruntime.ThreadSummary{summary}, nil
	}
	runtime.view = func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return current, nil }
	svc.threadRuntime = runtime
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", State: "connection_required", Ready: false}); err != nil {
		t.Fatal(err)
	}
	svc.targetResolver = registry
	if _, err := json.Marshal(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &current}); err != nil {
		t.Fatalf("fixture current encoding: %v", err)
	}

	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if got := nextFlowerLiveStreamFrame(t, subscription).Kind; got != FlowerLiveStreamReady {
		t.Fatalf("first baseline kind=%q, want ready", got)
	}
	assertFlowerViewerReadBaseline(t, subscription, thread.ThreadID)
	if got := nextFlowerLiveStreamFrame(t, subscription).Kind; got != FlowerLiveStreamThreadBatch {
		t.Fatalf("second baseline kind=%q, want thread.batch", got)
	}
	statusFrame := nextFlowerLiveStreamFrame(t, subscription)
	if statusFrame.Kind != FlowerLiveStreamComputerStatus {
		t.Fatalf("third baseline kind=%q, want computer.status", statusFrame.Kind)
	}
	var baseline FlowerLiveStreamEnvelope
	if err := json.Unmarshal(statusFrame.Data, &baseline); err != nil {
		t.Fatal(err)
	}
	if baseline.ThreadID != thread.ThreadID || baseline.ComputerStatus == nil || baseline.ComputerStatus.ThreadID != thread.ThreadID || baseline.ComputerStatus.InteractionID != interactionID || baseline.ComputerStatus.TargetID != "browser-main" || baseline.ComputerStatus.State != "unavailable" || baseline.ComputerStatus.ReasonCode != "connection_required" {
		t.Fatalf("computer status baseline=%#v", baseline)
	}

	svc.publishFlowerComputerStatus(meta.EndpointID, FlowerComputerStatus{ThreadID: thread.ThreadID, TargetID: "browser-main"})
	statusFrame = nextFlowerLiveStreamFrame(t, subscription)
	var update FlowerLiveStreamEnvelope
	if err := json.Unmarshal(statusFrame.Data, &update); err != nil {
		t.Fatal(err)
	}
	if update.Kind != FlowerLiveStreamComputerStatus || update.ThreadID != thread.ThreadID || update.ComputerStatus == nil || update.ComputerStatus.InteractionID != interactionID {
		t.Fatalf("computer status update=%#v", update)
	}
	if strings.Contains(string(statusFrame.Data), "password") || strings.Contains(string(statusFrame.Data), "secret") {
		t.Fatalf("status included private observation data: %s", statusFrame.Data)
	}
}

func TestFlowerWorkspaceStreamRoutesChildCurrentAndInventoryToParent(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_subagent_inventory")
	const parentThreadID = "parent-thread"
	const childThreadID = "child-thread"
	now := time.Now().UTC()
	var listCalls atomic.Int64
	runtime := &authorityContinuityRuntime{}
	runtime.list = func(_ context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
		listCalls.Add(1)
		if scope.ParentID == nil || scope.ParentID.String() != parentThreadID {
			t.Fatalf("child inventory scope=%#v, want parent %q", scope, parentThreadID)
		}
		return []flruntime.ThreadSummary{{
			ID: identity.ThreadID(childThreadID), ParentThreadID: identity.ThreadID(parentThreadID),
			TaskName: "Research models", TaskDescription: "Review model releases", HostProfileRef: subagentAgentTypeExplore,
			ForkMode: subagentContextModeMissionOnly, Activity: flruntime.ThreadActivityActive,
			CreatedAt: now, UpdatedAt: now,
		}}, nil
	}
	svc.threadRuntime = runtime
	svc.rememberFlowerRuntimeParent(childThreadID, parentThreadID)
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)

	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID: identity.ThreadID(childThreadID), ViewVersion: 1, Activity: flruntime.ThreadActivityActive,
	})
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ThreadID != parentThreadID || envelope.Current != nil || envelope.SubagentCurrent == nil || envelope.SubagentCurrent.ThreadID.String() != childThreadID || envelope.SubagentCurrent.ViewVersion != 1 {
		t.Fatalf("child projection=%#v, want parent-scoped child current", envelope)
	}
	frame = nextFlowerLiveStreamFrame(t, subscription)
	envelope = FlowerLiveStreamEnvelope{}
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ThreadID != parentThreadID || envelope.Current != nil || envelope.SubagentCurrent != nil || envelope.Subagents == nil || len(*envelope.Subagents) != 1 {
		t.Fatalf("child inventory projection=%#v, want independent parent inventory replacement", envelope)
	}
	item := (*envelope.Subagents)[0]
	if item.ThreadID != childThreadID || item.TaskName != "Research models" || item.Status != subagentStatusRunning {
		t.Fatalf("subagent patch item=%#v", item)
	}
	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID: identity.ThreadID(childThreadID), ViewVersion: 2, Activity: flruntime.ThreadActivityActive,
		Items: []flruntime.ThreadItem{{
			ID: "assistant-child", TurnID: "turn-child", RunID: "run-child", Ordinal: 1,
			Kind: flruntime.ThreadItemAssistant, Text: "streamed child content", Live: true,
		}},
	})
	frame = nextFlowerLiveStreamFrame(t, subscription)
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.SubagentCurrent == nil || envelope.SubagentCurrent.ViewVersion != 2 || len(envelope.SubagentCurrent.Items) != 1 || envelope.SubagentCurrent.Items[0].Text != "streamed child content" {
		t.Fatalf("text-only child projection=%#v, want complete current view", envelope.SubagentCurrent)
	}
	if got := listCalls.Load(); got != 1 {
		t.Fatalf("text-only child updates loaded parent inventory %d times, want 1", got)
	}
	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID: identity.ThreadID(childThreadID), ViewVersion: 3, Activity: flruntime.ThreadActivityActive,
		Attention: flruntime.AttentionSummary{InputCount: 1},
	})
	_ = nextFlowerLiveStreamFrame(t, subscription)
	_ = nextFlowerLiveStreamFrame(t, subscription)
	if got := listCalls.Load(); got != 2 {
		t.Fatalf("child lifecycle updates loaded parent inventory %d times, want 2", got)
	}
}

func TestFlowerWorkspaceStreamSubagentPatchPreservesExplicitEmptyInventory(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_empty_subagents")
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	svc.broadcastFlowerSubagentsPatch(meta.EndpointID, "parent-thread", nil)
	frame := nextFlowerLiveStreamFrame(t, subscription)
	if !strings.Contains(string(frame.Data), `"subagents":[]`) {
		t.Fatalf("empty inventory patch=%s, want explicit empty replacement", frame.Data)
	}
}

func TestFlowerWorkspaceStreamPublishesContextWithActiveCurrent(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_context_usage")
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	current := flruntime.ThreadView{ThreadID: "thread-context-usage", ViewVersion: 2, Activity: flruntime.ThreadActivityActive,
		TurnID: "turn-context", RunID: "run-context", Context: &flruntime.ThreadContextSnapshot{}}
	svc.broadcastFlowerRuntimeCurrent(meta.EndpointID, current)
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(frame.Data, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"model_context", "context_usage"} {
		if string(fields[key]) != "null" {
			t.Fatalf("%s=%s", key, fields[key])
		}
	}
	for _, key := range []string{"context_compactions", "timeline_decorations"} {
		if string(fields[key]) != "[]" {
			t.Fatalf("%s=%s", key, fields[key])
		}
	}
	var wireCurrent map[string]json.RawMessage
	if err := json.Unmarshal(fields["current"], &wireCurrent); err != nil {
		t.Fatal(err)
	}
	if _, ok := wireCurrent["context"]; ok {
		t.Fatal("raw Floret context reached browser")
	}
	if string(wireCurrent["view_version"]) != "2" {
		t.Fatalf("current=%s", fields["current"])
	}
}

func TestFlowerWorkspaceStreamReconnectsWithCompletePagedBaseline(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_workspace_paged", EndpointID: "env_workspace_paged",
		UserPublicID: "user_workspace_paged", NamespacePublicID: "namespace_workspace_paged",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	wantThreadIDs := make(map[string]struct{})
	createThreads := func(start, count int) {
		t.Helper()
		for index := start; index < start+count; index++ {
			thread, err := svc.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{
				ClientRequestID: fmt.Sprintf("create-workspace-paged-%03d", index),
			})
			if err != nil {
				t.Fatalf("create baseline thread %d: %v", index, err)
			}
			wantThreadIDs[thread.ThreadID] = struct{}{}
		}
	}
	assertCompleteBaseline := func(subscription *FlowerLiveStreamSubscription) {
		t.Helper()
		frame := nextFlowerLiveStreamFrame(t, subscription)
		if frame.Kind != FlowerLiveStreamReady {
			t.Fatalf("baseline frame kind=%q, want ready", frame.Kind)
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		if len(envelope.Summaries) != len(wantThreadIDs) {
			t.Fatalf("baseline summaries=%d, want %d", len(envelope.Summaries), len(wantThreadIDs))
		}
		seen := make(map[string]struct{}, len(envelope.Summaries))
		for _, summary := range envelope.Summaries {
			if _, expected := wantThreadIDs[summary.ThreadID]; !expected {
				t.Fatalf("baseline contains unexpected thread %q", summary.ThreadID)
			}
			if _, duplicate := seen[summary.ThreadID]; duplicate {
				t.Fatalf("baseline contains duplicate thread %q", summary.ThreadID)
			}
			seen[summary.ThreadID] = struct{}{}
		}
	}

	createThreads(0, flowerLiveBaselinePageLimit+5)
	first, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	assertCompleteBaseline(first)
	first.Close()

	createThreads(flowerLiveBaselinePageLimit+5, 3)
	second, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	assertCompleteBaseline(second)
}

func TestFlowerWorkspaceStreamReceivesTypedRuntimeCurrentViewWithoutSelectingThread(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_workspace_current", EndpointID: "env_workspace_current",
		UserPublicID: "user_workspace_current", NamespacePublicID: "namespace_workspace_current",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(ctx, meta, "Background thread", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}
	assertFlowerViewerReadBaseline(t, subscription, thread.ThreadID)
	startedAt := time.Now()
	result, err := svc.threadRuntime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), Input: flruntime.UserInput{Text: "continue in background"}, RequestKey: "request-workspace-current"})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 500*time.Millisecond {
		t.Fatalf("typed Send elapsed %s, want below 500ms", elapsed)
	}
	if result.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("Send view activity=%q", result.Activity)
	}
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if frame.Kind != FlowerLiveStreamThreadBatch || envelope.Current == nil {
		t.Fatalf("workspace frame=%s, want typed current thread batch", frame.Data)
	}
	if envelope.ThreadID != thread.ThreadID || envelope.Current.ThreadID.String() != thread.ThreadID || envelope.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("typed current envelope=%#v", envelope)
	}
}

func TestFlowerWorkspaceTerminalBatchAndDetailRestoreCanonicalManualCompaction(t *testing.T) {
	ctx := context.Background()
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Manual compaction recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}
	_, err = svc.CompactThreadContext(ctx, meta, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "request-manual-compaction-recovery"})
	if err != nil {
		t.Fatal(err)
	}

	var terminal FlowerLiveStreamEnvelope
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		frame := nextFlowerLiveStreamFrame(t, subscription)
		if frame.Kind != FlowerLiveStreamThreadBatch {
			continue
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.ThreadID == thread.ThreadID && envelope.Current != nil &&
			envelope.Current.Activity == flruntime.ThreadActivityIdle && len(envelope.ContextCompactions) > 0 {
			terminal = envelope
			break
		}
	}
	if terminal.Current == nil {
		t.Fatal("terminal thread.batch omitted canonical manual compaction")
	}
	expectedAnchor := ""
	assertTerminalManualCompactionProjection(t, terminal.ContextCompactions, terminal.TimelineDecorations, expectedAnchor)

	detail, err := svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	assertTerminalManualCompactionProjection(t, detail.Thread.ContextCompactions, detail.Thread.TimelineDecorations, expectedAnchor)
}

func canonicalUserMessageIDForTurn(items []flruntime.ThreadItem, turnID identity.TurnID) string {
	for _, item := range items {
		if item.Kind == flruntime.ThreadItemUser && item.TurnID == turnID {
			return item.ID
		}
	}
	return ""
}

func assertTerminalManualCompactionProjection(t *testing.T, compactions []FlowerContextCompaction, decorations []FlowerTimelineDecoration, expectedAnchor string) {
	t.Helper()
	if len(compactions) != 1 || len(decorations) != 0 {
		t.Fatalf("empty-history compactions=%#v decorations=%#v", compactions, decorations)
	}
	compaction := compactions[0]
	if compaction.RequestID != "request-manual-compaction-recovery" || compaction.Source != "thread_runtime" {
		t.Fatalf("manual compaction identity=%#v", compaction)
	}
	if compaction.Status != "noop" && compaction.Status != "compacted" {
		t.Fatalf("manual compaction status=%q, want terminal noop or compacted", compaction.Status)
	}

}

func TestFlowerWorkspaceSummaryFrameContainsSnapshotNotProjectionEvent(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_workspace_summary", EndpointID: "env_workspace_summary",
		UserPublicID: "user_workspace_summary", NamespacePublicID: "namespace_workspace_summary",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(ctx, meta, "Summary snapshot", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}
	assertFlowerViewerReadBaseline(t, subscription, thread.ThreadID)

	if err := svc.publishCanonicalThreadSummary(ctx, meta.EndpointID, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	// Thread creation may still publish its canonical current after subscription.
	// Validate that prefix instead of assuming the requested summary is next.
	summaryCtx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	var frame *FlowerLiveStreamFrame
	var envelope FlowerLiveStreamEnvelope
	for {
		frame, err = readFlowerLiveStreamEnvelope(summaryCtx, subscription)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		if frame.Kind == FlowerLiveStreamSummaryBatch {
			break
		}
		if frame.Kind != FlowerLiveStreamThreadBatch || envelope.Kind != frame.Kind || envelope.ThreadID != thread.ThreadID || envelope.Current == nil || envelope.Current.ThreadID.String() != thread.ThreadID || envelope.Current.Activity != flruntime.ThreadActivityIdle || len(envelope.Current.Turns) != 0 || len(envelope.Summaries) != 0 {
			t.Fatalf("unexpected frame before requested summary: %s", frame.Data)
		}
		envelope = FlowerLiveStreamEnvelope{}
	}
	if frame.Kind != FlowerLiveStreamSummaryBatch || len(envelope.Summaries) != 1 {
		t.Fatalf("summary frame=%s, want one summary snapshot", frame.Data)
	}
	if envelope.Summaries[0].ThreadID != thread.ThreadID {
		t.Fatalf("summary thread=%q, want %q", envelope.Summaries[0].ThreadID, thread.ThreadID)
	}
	if got := envelope.Summaries[0]; got.Title != "Summary snapshot" || got.TitleStatus != string(flruntime.ThreadTitleStatusReady) {
		t.Fatalf("summary title projection = (%q, %q), want (%q, %q)", got.Title, got.TitleStatus, "Summary snapshot", flruntime.ThreadTitleStatusReady)
	}
	if envelope.Current != nil {
		t.Fatalf("summary frame mixed detail/projection state: %s", frame.Data)
	}
}

func TestFlowerLiveSummaryFailureReconnectsToCanonicalBaseline(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_summary_reconnect", EndpointID: "env_summary_reconnect",
		UserPublicID: "user_summary_reconnect", NamespacePublicID: "namespace_summary_reconnect",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(ctx, meta, "Canonical reconnect title", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}

	svc.handleCanonicalThreadSummaryFailure(meta.EndpointID, thread.ThreadID, errors.New("summary read failed"))
	nextCtx, cancelNext := context.WithTimeout(ctx, time.Second)
	defer cancelNext()
	if frame, nextErr := subscription.Next(nextCtx); !errors.Is(nextErr, io.EOF) || frame != nil {
		t.Fatalf("fenced subscription frame=%#v error=%v, want EOF", frame, nextErr)
	}

	reconnected, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	ready := nextFlowerLiveStreamFrame(t, reconnected)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(ready.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if ready.Kind != FlowerLiveStreamReady || len(envelope.Summaries) != 1 {
		t.Fatalf("reconnected baseline=%s", ready.Data)
	}
	if got := envelope.Summaries[0]; got.ThreadID != thread.ThreadID || got.Title != "Canonical reconnect title" || got.TitleStatus != string(flruntime.ThreadTitleStatusReady) {
		t.Fatalf("reconnected canonical summary=%#v", got)
	}
}

func TestFlowerWorkspaceReadyUsesTypedRuntimeViewWithoutProjectionMirror(t *testing.T) {
	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		ChannelID: "channel_workspace_ready", EndpointID: "env_workspace_ready",
		UserPublicID: "user_workspace_ready", NamespacePublicID: "namespace_workspace_ready",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(ctx, meta, "Ready baseline thread", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		<-release
		events := make(chan flprovider.Event)
		close(events)
		return events, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "assistant", Name: "Assistant"}, SystemPrompt: "Wait.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { close(release) })
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), "request-workspace-ready", floretEffectRequest{agent: agent, meta: *meta, req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	result, err := svc.threadRuntime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), Input: flruntime.UserInput{Text: "remain active for baseline"}, RequestKey: "request-workspace-ready"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("Send view activity=%q", result.Activity)
	}
	// Let the service runtime pump consume the original publication before the
	// observer connects. The subscription must recover current state itself.
	time.Sleep(100 * time.Millisecond)

	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	ready := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(ready.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if ready.Kind != FlowerLiveStreamReady || len(envelope.Summaries) != 1 {
		t.Fatalf("ready frame=%s", ready.Data)
	}
	if got := envelope.Summaries[0]; got.ThreadID != thread.ThreadID || got.RunStatus != string(RunStateRunning) {
		t.Fatalf("ready summary=%#v, want typed running state", got)
	}
	assertFlowerViewerReadBaseline(t, subscription, thread.ThreadID)
	currentFrame := nextFlowerLiveStreamFrame(t, subscription)
	var currentEnvelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(currentFrame.Data, &currentEnvelope); err != nil {
		t.Fatal(err)
	}
	if currentFrame.Kind != FlowerLiveStreamThreadBatch || currentEnvelope.Current == nil {
		t.Fatalf("baseline current frame=%s, want typed thread.batch", currentFrame.Data)
	}
	if currentEnvelope.ThreadID != thread.ThreadID || currentEnvelope.Current.ThreadID.String() != thread.ThreadID || currentEnvelope.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("baseline current envelope=%#v", currentEnvelope)
	}
}

func TestFlowerLiveSummaryBatchDoesNotExposeViewerReadState(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_private")
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	svc.publishFlowerLiveSummary(meta.EndpointID, ThreadView{ThreadID: "background_thread", Title: "shared"})
	frame := nextFlowerLiveStreamFrame(t, subscription)
	if frame.Kind != FlowerLiveStreamSummaryBatch {
		t.Fatalf("frame kind=%q, want summary.batch", frame.Kind)
	}
	if strings.Contains(string(frame.Data), "read_status") || strings.Contains(string(frame.Data), `"private"`) {
		t.Fatalf("summary batch exposes viewer state: %s", frame.Data)
	}
}

func TestFlowerLiveThreadBatchDoesNotExposeViewerReadState(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_thread_private")
	threadID := "selected_thread"
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID: identity.ThreadID(threadID), ViewVersion: 1,
	})
	frame := nextFlowerLiveStreamFrame(t, subscription)
	if frame.Kind != FlowerLiveStreamThreadBatch {
		t.Fatalf("frame kind=%q, want thread.batch", frame.Kind)
	}
	if strings.Contains(string(frame.Data), "read_status") || strings.Contains(string(frame.Data), `"private"`) {
		t.Fatalf("thread batch exposes viewer state: %s", frame.Data)
	}
}

func TestFlowerLiveViewerReadBaselineIsPrivateAndRestoredOnReconnect(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Read baseline", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	activity := thread.FlowerActivity.ActivityRevision
	if activity <= 1 {
		t.Fatalf("invalid test activity: %d", activity)
	}
	if _, err := svc.ThreadReadState().AdvanceFlower(t.Context(), meta.EndpointID, meta.UserPublicID, thread.ThreadID, threadreadstate.FlowerSnapshot{ActivityRevision: activity - 1}); err != nil {
		t.Fatal(err)
	}
	for _, reconnect := range []bool{false, true} {
		subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
		if err != nil {
			t.Fatal(err)
		}
		ready := nextFlowerLiveStreamFrame(t, subscription)
		if ready.Kind != FlowerLiveStreamReady || strings.Contains(string(ready.Data), "read_status") {
			t.Fatalf("shared baseline leaks read state: %s", ready.Data)
		}
		frame := nextFlowerLiveStreamFrame(t, subscription)
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		expected := activity - 1
		if reconnect {
			expected = activity
		}
		if envelope.Kind != FlowerLiveStreamViewerReadState || envelope.ThreadID != thread.ThreadID || envelope.ReadStatus == nil || envelope.ReadStatus.ReadState.LastSeenActivityRevision != expected || envelope.ReadStatus.IsUnread == reconnect {
			t.Fatalf("private baseline reconnect=%t: %s", reconnect, frame.Data)
		}
		subscription.Close()
		if _, err := svc.ThreadReadState().AdvanceFlower(t.Context(), meta.EndpointID, meta.UserPublicID, thread.ThreadID, threadreadstate.FlowerSnapshot{ActivityRevision: activity}); err != nil {
			t.Fatal(err)
		}
	}
	other := *meta
	other.UserPublicID = "other_read_baseline_user"
	subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), &other, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ReadStatus == nil || envelope.ReadStatus.ReadState.LastSeenActivityRevision != activity || envelope.ReadStatus.IsUnread {
		t.Fatalf("new user baseline changed initialization policy: %s", frame.Data)
	}
}

func TestFlowerLiveViewerReadStateIsSharedOnlyWithSameUser(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	firstMeta := flowerLiveMemoryTestMeta("env_live_stream_viewer")
	secondMeta := firstMeta
	otherMeta := firstMeta
	otherMeta.UserPublicID = "other_user"
	threadID := "thread_viewer"

	first, err := svc.SubscribeFlowerLiveStream(context.Background(), &firstMeta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := svc.SubscribeFlowerLiveStream(context.Background(), &secondMeta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	other, err := svc.SubscribeFlowerLiveStream(context.Background(), &otherMeta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	_ = nextFlowerLiveStreamFrame(t, first)
	_ = nextFlowerLiveStreamFrame(t, second)
	_ = nextFlowerLiveStreamFrame(t, other)

	readStatus := FlowerThreadReadView{
		IsUnread:  false,
		Snapshot:  FlowerThreadReadSnapshot{ActivityRevision: 7},
		ReadState: FlowerThreadReadRecord{LastSeenActivityRevision: 7},
	}
	if err := svc.PublishFlowerViewerReadState(&firstMeta, threadID, readStatus); err != nil {
		t.Fatal(err)
	}
	firstFrame := nextFlowerLiveStreamFrame(t, first)
	secondFrame := nextFlowerLiveStreamFrame(t, second)
	if firstFrame.Kind != FlowerLiveStreamViewerReadState || secondFrame.Kind != FlowerLiveStreamViewerReadState {
		t.Fatalf("same-user frame kinds=%q/%q, want viewer.read_state", firstFrame.Kind, secondFrame.Kind)
	}
	if !bytes.Equal(firstFrame.Data, secondFrame.Data) {
		t.Fatal("same-user tabs did not share one immutable encoded viewer batch")
	}
	if !strings.Contains(string(firstFrame.Data), `"last_seen_activity_revision":7`) {
		t.Fatalf("viewer frame omitted read state: %s", firstFrame.Data)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if frame, err := other.Next(ctx); !errors.Is(err, context.DeadlineExceeded) || frame != nil {
		t.Fatalf("other user received private frame=%#v error=%v", frame, err)
	}
}

// Validate the private baseline before asserting the exact next shared frame.
func assertFlowerViewerReadBaseline(t *testing.T, subscription *FlowerLiveStreamSubscription, threadID string) {
	t.Helper()
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if frame.Kind != FlowerLiveStreamViewerReadState || envelope.Kind != FlowerLiveStreamViewerReadState || envelope.ThreadID != threadID || envelope.ReadStatus == nil || envelope.ReadStatus.Snapshot.ActivityRevision <= 0 {
		t.Fatalf("private read baseline=%s, want current read state for %q", frame.Data, threadID)
	}
	status := envelope.ReadStatus
	if status.ReadState.LastSeenActivityRevision > status.Snapshot.ActivityRevision || status.IsUnread != (status.Snapshot.ActivityRevision > status.ReadState.LastSeenActivityRevision) {
		t.Fatalf("inconsistent private read baseline: %+v", status)
	}
}

func nextFlowerLiveStreamFrame(t *testing.T, subscription *FlowerLiveStreamSubscription) *FlowerLiveStreamFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	frame, err := readFlowerLiveStreamEnvelope(ctx, subscription)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func readFlowerLiveStreamEnvelope(ctx context.Context, subscription *FlowerLiveStreamSubscription) (*FlowerLiveStreamFrame, error) {
	var assembled []byte
	var first FlowerLiveStreamFragment
	var kind FlowerLiveStreamKind
	for index := 0; ; index++ {
		frame, err := subscription.Next(ctx)
		if err != nil {
			return nil, err
		}
		if len(frame.Data) > flowerLiveFrameByteLimit {
			return nil, fmt.Errorf("wire frame exceeds byte budget: %d", len(frame.Data))
		}
		var fragment FlowerLiveStreamFragment
		if err := json.Unmarshal(frame.Data, &fragment); err != nil {
			return nil, fmt.Errorf("decode Flower live stream fragment: %w", err)
		}
		if index == 0 {
			first, kind = fragment, frame.Kind
		}
		if fragment.EnvelopeID == "" || fragment.EnvelopeID != first.EnvelopeID || fragment.FragmentIndex != index || fragment.FragmentCount != first.FragmentCount || fragment.TotalBytes != first.TotalBytes {
			return nil, fmt.Errorf("invalid fragment ordering: %#v", fragment)
		}
		data, err := base64.StdEncoding.Strict().DecodeString(fragment.DataBase64)
		if err != nil || len(data) > flowerLiveFragmentByteLimit {
			return nil, fmt.Errorf("decode raw Flower fragment: bytes=%d error=%v", len(data), err)
		}
		assembled = append(assembled, data...)
		if index+1 == first.FragmentCount {
			if len(assembled) != first.TotalBytes {
				return nil, fmt.Errorf("assembled bytes=%d want %d", len(assembled), first.TotalBytes)
			}
			return &FlowerLiveStreamFrame{Kind: kind, Data: assembled}, nil
		}
	}
}

func TestFlowerLiveStreamSharesEncodedBatchesAcrossObservers(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_shared")
	meta.CanWrite = false
	meta.CanExecute = false
	threadID := "thread_live_stream_shared"

	first, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatalf("subscribe first read-only observer: %v", err)
	}
	defer first.Close()
	second, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatalf("subscribe second read-only observer: %v", err)
	}
	defer second.Close()
	if got := nextFlowerLiveStreamFrame(t, first).Kind; got != FlowerLiveStreamReady {
		t.Fatalf("first frame kind=%q, want ready", got)
	}
	if got := nextFlowerLiveStreamFrame(t, second).Kind; got != FlowerLiveStreamReady {
		t.Fatalf("second frame kind=%q, want ready", got)
	}

	svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
		ThreadID: identity.ThreadID(threadID), ViewVersion: 1, Activity: flruntime.ThreadActivityActive, RunID: identity.RunID("run_live_stream_shared"),
		Items: []flruntime.ThreadItem{{
			ID: "assistant:turn_live_stream_shared:1", TurnID: identity.TurnID("turn_live_stream_shared"), RunID: identity.RunID("run_live_stream_shared"),
			Ordinal: 1, Kind: flruntime.ThreadItemAssistant, Text: "hello", Live: true,
		}},
	})
	firstBatch := nextFlowerLiveStreamFrame(t, first)
	secondBatch := nextFlowerLiveStreamFrame(t, second)
	if firstBatch.Kind != FlowerLiveStreamThreadBatch || secondBatch.Kind != FlowerLiveStreamThreadBatch {
		t.Fatalf("batch kinds=%q/%q, want thread.batch", firstBatch.Kind, secondBatch.Kind)
	}
	if !bytes.Equal(firstBatch.Data, secondBatch.Data) {
		t.Fatal("observers did not receive the same immutable encoded batch")
	}
}

func TestFlowerLiveStreamSharesCanonicalOrderAtObserverScale(t *testing.T) {
	for _, observerCount := range []int{1, 10, 100, flowerLiveMaxSubscribersPerEndpoint} {
		observerCount := observerCount
		t.Run(fmt.Sprintf("%d_observers", observerCount), func(t *testing.T) {
			svc := newFlowerLiveMemoryTestService()
			meta := flowerLiveMemoryTestMeta("env_live_stream_scale")
			threadID := "thread_live_stream_scale"
			subscriptions := make([]*FlowerLiveStreamSubscription, 0, observerCount)
			for range observerCount {
				subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
				if err != nil {
					t.Fatalf("subscribe observer %d/%d: %v", len(subscriptions)+1, observerCount, err)
				}
				subscriptions = append(subscriptions, subscription)
				_ = nextFlowerLiveStreamFrame(t, subscription)
			}
			t.Cleanup(func() {
				for _, subscription := range subscriptions {
					subscription.Close()
				}
			})
			svc.publishFlowerLiveSummary(meta.EndpointID, ThreadView{ThreadID: threadID, Title: "shared"})
			var canonical *FlowerLiveStreamFrame
			for index, subscription := range subscriptions {
				frame := nextFlowerLiveStreamFrame(t, subscription)
				if frame.Kind != FlowerLiveStreamSummaryBatch {
					t.Fatalf("observer %d frame=%#v, want shared summary batch", index, frame)
				}
				if canonical == nil {
					canonical = frame
					continue
				}
				if !bytes.Equal(frame.Data, canonical.Data) {
					t.Fatalf("observer %d did not receive the shared encoded batch", index)
				}
			}
		})
	}
}

func TestFlowerLiveStreamGlobalQueuedReferenceBudget(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	batch := &flowerLiveEncodedBatch{data: make([]byte, 1<<20)}
	for index := 0; index < flowerLiveGlobalQueuedByteLimit/(1<<20); index++ {
		subscriber := &flowerLiveSubscriber{queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit)}
		if !enqueueFlowerLiveSubscriberLocked(svc, subscriber, batch) {
			t.Fatalf("enqueue %d was rejected before the global budget", index+1)
		}
	}
	overflow := &flowerLiveSubscriber{queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit)}
	if enqueueFlowerLiveSubscriberLocked(svc, overflow, batch) {
		t.Fatal("enqueue beyond the global queued reference budget succeeded")
	}
	if svc.flowerLiveQueuedBytes != flowerLiveGlobalQueuedByteLimit {
		t.Fatalf("queued bytes=%d, want %d", svc.flowerLiveQueuedBytes, flowerLiveGlobalQueuedByteLimit)
	}
}

func TestFlowerLiveStreamOversizedEnvelopeStopsInvalidReconnect(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	subscriber := &flowerLiveSubscriber{
		id: 1, endpointID: "env_live_oversized", queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit),
	}
	svc.flowerLiveSubscribers[subscriber.id] = subscriber
	svc.flowerLiveSubscribersByEndpoint[subscriber.endpointID] = 1
	oversized := &flowerLiveEncodedBatch{kind: FlowerLiveStreamThreadBatch, data: make([]byte, flowerLiveEnvelopeByteLimit+1)}
	if enqueueFlowerLiveSubscriberLocked(svc, subscriber, oversized) {
		t.Fatal("oversized envelope was accepted")
	}
	if !subscriber.closed {
		t.Fatal("oversized envelope did not close subscriber")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	subscription := &FlowerLiveStreamSubscription{service: svc, subscriber: subscriber}
	if frame, err := subscription.Next(ctx); !errors.Is(err, ErrFlowerLiveSync) || frame != nil {
		t.Fatalf("oversized subscriber next=(%#v, %v), want terminal synchronization error", frame, err)
	}
}

func TestFlowerLiveStreamInitializationKeepsLargeBaselineBeforeReady(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	subscriber := &flowerLiveSubscriber{
		id: 1, endpointID: "env_live_large_baseline", initializing: true,
		queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit),
	}
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady})
	baselines := make([]*flowerLiveEncodedBatch, 24)
	for index := range baselines {
		baselines[index] = newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
			SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: fmt.Sprintf("thread-large-%d", index),
		})
	}
	svc.flowerLiveSubscribers[subscriber.id] = subscriber
	svc.flowerLiveSubscribersByEndpoint[subscriber.endpointID] = 1
	svc.mu.Lock()
	for _, batch := range append([]*flowerLiveEncodedBatch{ready}, baselines...) {
		if !retainFlowerLiveBatchLocked(svc, subscriber, batch) {
			t.Fatal("initial baseline retention failed")
		}
		subscriber.initial = append(subscriber.initial, batch)
	}
	finalizeFlowerLiveSubscriberInitializationLocked(svc, subscriber)
	svc.mu.Unlock()
	if subscriber.closed || subscriber.initializing {
		t.Fatal("large baseline initialization closed or left subscriber initializing")
	}
	if got, want := len(subscriber.initial), 1+len(baselines); got != want {
		t.Fatalf("queued initialization frames=%d, want %d", got, want)
	}
	if first := subscriber.initial[0]; first != ready {
		t.Fatal("ready frame was not retained as the first initialization frame")
	}
}

func TestFlowerLiveStreamAdmissionAndSlowObserverReconnectFence(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_admission")
	threadID := "thread_live_stream_admission"
	subscriptions := make([]*FlowerLiveStreamSubscription, 0, flowerLiveMaxSubscribersPerEndpoint)
	for range flowerLiveMaxSubscribersPerEndpoint {
		subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{})
		if err != nil {
			t.Fatalf("subscribe admitted observer %d: %v", len(subscriptions)+1, err)
		}
		subscriptions = append(subscriptions, subscription)
	}
	defer func() {
		for _, subscription := range subscriptions {
			subscription.Close()
		}
	}()
	if _, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{}); !errors.Is(err, ErrFlowerLiveTooManySubscribers) {
		t.Fatalf("257th observer error=%v, want admission error", err)
	}

	fast := subscriptions[0]
	slow := subscriptions[1]
	_ = nextFlowerLiveStreamFrame(t, fast)
	_ = nextFlowerLiveStreamFrame(t, slow)
	for index := range flowerLiveSubscriberBatchLimit + 1 {
		svc.publishFlowerRuntimeCurrent(meta.EndpointID, flruntime.ThreadView{
			ThreadID: identity.ThreadID(threadID), ViewVersion: uint64(index + 1),
			Activity: flruntime.ThreadActivityActive, RunID: identity.RunID("run_live_stream_scale"),
			Items: []flruntime.ThreadItem{{
				ID: "assistant:turn_live_stream_scale:1", TurnID: identity.TurnID("turn_live_stream_scale"), RunID: identity.RunID("run_live_stream_scale"),
				Ordinal: 1, Kind: flruntime.ThreadItemAssistant, Text: fmt.Sprintf("draft-%d", index), Live: true,
			}},
		})
		_ = nextFlowerLiveStreamFrame(t, fast)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if frame, err := slow.Next(ctx); !errors.Is(err, io.EOF) || frame != nil {
		t.Fatalf("slow observer frame=%#v error=%v, want immediate reconnect fence", frame, err)
	}

	before := svc.flowerLiveSubscriberCount(meta.EndpointID)
	fast.Close()
	if after := svc.flowerLiveSubscriberCount(meta.EndpointID); after != before-1 {
		t.Fatalf("subscriber count after close=%d, want %d", after, before-1)
	}
}

func TestFlowerLiveStreamRejectsMissingReadPermission(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_denied")
	meta.CanRead = false
	if _, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{}); !errors.Is(err, errReadPermissionDenied) {
		t.Fatalf("subscribe error=%v, want read permission denied", err)
	}
}

func TestFlowerLiveStreamPublishesComputerFrameToOwnerOnly(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	firstMeta := &session.Meta{EndpointID: "env-frame", UserPublicID: "user-frame", CanRead: true}
	otherMeta := &session.Meta{EndpointID: "env-other", UserPublicID: "user-other", CanRead: true}
	first, err := svc.SubscribeFlowerLiveStream(context.Background(), firstMeta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	other, err := svc.SubscribeFlowerLiveStream(context.Background(), otherMeta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	_ = nextFlowerLiveStreamFrame(t, first)
	_ = nextFlowerLiveStreamFrame(t, other)
	if err := svc.PublishFlowerComputerFrame(firstMeta, FlowerComputerFrame{ThreadID: "thread-frame", SessionID: "session-frame", TargetID: "browser-main", ResourceRef: "computer://browser-main/" + strings.Repeat("a", 64), SHA256: strings.Repeat("a", 64), MIMEType: "image/png", Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	frame := nextFlowerLiveStreamFrame(t, first)
	if frame.Kind != FlowerLiveStreamComputerFrame {
		t.Fatalf("kind=%s", frame.Kind)
	}
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ComputerFrame == nil || envelope.ComputerFrame.ThreadID != "thread-frame" {
		t.Fatalf("frame=%#v", envelope.ComputerFrame)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := other.Next(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cross-owner frame delivered: %v", err)
	}
}

func TestFlowerLiveStreamSlowViewerKeepsLatestFrameWithoutClosingLifecycle(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	meta := &session.Meta{EndpointID: "env-frame", UserPublicID: "user-frame", CanRead: true}
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	_ = nextFlowerLiveStreamFrame(t, sub)
	for i := uint64(1); i <= 100; i++ {
		if err := svc.PublishFlowerComputerFrame(meta, FlowerComputerFrame{ThreadID: "thread", SessionID: "session", TargetID: "browser-main", ResourceRef: "computer://browser-main/" + strings.Repeat("a", 64), SHA256: strings.Repeat("a", 64), MIMEType: "image/png", Sequence: i}); err != nil {
			t.Fatal(err)
		}
	}
	svc.mu.Lock()
	closed := sub.subscriber.closed
	queued := sub.subscriber.queuedBytes
	svc.mu.Unlock()
	if closed {
		t.Fatal("live frames disconnected the workspace lifecycle stream")
	}
	if queued != 0 {
		t.Fatal("ephemeral frames consumed lifecycle queue budget")
	}
	frame := nextFlowerLiveStreamFrame(t, sub)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ComputerFrame == nil || envelope.ComputerFrame.Sequence != 100 {
		t.Fatalf("expected newest frame, got %s", frame.Data)
	}
}

func TestComputerViewerStopsWithWorkspaceConnection(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("viewer")
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	executor := newLiveFrameExecutor(t)
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	defer runtime.Close()
	svc.targetToolExecutor = runtime
	acquireLiveFrameTestTarget(t, runtime, "thread")
	request := ComputerViewerRequest{ObserverID: sub.subscriber.observerID, Revision: 1, ThreadID: "thread", TargetID: "target"}
	if err := svc.setComputerViewer(t.Context(), &meta, request); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for executor.calls.Load() < 3 && time.Now().Before(deadline) {
		_, _ = runtime.ResolveComputerLiveFrame(t.Context(), "thread", "target", executor.attachment.ResourceRef)
		time.Sleep(20 * time.Millisecond)
	}
	if executor.calls.Load() < 3 {
		t.Fatal("viewer did not capture without tool calls")
	}
	// Older requests cannot reopen a viewer after the close command.
	request.Revision = 3
	request.ThreadID = ""
	if err := svc.setComputerViewer(t.Context(), &meta, request); err != nil {
		t.Fatal(err)
	}
	request.Revision = 2
	request.ThreadID = "thread"
	if err := svc.setComputerViewer(t.Context(), &meta, request); err == nil {
		t.Fatal("stale command accepted")
	}
	before := executor.calls.Load()
	time.Sleep(2 * computerLiveFrameInterval)
	if executor.calls.Load() != before {
		t.Fatal("capture continued after close")
	}
	request.Revision = 4
	if err := svc.setComputerViewer(t.Context(), &meta, request); err != nil {
		t.Fatal(err)
	}
	sub.Close()
	runtime.liveWG.Wait()
	before = executor.calls.Load()
	time.Sleep(computerLiveFrameInterval)
	if executor.calls.Load() != before {
		t.Fatal("capture survived workspace disconnect")
	}
}

func TestComputerViewerRejectsAnotherObserverOwner(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	owner := flowerLiveMemoryTestMeta("owner")
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), &owner, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	other := owner
	other.UserPublicID = "other"
	err = svc.setComputerViewer(t.Context(), &other, ComputerViewerRequest{ObserverID: sub.subscriber.observerID, Revision: 1})
	if err == nil {
		t.Fatal("another user changed observer")
	}
}

func TestModelDirectoryNotificationContainsNoScopedMetadata(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	for i := uint64(1); i <= 2; i++ {
		svc.flowerLiveSubscribers[i] = &flowerLiveSubscriber{id: i, endpointID: fmt.Sprint(i), queue: make([]*flowerLiveEncodedBatch, 0, flowerLiveSubscriberBatchLimit)}
	}
	svc.publishModelDirectoryChanged()
	for _, subscriber := range svc.flowerLiveSubscribers {
		batch := subscriber.queue[0]
		var decoded map[string]any
		if err := json.Unmarshal(batch.data, &decoded); err != nil {
			t.Fatal(err)
		}
		if len(decoded) != 2 || decoded["kind"] != "model_directory.changed" || decoded["schema_version"] != float64(1) {
			t.Fatalf("scoped metadata leaked: %+v", decoded)
		}
	}
}

func TestFlowerCurrentComparisonRetainsContextBoundariesAndTextCoalescing(t *testing.T) {
	current := thinkingCurrent(1, "first", true, flruntime.ThreadActivityActive)
	current.Context = &flruntime.ThreadContextSnapshot{}
	frame := func(view flruntime.ThreadView) FlowerLiveStreamEnvelope {
		return FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: view.ThreadID.String(), Current: &view}
	}
	first := compareFlowerLiveCurrent(frame(current))
	current.ViewVersion = 2
	current.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	current.Items[0].Text = "first second"
	second := compareFlowerLiveCurrent(frame(current))
	if !first.independent || !second.independent || first.fingerprint != second.fingerprint {
		t.Fatal("equal full snapshots defeated coalescing")
	}
	current.Context = &flruntime.ThreadContextSnapshot{UsageTotals: &flruntime.ThreadTokenUsageTotals{InputTokens: 1}}
	changed := compareFlowerLiveCurrent(frame(current))
	if changed.fingerprint == second.fingerprint {
		t.Fatal("context change did not create a barrier")
	}
}
