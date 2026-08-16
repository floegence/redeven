package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v4/config"
	"github.com/floegence/floret/v4/identity"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

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
	started, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ClientRequestID: "request-manual-compaction-recovery",
		ThreadID:        thread.ThreadID,
		Input:           RunInput{Text: "/compact"},
	})
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
	expectedAnchor := canonicalUserMessageIDForTurn(terminal.Current.Items, identity.TurnID(started.TurnID))
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
	if strings.TrimSpace(expectedAnchor) == "" {
		t.Fatal("canonical manual compaction turn has no user message")
	}
	if len(compactions) != 1 || len(decorations) != 1 {
		t.Fatalf("compactions=%#v decorations=%#v, want one canonical operation", compactions, decorations)
	}
	compaction := compactions[0]
	if compaction.RequestID != "request-manual-compaction-recovery" || compaction.Source != flowerManualCompactionSourceName {
		t.Fatalf("manual compaction identity=%#v", compaction)
	}
	if compaction.Status != "noop" && compaction.Status != "compacted" {
		t.Fatalf("manual compaction status=%q, want terminal noop or compacted", compaction.Status)
	}
	decoration := decorations[0]
	if decoration.DecorationID != "context-compaction:"+compaction.OperationID || decoration.Compaction.Status != compaction.Status {
		t.Fatalf("manual compaction decoration=%#v", decoration)
	}
	if decoration.Anchor.TargetKind != "message" || decoration.Anchor.Edge != "after" || decoration.Anchor.MessageID != expectedAnchor {
		t.Fatalf("manual compaction anchor=%#v, want canonical user message %q", decoration.Anchor, expectedAnchor)
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

	if err := svc.broadcastThreadSummary(meta.EndpointID, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	frame := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &envelope); err != nil {
		t.Fatal(err)
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
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), "request-workspace-ready", floretEffectRequest{agent: agent})
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
		Snapshot:  FlowerThreadReadSnapshot{ActivityRevision: 7, ActivitySignature: "snapshot"},
		ReadState: FlowerThreadReadRecord{LastSeenActivityRevision: 7, LastSeenActivitySignature: "private_read"},
	}
	if err := svc.PublishFlowerViewerReadState(&firstMeta, threadID, readStatus); err != nil {
		t.Fatal(err)
	}
	firstFrame := nextFlowerLiveStreamFrame(t, first)
	secondFrame := nextFlowerLiveStreamFrame(t, second)
	if firstFrame.Kind != FlowerLiveStreamViewerReadState || secondFrame.Kind != FlowerLiveStreamViewerReadState {
		t.Fatalf("same-user frame kinds=%q/%q, want viewer.read_state", firstFrame.Kind, secondFrame.Kind)
	}
	if len(firstFrame.Data) == 0 || len(secondFrame.Data) == 0 || &firstFrame.Data[0] != &secondFrame.Data[0] {
		t.Fatal("same-user tabs did not share one immutable encoded viewer batch")
	}
	if !strings.Contains(string(firstFrame.Data), "private_read") {
		t.Fatalf("viewer frame omitted read state: %s", firstFrame.Data)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if frame, err := other.Next(ctx); !errors.Is(err, context.DeadlineExceeded) || frame != nil {
		t.Fatalf("other user received private frame=%#v error=%v", frame, err)
	}
}

func nextFlowerLiveStreamFrame(t *testing.T, subscription *FlowerLiveStreamSubscription) *FlowerLiveStreamFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	frame, err := subscription.Next(ctx)
	if err != nil {
		t.Fatalf("read Flower live stream frame: %v", err)
	}
	return frame
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
		ThreadID:    identity.ThreadID(threadID),
		ViewVersion: 1, Activity: flruntime.ThreadActivityActive, AssistantDraft: "hello",
	})
	firstBatch := nextFlowerLiveStreamFrame(t, first)
	secondBatch := nextFlowerLiveStreamFrame(t, second)
	if firstBatch.Kind != FlowerLiveStreamThreadBatch || secondBatch.Kind != FlowerLiveStreamThreadBatch {
		t.Fatalf("batch kinds=%q/%q, want thread.batch", firstBatch.Kind, secondBatch.Kind)
	}
	if len(firstBatch.Data) == 0 || len(secondBatch.Data) == 0 || &firstBatch.Data[0] != &secondBatch.Data[0] {
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
				if string(frame.Data) != string(canonical.Data) || &frame.Data[0] != &canonical.Data[0] {
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
		subscriber := &flowerLiveSubscriber{queue: make(chan *flowerLiveEncodedBatch, flowerLiveSubscriberBatchLimit)}
		if !enqueueFlowerLiveSubscriberLocked(svc, subscriber, batch) {
			t.Fatalf("enqueue %d was rejected before the global budget", index+1)
		}
	}
	overflow := &flowerLiveSubscriber{queue: make(chan *flowerLiveEncodedBatch, flowerLiveSubscriberBatchLimit)}
	if enqueueFlowerLiveSubscriberLocked(svc, overflow, batch) {
		t.Fatal("enqueue beyond the global queued reference budget succeeded")
	}
	if svc.flowerLiveQueuedBytes != flowerLiveGlobalQueuedByteLimit {
		t.Fatalf("queued bytes=%d, want %d", svc.flowerLiveQueuedBytes, flowerLiveGlobalQueuedByteLimit)
	}
}

func TestFlowerLiveStreamAdmissionAndSlowObserverIsolation(t *testing.T) {
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
			Activity: flruntime.ThreadActivityActive, AssistantDraft: fmt.Sprintf("draft-%d", index),
		})
		_ = nextFlowerLiveStreamFrame(t, fast)
	}

	seenLatest := false
	for range flowerLiveSubscriberBatchLimit {
		frame := nextFlowerLiveStreamFrame(t, slow)
		if strings.Contains(string(frame.Data), fmt.Sprintf("draft-%d", flowerLiveSubscriberBatchLimit)) {
			seenLatest = true
		}
	}
	if !seenLatest {
		t.Fatal("slow observer did not retain the newest workspace update")
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
