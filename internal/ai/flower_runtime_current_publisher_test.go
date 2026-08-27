package ai

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/floret/v5/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type fakeFlowerRuntimePublishTimer struct {
	clock  *fakeFlowerRuntimePublishClock
	at     time.Time
	fn     func()
	active bool
}

func (timer *fakeFlowerRuntimePublishTimer) Stop() bool {
	timer.clock.mu.Lock()
	defer timer.clock.mu.Unlock()
	wasActive := timer.active
	timer.active = false
	return wasActive
}

type fakeFlowerRuntimePublishClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeFlowerRuntimePublishTimer
}

func newFakeFlowerRuntimePublishClock() *fakeFlowerRuntimePublishClock {
	return &fakeFlowerRuntimePublishClock{now: time.Unix(1_700_000_000, 0)}
}

func (clock *fakeFlowerRuntimePublishClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *fakeFlowerRuntimePublishClock) AfterFunc(delay time.Duration, fn func()) flowerRuntimePublishTimer {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	timer := &fakeFlowerRuntimePublishTimer{clock: clock, at: clock.now.Add(delay), fn: fn, active: true}
	clock.timers = append(clock.timers, timer)
	return timer
}

func (clock *fakeFlowerRuntimePublishClock) Advance(elapsed time.Duration) {
	clock.mu.Lock()
	clock.now = clock.now.Add(elapsed)
	clock.mu.Unlock()
	for {
		clock.mu.Lock()
		var due *fakeFlowerRuntimePublishTimer
		for _, timer := range clock.timers {
			if timer.active && !timer.at.After(clock.now) && (due == nil || timer.at.Before(due.at)) {
				due = timer
			}
		}
		if due == nil {
			clock.mu.Unlock()
			return
		}
		due.active = false
		clock.mu.Unlock()
		due.fn()
	}
}

type recordedFlowerRuntimeCurrent struct {
	endpointID string
	current    flruntime.ThreadView
}

func thinkingCurrent(version uint64, text string, live bool, activity flruntime.ThreadActivity) flruntime.ThreadView {
	return flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread-thinking"),
		ViewVersion: version,
		Activity:    activity,
		TurnID:      identity.TurnID("turn-thinking"),
		Items: []flruntime.ThreadItem{{
			ID: "thinking-1", TurnID: identity.TurnID("turn-thinking"), Ordinal: 2,
			Kind: flruntime.ThreadItemThinking, Text: text, Live: live,
		}},
	}
}

func TestFlowerRuntimeCurrentPublisherStreamsThinkingAtVisualCadence(t *testing.T) {
	clock := newFakeFlowerRuntimePublishClock()
	var published []recordedFlowerRuntimeCurrent
	publisher := newFlowerRuntimeCurrentPublisher(50*time.Millisecond, clock, func(endpointID string, current flruntime.ThreadView) {
		published = append(published, recordedFlowerRuntimeCurrent{endpointID: endpointID, current: current})
	})
	var metrics flowerLiveMetrics
	publisher.metrics = &metrics
	t.Cleanup(publisher.Close)

	publisher.Publish("env-local", thinkingCurrent(1, "", true, flruntime.ThreadActivityActive))
	publisher.Publish("env-local", thinkingCurrent(2, "first", true, flruntime.ThreadActivityActive))
	if got := publishedVersions(published); !equalUint64s(got, []uint64{1, 2}) {
		t.Fatalf("initial and first non-empty thinking versions = %v, want [1 2]", got)
	}

	publisher.Publish("env-local", thinkingCurrent(3, "first second", true, flruntime.ThreadActivityActive))
	publisher.Publish("env-local", thinkingCurrent(4, "first second third", true, flruntime.ThreadActivityActive))
	if got := publishedVersions(published); !equalUint64s(got, []uint64{1, 2}) {
		t.Fatalf("text-only burst published before cadence: %v", got)
	}
	clock.Advance(49 * time.Millisecond)
	if len(published) != 2 {
		t.Fatalf("published %d views before cadence elapsed, want 2", len(published))
	}
	clock.Advance(time.Millisecond)
	if got := publishedVersions(published); !equalUint64s(got, []uint64{1, 2, 4}) {
		t.Fatalf("cadenced versions = %v, want [1 2 4]", got)
	}

	clock.Advance(10 * time.Millisecond)
	publisher.Publish("env-local", thinkingCurrent(5, "first second third fourth", true, flruntime.ThreadActivityActive))
	completed := thinkingCurrent(6, "first second third fourth", false, flruntime.ThreadActivityIdle)
	outcome := flruntime.TurnOutcomeCompleted
	completed.LastOutcome = &outcome
	publisher.Publish("env-local", completed)
	if got := publishedVersions(published); !equalUint64s(got, []uint64{1, 2, 4, 6}) {
		t.Fatalf("terminal versions = %v, want [1 2 4 6]", got)
	}
	clock.Advance(time.Second)
	if len(published) != 4 {
		t.Fatalf("stale timer published after terminal boundary: %v", publishedVersions(published))
	}
	snapshot := metrics.snapshot()
	if snapshot.RuntimeCurrentsReceived != 6 || snapshot.RuntimeCurrentsPublished != 4 || snapshot.RuntimeCurrentsCoalesced != 2 {
		t.Fatalf("runtime publication metrics = %#v", snapshot)
	}
	if snapshot.FirstThinkingPublishSamples != 1 || snapshot.MaxRuntimeCurrentPublishGapNanos != uint64(50*time.Millisecond) {
		t.Fatalf("thinking latency or cadence metrics = %#v", snapshot)
	}
}

