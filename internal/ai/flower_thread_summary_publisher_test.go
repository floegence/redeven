package ai

import (
	"context"
	"errors"
	"io"
	"sync/atomic"
	"testing"
	"time"
)

func TestFlowerThreadSummaryPublisherCoalescesDirtyThreadRequests(t *testing.T) {
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondFinished := make(chan struct{})
	var calls atomic.Int32
	publisher := newFlowerThreadSummaryPublisher(
		t.Context(),
		time.Second,
		func(ctx context.Context, endpointID, threadID string) error {
			if endpointID != "env_summary" || threadID != "thread_summary" {
				t.Errorf("publication identity=(%q, %q)", endpointID, threadID)
			}
			switch calls.Add(1) {
			case 1:
				close(firstStarted)
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-releaseFirst:
				}
			case 2:
				close(secondFinished)
			}
			return nil
		},
		func(string, string, error) { t.Error("unexpected publication failure") },
	)
	t.Cleanup(publisher.Close)

	publisher.Request("env_summary", "thread_summary")
	select {
	case <-firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first canonical summary publication did not start")
	}
	publisher.Request("env_summary", "thread_summary")
	publisher.Request("env_summary", "thread_summary")
	close(releaseFirst)
	select {
	case <-secondFinished:
	case <-time.After(time.Second):
		t.Fatal("dirty canonical summary publication did not run")
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("canonical summary publications=%d, want 2", got)
	}
}

func TestFlowerThreadSummaryPublisherFailureFencesLiveObservers(t *testing.T) {
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env_summary_failure")
	subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}

	failureHandled := make(chan struct{})
	publisher := newFlowerThreadSummaryPublisher(
		t.Context(),
		time.Second,
		func(context.Context, string, string) error { return errors.New("canonical summary unavailable") },
		func(endpointID, threadID string, publishErr error) {
			if endpointID != meta.EndpointID || threadID != "thread_summary_failure" || publishErr == nil {
				t.Errorf("failure=(%q, %q, %v)", endpointID, threadID, publishErr)
			}
			svc.fenceFlowerLiveEndpoint(endpointID)
			close(failureHandled)
		},
	)
	t.Cleanup(publisher.Close)
	publisher.Request(meta.EndpointID, "thread_summary_failure")
	select {
	case <-failureHandled:
	case <-time.After(time.Second):
		t.Fatal("canonical summary failure was not handled")
	}

	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if frame, nextErr := subscription.Next(ctx); !errors.Is(nextErr, io.EOF) || frame != nil {
		t.Fatalf("fenced observer frame=%#v error=%v, want EOF", frame, nextErr)
	}
}
