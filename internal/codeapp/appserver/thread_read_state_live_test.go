package appserver

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

var (
	flowerLiveEventsResponseSink *ai.FlowerLiveEventsResponse
	flowerLiveEventsErrorSink    error
)

func TestDecorateAIFlowerLiveEventsReadStatusSkipsNonPatchResponses(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name   string
		events []ai.FlowerLiveEvent
	}{
		{name: "empty", events: []ai.FlowerLiveEvent{}},
		{
			name: "delta",
			events: []ai.FlowerLiveEvent{{
				Kind:    ai.FlowerLiveMessageBlockDelta,
				Payload: json.RawMessage(`{"delta":"next"}`),
			}},
		},
		{
			name: "resync",
			events: []ai.FlowerLiveEvent{{
				Kind:    ai.FlowerLiveResyncRequired,
				Payload: json.RawMessage(`{"reason":"cursor_expired"}`),
			}},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			resp := &ai.FlowerLiveEventsResponse{Events: testCase.events}
			loads := 0
			got, err := decorateAIFlowerLiveEventsReadStatus(resp, func() (ai.FlowerThreadReadView, error) {
				loads++
				return ai.FlowerThreadReadView{}, nil
			})
			if err != nil {
				t.Fatalf("decorate live events: %v", err)
			}
			if got != resp {
				t.Fatalf("response pointer changed for %s fast path", testCase.name)
			}
			if loads != 0 {
				t.Fatalf("read-status loads=%d, want 0", loads)
			}
		})
	}
}

func TestDecorateAIFlowerLiveEventsReadStatusLoadsOnceForMultiplePatches(t *testing.T) {
	t.Parallel()

	firstPayload := mustTestAIFlowerPayload(t, ai.FlowerLiveThreadPatchedPayload{
		Patch: ai.FlowerLiveThreadPatch{ThreadID: "thread_patch", Title: "first"},
	})
	secondPayload := mustTestAIFlowerPayload(t, ai.FlowerLiveThreadPatchedPayload{
		Patch: ai.FlowerLiveThreadPatch{ThreadID: "thread_patch", Title: "second"},
	})
	deltaPayload := json.RawMessage(`{"delta":"unchanged"}`)
	resp := &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{
		{Kind: ai.FlowerLiveThreadPatched, Payload: firstPayload},
		{Kind: ai.FlowerLiveMessageBlockDelta, Payload: deltaPayload},
		{Kind: ai.FlowerLiveThreadPatched, Payload: secondPayload},
	}}
	wantStatus := ai.FlowerThreadReadView{
		IsUnread: true,
		Snapshot: ai.FlowerThreadReadSnapshot{
			ActivityRevision:  42,
			ActivitySignature: "thread_patch:42",
		},
	}
	loads := 0
	got, err := decorateAIFlowerLiveEventsReadStatus(resp, func() (ai.FlowerThreadReadView, error) {
		loads++
		return wantStatus, nil
	})
	if err != nil {
		t.Fatalf("decorate live events: %v", err)
	}
	if loads != 1 {
		t.Fatalf("read-status loads=%d, want 1", loads)
	}
	if got == resp {
		t.Fatal("patch response was not copied")
	}
	if string(resp.Events[0].Payload) != string(firstPayload) || string(resp.Events[2].Payload) != string(secondPayload) {
		t.Fatal("input patch payload was mutated")
	}
	if string(got.Events[1].Payload) != string(deltaPayload) {
		t.Fatalf("non-patch payload=%s, want %s", got.Events[1].Payload, deltaPayload)
	}
	for _, index := range []int{0, 2} {
		var payload ai.FlowerLiveThreadPatchedPayload
		if err := json.Unmarshal(got.Events[index].Payload, &payload); err != nil {
			t.Fatalf("decode patch %d: %v", index, err)
		}
		if payload.Patch.ReadStatus == nil || *payload.Patch.ReadStatus != wantStatus {
			t.Fatalf("patch %d read_status=%#v, want %#v", index, payload.Patch.ReadStatus, wantStatus)
		}
	}
}

func TestDecorateAIFlowerLiveEventsReadStatusPreservesMalformedPatch(t *testing.T) {
	t.Parallel()

	malformed := json.RawMessage(`{"patch":`)
	resp := &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{Kind: ai.FlowerLiveThreadPatched, Payload: malformed}}}
	loads := 0
	got, err := decorateAIFlowerLiveEventsReadStatus(resp, func() (ai.FlowerThreadReadView, error) {
		loads++
		return ai.FlowerThreadReadView{}, nil
	})
	if err != nil {
		t.Fatalf("decorate malformed patch: %v", err)
	}
	if loads != 1 {
		t.Fatalf("read-status loads=%d, want 1", loads)
	}
	if string(got.Events[0].Payload) != string(malformed) {
		t.Fatalf("malformed payload=%s, want %s", got.Events[0].Payload, malformed)
	}
}

func TestDecorateAIFlowerLiveEventsReadStatusPropagatesLoaderError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("read status unavailable")
	resp := &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{Kind: ai.FlowerLiveThreadPatched, Payload: json.RawMessage(`{}`)}}}
	got, err := decorateAIFlowerLiveEventsReadStatus(resp, func() (ai.FlowerThreadReadView, error) {
		return ai.FlowerThreadReadView{}, wantErr
	})
	if got != nil || !errors.Is(err, wantErr) {
		t.Fatalf("result=%#v error=%v, want nil/%v", got, err, wantErr)
	}
}

func TestDecorateAIFlowerLiveEventsReadStatusFastPathAllocations(t *testing.T) {
	for _, testCase := range []struct {
		name string
		resp *ai.FlowerLiveEventsResponse
	}{
		{
			name: "empty",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{}},
		},
		{
			name: "delta",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{
				Kind: ai.FlowerLiveMessageBlockDelta,
			}}},
		},
		{
			name: "resync",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{
				Kind: ai.FlowerLiveResyncRequired,
			}}},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			allocs := testing.AllocsPerRun(1000, func() {
				flowerLiveEventsResponseSink, flowerLiveEventsErrorSink = decorateAIFlowerLiveEventsReadStatus(testCase.resp, unexpectedFlowerLiveReadStatusLoad)
			})
			if allocs != 0 {
				t.Fatalf("allocs=%v, want 0", allocs)
			}
		})
	}
}

func BenchmarkDecorateAIFlowerLiveEventsReadStatusFastPath(b *testing.B) {
	for _, benchmark := range []struct {
		name string
		resp *ai.FlowerLiveEventsResponse
	}{
		{
			name: "empty",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{}},
		},
		{
			name: "delta",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{
				Kind: ai.FlowerLiveMessageBlockDelta,
			}}},
		},
		{
			name: "resync",
			resp: &ai.FlowerLiveEventsResponse{Events: []ai.FlowerLiveEvent{{
				Kind: ai.FlowerLiveResyncRequired,
			}}},
		},
	} {
		b.Run(benchmark.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				flowerLiveEventsResponseSink, flowerLiveEventsErrorSink = decorateAIFlowerLiveEventsReadStatus(benchmark.resp, unexpectedFlowerLiveReadStatusLoad)
			}
		})
	}
}

func unexpectedFlowerLiveReadStatusLoad() (ai.FlowerThreadReadView, error) {
	panic("read-status loader called on non-patch response")
}

func mustTestAIFlowerPayload(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal Flower payload: %v", err)
	}
	return raw
}