func TestFlowerRuntimeCurrentPublisherPublishesSustainedThinkingBeforeCompletion(t *testing.T) {
	clock := newFakeFlowerRuntimePublishClock()
	var published []recordedFlowerRuntimeCurrent
	publisher := newFlowerRuntimeCurrentPublisher(50*time.Millisecond, clock, func(endpointID string, current flruntime.ThreadView) {
		published = append(published, recordedFlowerRuntimeCurrent{endpointID: endpointID, current: current})
	})
	t.Cleanup(publisher.Close)

	publisher.Publish("env-local", thinkingCurrent(1, "first", true, flruntime.ThreadActivityActive))
	for version, text := range []string{
		"first second",
		"first second third",
		"first second third fourth",
	} {
		clock.Advance(10 * time.Millisecond)
		publisher.Publish("env-local", thinkingCurrent(uint64(version+2), text, true, flruntime.ThreadActivityActive))
		clock.Advance(40 * time.Millisecond)
	}

	if got := publishedVersions(published); !equalUint64s(got, []uint64{1, 2, 3, 4}) {
		t.Fatalf("sustained thinking versions before completion = %v, want [1 2 3 4]", got)
	}
	for _, publication := range published {
		if publication.current.Activity != flruntime.ThreadActivityActive || !publication.current.Items[0].Live {
			t.Fatalf("published terminal state before provider completion: %#v", publication.current)
		}
	}
}

func TestFlowerRuntimeCurrentPublisherFlushesToolStateBoundaryAndRejectsStaleViews(t *testing.T) {
	clock := newFakeFlowerRuntimePublishClock()
	var published []recordedFlowerRuntimeCurrent
	publisher := newFlowerRuntimeCurrentPublisher(50*time.Millisecond, clock, func(endpointID string, current flruntime.ThreadView) {
		published = append(published, recordedFlowerRuntimeCurrent{endpointID: endpointID, current: current})
	})
	t.Cleanup(publisher.Close)

	running := toolCurrent(10, observation.ActivityStatusRunning)
	publisher.Publish("env-local", running)
	growing := toolCurrent(11, observation.ActivityStatusRunning)
	growing.Items[0].Activity.Presentation.Description = "more output"
	publisher.Publish("env-local", growing)
	settled := toolCurrent(12, observation.ActivityStatusSuccess)
	publisher.Publish("env-local", settled)
	publisher.Publish("env-local", toolCurrent(11, observation.ActivityStatusError))

	if got := publishedVersions(published); !equalUint64s(got, []uint64{10, 12}) {
		t.Fatalf("tool boundary versions = %v, want [10 12]", got)
	}
	clock.Advance(time.Second)
	if len(published) != 2 {
		t.Fatalf("pending or stale tool view published after boundary: %v", publishedVersions(published))
	}
}

