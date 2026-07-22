package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

var flowerLiveEventsListSink *FlowerLiveEventsResponse

func TestListFlowerThreadLiveEventsAllocatesOnlyForMatchingEvents(t *testing.T) {
	t.Parallel()

	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_alloc")
	threadID := "thread_live_alloc"
	for index := range 501 {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: meta.EndpointID,
			ThreadID:   threadID,
			Kind:       FlowerLiveMessageBlockDelta,
			Payload:    mustFlowerPayload(map[string]int{"index": index}),
		})
	}

	empty, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 501, 500)
	if err != nil {
		t.Fatalf("list empty cursor: %v", err)
	}
	if empty.Events == nil || len(empty.Events) != 0 || cap(empty.Events) != 0 {
		t.Fatalf("empty events len/cap=%d/%d nil=%v, want 0/0/non-nil", len(empty.Events), cap(empty.Events), empty.Events == nil)
	}

	for _, batch := range []int{100, 500} {
		resp, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, batch)
		if err != nil {
			t.Fatalf("list batch %d: %v", batch, err)
		}
		if len(resp.Events) != batch || cap(resp.Events) != batch {
			t.Fatalf("batch %d len/cap=%d/%d, want %d/%d", batch, len(resp.Events), cap(resp.Events), batch, batch)
		}
		if !resp.HasMore || resp.NextCursor != int64(batch) {
			t.Fatalf("batch %d has_more/cursor=%v/%d", batch, resp.HasMore, resp.NextCursor)
		}
		for index, event := range resp.Events {
			if event.Seq != int64(index+1) {
				t.Fatalf("batch %d event %d seq=%d", batch, index, event.Seq)
			}
		}
	}

	first, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	first.Events[0].Payload[0] = '!'
	again, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(string(again.Events[0].Payload), "!") {
		t.Fatal("returned payload aliases the retained live stream")
	}
}

func TestFlowerLiveRetireFenceIsEndpointScoped(t *testing.T) {
	t.Parallel()

	svc := newFlowerLiveMemoryTestService()
	threadID := "shared_thread_id"
	metaA := flowerLiveMemoryTestMeta("env_retired_a")
	metaB := flowerLiveMemoryTestMeta("env_retired_b")
	for _, meta := range []session.Meta{metaA, metaB} {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: meta.EndpointID,
			ThreadID:   threadID,
			Kind:       FlowerLiveMessageBlockDelta,
			Payload:    mustFlowerPayload(map[string]string{"endpoint": meta.EndpointID, "retained": "private"}),
		})
	}

	svc.retireFlowerLiveThread(metaA.EndpointID, threadID)
	dropped, accepted := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: metaA.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"late": "event"}),
	})
	if accepted || dropped.Seq != 0 {
		t.Fatalf("retired append accepted/seq=%v/%d, want false/0", accepted, dropped.Seq)
	}
	if cursor, err := svc.appendFlowerLiveEventCursor(FlowerLiveEvent{
		EndpointID: metaA.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"late": "cursor_event"}),
	}); cursor != 0 || !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("retired append cursor/error=%d/%v, want 0/conflict", cursor, err)
	}

	aInitial, err := svc.ListFlowerThreadLiveEvents(context.Background(), &metaA, threadID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if aInitial.Events == nil || len(aInitial.Events) != 0 || cap(aInitial.Events) != 0 {
		t.Fatalf("retired initial events=%#v len/cap=%d/%d", aInitial.Events, len(aInitial.Events), cap(aInitial.Events))
	}
	aResume, err := svc.ListFlowerThreadLiveEvents(context.Background(), &metaA, threadID, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(aResume.Events) != 1 || aResume.Events[0].Kind != FlowerLiveResyncRequired || strings.Contains(string(aResume.Events[0].Payload), "private") {
		t.Fatalf("retired resume events=%#v, want payload-free resync", aResume.Events)
	}

	appendedB, accepted := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: metaB.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"endpoint": metaB.EndpointID, "next": "event"}),
	})
	if !accepted || appendedB.Seq != 2 {
		t.Fatalf("endpoint B append accepted/seq=%v/%d, want true/2", accepted, appendedB.Seq)
	}
	bResp, err := svc.ListFlowerThreadLiveEvents(context.Background(), &metaB, threadID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(bResp.Events) != 2 || bResp.NextCursor != 2 {
		t.Fatalf("endpoint B events/cursor=%d/%d, want 2/2", len(bResp.Events), bResp.NextCursor)
	}
}

func TestFlowerLiveRetireFenceLinearizesBlockedList(t *testing.T) {
	t.Parallel()

	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_retire_linearized")
	threadID := "thread_retire_linearized"
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"retained": "event"}),
	})

	threadKey := runThreadKey(meta.EndpointID, threadID)
	svc.mu.Lock()
	resultCh := make(chan *FlowerLiveEventsResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 10)
		resultCh <- resp
		errCh <- err
	}()
	svc.retireFlowerLiveThreadLocked(threadKey)
	svc.mu.Unlock()
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
	if resp := <-resultCh; resp == nil || len(resp.Events) != 0 {
		t.Fatalf("blocked list response=%#v, want empty after retirement linearized first", resp)
	}

	if _, ok := svc.flowerLiveByThread[threadKey]; ok {
		t.Fatal("retired stream was recreated")
	}
}

func TestFlowerLiveRetireFenceAllowsAlreadyDetachedResponse(t *testing.T) {
	t.Parallel()

	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_retire_detached")
	threadID := "thread_retire_detached"
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   threadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"retained": "before_retire"}),
	})
	before, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	svc.retireFlowerLiveThread(meta.EndpointID, threadID)
	if len(before.Events) != 1 || !strings.Contains(string(before.Events[0].Payload), "before_retire") {
		t.Fatalf("pre-retirement detached response=%#v", before.Events)
	}
	after, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Events) != 0 {
		t.Fatalf("post-retirement events=%#v, want empty", after.Events)
	}
}

