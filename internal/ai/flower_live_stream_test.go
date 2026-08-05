package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestFlowerLiveStreamCoalescesDeltasAndDeduplicatesBlockSets(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_coalesce")
	threadID := "thread_live_stream_coalesce"
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	for index := range 10 {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta,
			Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{MessageID: "message_1", BlockIndex: 0, Delta: string(rune('a' + index))}),
		})
	}
	batch := nextFlowerLiveStreamFrame(t, subscription)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(batch.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if batch.FromSeq != 1 || batch.ThroughSeq != 10 || len(envelope.Events) != 10 {
		t.Fatalf("coalesced batch=%d..%d events=%d, want 1..10/10", batch.FromSeq, batch.ThroughSeq, len(envelope.Events))
	}

	payload := mustFlowerPayload(FlowerLiveMessageBlockSetPayload{MessageID: "message_1", BlockIndex: 0, Block: map[string]any{"type": "text", "text": "done"}})
	if _, accepted := svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockSet, Payload: payload}); !accepted {
		t.Fatal("first block_set was rejected")
	}
	if _, accepted := svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockSet, Payload: payload}); accepted {
		t.Fatal("identical block_set was not deduplicated")
	}
}

func TestFlowerLiveSummaryBatchDoesNotExposeViewerReadState(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_private")
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: "selected_thread"})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID, ThreadID: "background_thread", Kind: FlowerLiveThreadPatched,
		Payload: mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{
			ThreadID:   "background_thread",
			ReadStatus: &FlowerThreadReadView{IsUnread: true, ReadState: FlowerThreadReadRecord{LastSeenActivitySignature: "private"}},
		}}),
	})
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
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	_ = nextFlowerLiveStreamFrame(t, subscription)
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveThreadPatched,
		Payload: mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{
			ThreadID:   threadID,
			ReadStatus: &FlowerThreadReadView{IsUnread: true, ReadState: FlowerThreadReadRecord{LastSeenActivitySignature: "private"}},
		}}),
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

	first, err := svc.SubscribeFlowerLiveStream(context.Background(), &firstMeta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := svc.SubscribeFlowerLiveStream(context.Background(), &secondMeta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	other, err := svc.SubscribeFlowerLiveStream(context.Background(), &otherMeta, FlowerLiveStreamRequest{ThreadID: threadID})
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

	first, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatalf("subscribe first read-only observer: %v", err)
	}
	defer first.Close()
	second, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
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

	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{MessageID: "message_1", BlockIndex: 0, Delta: "hello"}),
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
				subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
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
			svc.appendFlowerLiveEvent(FlowerLiveEvent{
				EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveThreadPatched,
				Payload: mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{ThreadID: threadID, Title: "shared"}}),
			})
			var canonical *FlowerLiveStreamFrame
			for index, subscription := range subscriptions {
				frame := nextFlowerLiveStreamFrame(t, subscription)
				if frame.Kind != FlowerLiveStreamThreadBatch || frame.FromSeq != 1 || frame.ThroughSeq != 1 {
					t.Fatalf("observer %d frame=%#v, want canonical thread batch 1..1", index, frame)
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

func TestFlowerLiveMetricsTrackDeduplicationBatchesAndSubscribers(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_metrics")
	threadID := "thread_live_stream_metrics"
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
	if err != nil {
		t.Fatal(err)
	}
	_ = nextFlowerLiveStreamFrame(t, subscription)
	payload := mustFlowerPayload(FlowerLiveMessageBlockSetPayload{MessageID: "message_metrics", BlockIndex: 0, Block: map[string]any{"type": "text", "text": "same"}})
	svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockSet, Payload: payload})
	svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockSet, Payload: payload})
	_ = nextFlowerLiveStreamFrame(t, subscription)
	subscription.Close()

	metrics := svc.FlowerLiveMetrics()
	if metrics.CanonicalInputs != 2 || metrics.DeduplicatedBlockSets != 1 || metrics.LogicalEvents != 1 {
		t.Fatalf("event metrics=%+v", metrics)
	}
	if metrics.Batches == 0 || metrics.EncodedBytes == 0 || metrics.PeakSubscribers != 1 || metrics.CurrentSubscribers != 0 {
		t.Fatalf("stream metrics=%+v", metrics)
	}
}

func TestFlowerLiveStreamRegistersBacklogAndLiveFanoutWithoutGap(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_gap")
	threadID := "thread_live_stream_gap"
	first, _ := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{MessageID: "message_1", Delta: "a"}),
	})
	subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{
		ThreadID: threadID,
		AfterSeq: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	second, _ := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{MessageID: "message_1", Delta: "b"}),
	})

	ready := nextFlowerLiveStreamFrame(t, subscription)
	batch := nextFlowerLiveStreamFrame(t, subscription)
	if ready.Kind != FlowerLiveStreamReady || batch.FromSeq != first.Seq || batch.ThroughSeq != second.Seq {
		t.Fatalf("frames=%#v/%#v, want ready then contiguous batch %d..%d", ready, batch, first.Seq, second.Seq)
	}
}

func TestFlowerLiveStreamAdmissionAndSlowObserverIsolation(t *testing.T) {
	t.Parallel()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_stream_admission")
	threadID := "thread_live_stream_admission"
	subscriptions := make([]*FlowerLiveStreamSubscription, 0, flowerLiveMaxSubscribersPerEndpoint)
	for range flowerLiveMaxSubscribersPerEndpoint {
		subscription, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID})
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
	if _, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: threadID}); !errors.Is(err, ErrFlowerLiveTooManySubscribers) {
		t.Fatalf("257th observer error=%v, want admission error", err)
	}

	fast := subscriptions[0]
	slow := subscriptions[1]
	_ = nextFlowerLiveStreamFrame(t, fast)
	_ = nextFlowerLiveStreamFrame(t, slow)
	for index := range flowerLiveSubscriberBatchLimit + 1 {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta,
			Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{MessageID: "message_1", Delta: string(rune('a' + index%26))}),
		})
		_ = nextFlowerLiveStreamFrame(t, fast)
	}

	seenResync := false
	for range flowerLiveSubscriberBatchLimit + 2 {
		frame, err := slow.Next(context.Background())
		if err != nil {
			break
		}
		if frame.Kind == FlowerLiveStreamResyncRequired {
			seenResync = true
			break
		}
	}
	if !seenResync {
		t.Fatal("slow observer was not terminated with resync_required")
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
	if _, err := svc.SubscribeFlowerLiveStream(context.Background(), &meta, FlowerLiveStreamRequest{ThreadID: "thread_denied"}); !errors.Is(err, errReadPermissionDenied) {
		t.Fatalf("subscribe error=%v, want read permission denied", err)
	}
}