func TestFlowerRuntimeCurrentPublisherSerializesConcurrentBoundaryDelivery(t *testing.T) {
	clock := newFakeFlowerRuntimePublishClock()
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var publishedMu sync.Mutex
	var published []recordedFlowerRuntimeCurrent
	publisher := newFlowerRuntimeCurrentPublisher(50*time.Millisecond, clock, func(endpointID string, current flruntime.ThreadView) {
		if current.ViewVersion == 1 {
			close(firstStarted)
			<-releaseFirst
		}
		publishedMu.Lock()
		published = append(published, recordedFlowerRuntimeCurrent{endpointID: endpointID, current: current})
		publishedMu.Unlock()
	})
	t.Cleanup(publisher.Close)

	firstDone := make(chan struct{})
	go func() {
		publisher.Publish("env-local", thinkingCurrent(1, "", true, flruntime.ThreadActivityActive))
		close(firstDone)
	}()
	select {
	case <-firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first publication did not start")
	}

	secondDone := make(chan struct{})
	go func() {
		publisher.Publish("env-local", thinkingCurrent(2, "first", true, flruntime.ThreadActivityActive))
		close(secondDone)
	}()
	waitForFlowerRuntimePublisherVersion(t, publisher, "thread-thinking", 2)
	thirdDone := make(chan struct{})
	go func() {
		terminal := thinkingCurrent(3, "first", false, flruntime.ThreadActivityIdle)
		outcome := flruntime.TurnOutcomeCompleted
		terminal.LastOutcome = &outcome
		publisher.Publish("env-local", terminal)
		close(thirdDone)
	}()
	waitForFlowerRuntimePublisherVersion(t, publisher, "thread-thinking", 3)
	close(releaseFirst)

	for _, done := range []<-chan struct{}{firstDone, secondDone, thirdDone} {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("publication did not finish")
		}
	}
	publishedMu.Lock()
	got := publishedVersions(published)
	publishedMu.Unlock()
	if !equalUint64s(got, []uint64{1, 3}) {
		t.Fatalf("serialized versions = %v, want [1 3]", got)
	}
}

func waitForFlowerRuntimePublisherVersion(
	t *testing.T,
	publisher *flowerRuntimeCurrentPublisher,
	threadID string,
	want uint64,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		publisher.mu.Lock()
		state := publisher.states[threadID]
		got := uint64(0)
		if state != nil {
			got = state.publishedVersion
		}
		publisher.mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("publisher version did not reach %d", want)
}

func TestResolveFlowerRuntimeEndpointLoadsImmutableRouteOnce(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("open thread store: %v", err)
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: "thread-route", EndpointID: "env-route", PermissionType: "approval_required",
	}); err != nil {
		t.Fatalf("create thread settings: %v", err)
	}
	service := &Service{
		threadsDB:                     store,
		flowerRuntimeEndpointByThread: make(map[string]string),
	}
	endpointID, err := service.resolveFlowerRuntimeEndpoint(context.Background(), "thread-route")
	if err != nil || endpointID != "env-route" {
		t.Fatalf("initial endpoint resolution = %q, %v", endpointID, err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close thread store: %v", err)
	}
	endpointID, err = service.resolveFlowerRuntimeEndpoint(context.Background(), "thread-route")
	if err != nil || endpointID != "env-route" {
		t.Fatalf("cached endpoint resolution = %q, %v", endpointID, err)
	}
	if err := service.rememberFlowerRuntimeEndpoint("thread-route", "env-other"); err != errFlowerRuntimeEndpointConflict {
		t.Fatalf("conflicting endpoint error = %v, want %v", err, errFlowerRuntimeEndpointConflict)
	}
	service.forgetFlowerRuntimeThread("thread-route")
	if _, err := service.resolveFlowerRuntimeEndpoint(context.Background(), "thread-route"); err == nil {
		t.Fatal("endpoint resolved after route removal with closed store")
	}
}

func toolCurrent(version uint64, status observation.ActivityStatus) flruntime.ThreadView {
	return flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-tool"), ViewVersion: version,
		Activity: flruntime.ThreadActivityActive, TurnID: identity.TurnID("turn-tool"),
		Items: []flruntime.ThreadItem{{
			ID: "tool-1", TurnID: identity.TurnID("turn-tool"), Ordinal: 2, Kind: flruntime.ThreadItemTool,
			Activity: &observation.ActivityItem{
				ItemID: "tool-1", ToolID: "call-1", ToolName: "terminal.exec",
				Kind: observation.ActivityKindTool, Status: status,
				Presentation: &tools.ActivityPresentation{Description: "output"},
			},
		}},
	}
}

func publishedVersions(values []recordedFlowerRuntimeCurrent) []uint64 {
	versions := make([]uint64, 0, len(values))
	for _, value := range values {
		versions = append(versions, value.current.ViewVersion)
	}
	return versions
}

func equalUint64s(left []uint64, right []uint64) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