func TestThreadDeleteRetiresFlowerLiveBeforeFloretDelete(t *testing.T) {
	stateDir := t.TempDir()
	service := newThreadDeleteTestService(t, stateDir, nil, &recordingFlowerReadStateCleaner{})
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_live_fence", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "delete live fence", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	service.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   thread.ThreadID,
		Kind:       FlowerLiveMessageBlockDelta,
		Payload:    mustFlowerPayload(map[string]string{"retained": "event"}),
	})
	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	service.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(context.Context, flruntime.ThreadID) error {
		service.mu.Lock()
		defer service.mu.Unlock()
		if _, retired := service.flowerLiveRetired[threadKey]; !retired {
			return errors.New("live stream was not retired before Floret delete")
		}
		if _, exists := service.flowerLiveByThread[threadKey]; exists {
			return errors.New("retained live stream still exists before Floret delete")
		}
		return nil
	})}

	result, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false)
	if err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if result.Status != ThreadDeleteStatusCommitted {
		t.Fatalf("delete result=%+v", result)
	}
}

func TestReplayInvalidThreadDeleteSnapshotDoesNotRetireFlowerLive(t *testing.T) {
	stateDir := t.TempDir()
	service := newThreadDeleteTestService(t, stateDir, &recordingThreadDeleteHost{}, &recordingFlowerReadStateCleaner{})
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_invalid_delete_live", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "invalid delete live", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	service.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, Kind: FlowerLiveMessageBlockDelta, Payload: jsonPayloadForMemoryTest("retained")})
	operation, err := service.threadsDB.PrepareThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID, true)
	if err != nil {
		t.Fatal(err)
	}
	operation.SnapshotValid = false
	operation.SnapshotErrorCode = "invalid_snapshot_json"
	if _, err := service.replayThreadDeleteOperation(context.Background(), operation); !errors.Is(err, ErrThreadDeleteOperationFailed) {
		t.Fatalf("replay invalid snapshot error=%v", err)
	}
	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	service.mu.Lock()
	_, retained := service.flowerLiveByThread[threadKey]
	_, retired := service.flowerLiveRetired[threadKey]
	service.mu.Unlock()
	if !retained || retired {
		t.Fatalf("invalid delete retained/retired=%v/%v, want true/false", retained, retired)
	}
}

func TestFlowerLiveRetireFenceConcurrentAccess(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_retire_race")
	threadID := "thread_retire_race"
	var workers sync.WaitGroup
	start := make(chan struct{})
	stop := make(chan struct{})
	appendReady := make(chan struct{})
	listReady := make(chan struct{})
	appendAfterRetire := make(chan struct{})
	listAfterRetire := make(chan struct{})
	retired := make(chan struct{})
	workers.Add(2)
	go func() {
		defer workers.Done()
		<-start
		ready := false
		postRetire := false
		for index := 0; ; index++ {
			select {
			case <-stop:
				return
			default:
				svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta, Payload: jsonPayloadForMemoryTest(fmt.Sprintf("event-%d", index))})
			}
			if !ready {
				close(appendReady)
				ready = true
			}
			if !postRetire {
				select {
				case <-retired:
					close(appendAfterRetire)
					postRetire = true
				default:
				}
			}
		}
	}()
	go func() {
		defer workers.Done()
		<-start
		ready := false
		postRetire := false
		for {
			select {
			case <-stop:
				return
			default:
				_, _ = svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 10)
			}
			if !ready {
				close(listReady)
				ready = true
			}
			if !postRetire {
				select {
				case <-retired:
					close(listAfterRetire)
					postRetire = true
				default:
				}
			}
		}
	}()
	close(start)
	<-appendReady
	<-listReady
	go func() {
		svc.retireFlowerLiveThread(meta.EndpointID, threadID)
		close(retired)
	}()
	<-appendAfterRetire
	<-listAfterRetire
	close(stop)
	workers.Wait()
	after, err := svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Events) != 0 {
		t.Fatalf("events after concurrent retirement=%d, want 0", len(after.Events))
	}
}

func BenchmarkListFlowerLiveEventsAllocations(b *testing.B) {
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_live_benchmark")
	threadID := "thread_live_benchmark"
	for index := range 500 {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: meta.EndpointID,
			ThreadID:   threadID,
			Kind:       FlowerLiveMessageBlockDelta,
			Payload:    jsonPayloadForMemoryTest(fmt.Sprintf("event-%d", index)),
		})
	}
	for _, benchmark := range []struct {
		name     string
		afterSeq int64
		limit    int
	}{
		{name: "empty_limit_1", afterSeq: 500, limit: 1},
		{name: "empty_limit_500", afterSeq: 500, limit: 500},
		{name: "batch_100", limit: 100},
		{name: "batch_500", limit: 500},
	} {
		b.Run(benchmark.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				flowerLiveEventsListSink, _ = svc.ListFlowerThreadLiveEvents(context.Background(), &meta, threadID, benchmark.afterSeq, benchmark.limit)
			}
		})
	}
}

func newFlowerLiveMemoryTestService() *Service {
	return &Service{
		flowerLiveByThread:   make(map[string]*flowerLiveThreadStream),
		flowerLiveRetired:    make(map[string]struct{}),
		flowerLiveGeneration: 1,
	}
}

func flowerLiveMemoryTestMeta(endpointID string) session.Meta {
	return session.Meta{EndpointID: endpointID, CanRead: true, CanWrite: true, CanExecute: true}
}

func jsonPayloadForMemoryTest(value string) []byte {
	return []byte(fmt.Sprintf(`{"value":%q}`, value))
}
