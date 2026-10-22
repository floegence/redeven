package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func largeFlowerLiveCurrent() flruntime.ThreadView {
	current := flruntime.ThreadView{
		ThreadID: "thread-large-history", TurnID: "turn-active", RunID: "run-active",
		ViewVersion: 1, Activity: flruntime.ThreadActivityActive,
	}
	for index := range 394 {
		current.Items = append(current.Items, flruntime.ThreadItem{
			ID: fmt.Sprintf("history-%d", index), TurnID: identity.TurnID(fmt.Sprintf("turn-%d", index)),
			RunID: identity.RunID(fmt.Sprintf("run-%d", index)), Ordinal: uint64(index + 1),
			Kind: flruntime.ThreadItemThinking, Text: strings.Repeat("historical text ", 240),
		})
	}
	current.Items = append(current.Items, flruntime.ThreadItem{
		ID: "thinking-active", TurnID: current.TurnID, RunID: current.RunID,
		Ordinal: 395, Kind: flruntime.ThreadItemThinking, Text: "first", Live: true,
	})
	return current
}

func subscribeFlowerFragmentTest(t *testing.T) (*Service, *FlowerLiveStreamSubscription) {
	t.Helper()
	svc := newFlowerLiveMemoryTestService()
	meta := flowerLiveMemoryTestMeta("env-fragment")
	subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Close)
	nextFlowerLiveStreamFrame(t, subscription)
	return svc, subscription
}

func enqueueFlowerFragmentTest(t *testing.T, svc *Service, sub *FlowerLiveStreamSubscription, batch *flowerLiveEncodedBatch) {
	t.Helper()
	svc.mu.Lock()
	accepted := enqueueFlowerLiveSubscriberLocked(svc, sub.subscriber, batch)
	svc.mu.Unlock()
	if !accepted {
		t.Fatal("envelope was rejected")
	}
}

func TestFlowerLiveFragmentsPreserveCompleteLargePublicEnvelopes(t *testing.T) {
	current := largeFlowerLiveCurrent()
	terminal := current
	terminal.Activity = flruntime.ThreadActivityIdle
	terminal.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	terminal.Items[len(terminal.Items)-1].Live = false
	cases := map[string]FlowerLiveStreamEnvelope{
		"root_current":     {SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current},
		"subagent_current": {SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread-parent", SubagentCurrent: &current},
		"terminal_current": {SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &terminal},
		"large_baseline":   {SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady, Summaries: []ThreadView{{ThreadID: current.ThreadID.String(), Title: strings.Repeat("baseline ", 190000)}}},
	}
	for name, envelope := range cases {
		t.Run(name, func(t *testing.T) {
			svc, sub := subscribeFlowerFragmentTest(t)
			batch := newFlowerLiveEncodedBatch(envelope)
			if len(batch.data) < 1489792 {
				t.Fatalf("fixture bytes=%d must reproduce the reported 1.49 MB snapshot", len(batch.data))
			}
			enqueueFlowerFragmentTest(t, svc, sub, batch)
			frame := nextFlowerLiveStreamFrame(t, sub)
			if !bytes.Equal(frame.Data, batch.data) || frame.Kind != envelope.Kind {
				t.Fatal("assembled public envelope differs from the original full JSON")
			}
			if sub.subscriber.queuedBytes != 0 || svc.flowerLiveQueuedBytes != 0 || sub.subscriber.closed {
				t.Fatal("successful fragmented transfer leaked retained bytes or closed the observer")
			}
		})
	}
}

func TestFlowerLiveFragmentsPreserveLargeSingleTurnAndUTF8AcrossBoundaries(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	current := largeFlowerLiveCurrent()
	current.Items = current.Items[len(current.Items)-1:]
	// These language-sensitive bytes deliberately cross raw fragment boundaries.
	current.Items[0].Text = strings.Repeat("中文思考内容。", 70000)
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &current})
	if len(batch.data) <= 1<<20 {
		t.Fatal("single-turn fixture did not exceed the old byte limit")
	}
	enqueueFlowerFragmentTest(t, svc, sub, batch)
	frame := nextFlowerLiveStreamFrame(t, sub)
	if !bytes.Equal(frame.Data, batch.data) || !json.Valid(frame.Data) {
		t.Fatal("split UTF-8 content changed during assembly")
	}
}

func TestFlowerLiveFragmentsRetainActiveBytesAndNeverReplaceStartedEnvelope(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	before := largeFlowerLiveCurrent()
	first := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &before})
	enqueueFlowerFragmentTest(t, svc, sub, first)
	frame, err := sub.Next(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var fragment FlowerLiveStreamFragment
	if err := json.Unmarshal(frame.Data, &fragment); err != nil {
		t.Fatal(err)
	}
	if fragment.FragmentIndex != 0 || fragment.FragmentCount <= 1 || len(sub.subscriber.queue) != 0 || sub.subscriber.active != first {
		t.Fatal("Next queued all fragments instead of advancing one active envelope")
	}
	if sub.subscriber.queuedBytes != first.bytes() || svc.flowerLiveQueuedBytes != first.bytes() {
		t.Fatal("starting an envelope released its retained byte budget early")
	}
	after := before
	after.ViewVersion++
	after.Items = append([]flruntime.ThreadItem(nil), before.Items...)
	after.Items[len(after.Items)-1].Text += " second"
	second := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &after})
	enqueueFlowerFragmentTest(t, svc, sub, second)
	assembled, _ := base64.StdEncoding.DecodeString(fragment.DataBase64)
	for index := 1; index < fragment.FragmentCount; index++ {
		frame, err := sub.Next(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		var part FlowerLiveStreamFragment
		if err := json.Unmarshal(frame.Data, &part); err != nil {
			t.Fatal(err)
		}
		if part.EnvelopeID != fragment.EnvelopeID || part.FragmentIndex != index {
			t.Fatal("a newer current interleaved with an active envelope")
		}
		data, _ := base64.StdEncoding.DecodeString(part.DataBase64)
		assembled = append(assembled, data...)
	}
	if !bytes.Equal(assembled, first.data) {
		t.Fatal("an active envelope was replaced after its first fragment")
	}
	if got := nextFlowerLiveStreamFrame(t, sub); !bytes.Equal(got.Data, second.data) {
		t.Fatal("the following complete current was lost")
	}
}

func TestFlowerLiveFragmentsReleaseInitializationAndInterruptedAssemblyBytes(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	current := largeFlowerLiveCurrent()
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &current})
	svc.mu.Lock()
	sub.subscriber.initializing = true
	if !retainFlowerLiveBatchLocked(svc, sub.subscriber, batch) {
		t.Fatal("baseline retention failed")
	}
	sub.subscriber.initial = append(sub.subscriber.initial, batch)
	if !enqueueFlowerLiveSubscriberLocked(svc, sub.subscriber, batch) {
		t.Fatal("live initialization retention failed")
	}
	if sub.subscriber.queuedBytes != batch.bytes()+flowerLiveRefreshBatch(batch).bytes() || svc.flowerLiveQueuedBytes != sub.subscriber.queuedBytes {
		t.Fatal("initialization bytes were not included in the retained budget")
	}
	finalizeFlowerLiveSubscriberInitializationLocked(svc, sub.subscriber)
	svc.mu.Unlock()
	if _, err := sub.Next(t.Context()); err != nil {
		t.Fatal(err)
	}
	sub.Close()
	if sub.subscriber.queuedBytes != 0 || svc.flowerLiveQueuedBytes != 0 || sub.subscriber.active != nil || len(sub.subscriber.queue) != 0 {
		t.Fatal("disconnect retained partially sent or initialization envelopes")
	}
	if _, err := sub.Next(t.Context()); !errors.Is(err, io.EOF) {
		t.Fatalf("closed fragmented stream error=%v", err)
	}
}

func TestFlowerLiveFragmentsRejectEncodingFailureWithoutFabricatedReady(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	invalid := flruntime.ThreadView{ThreadID: "thread-invalid", Items: []flruntime.ThreadItem{{ID: "missing-execution-identities"}}}
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &invalid})
	if !errors.Is(batch.err, ErrFlowerLiveSync) || len(batch.data) != 0 {
		t.Fatal("invalid current was replaced with a fabricated ready envelope")
	}
	svc.mu.Lock()
	accepted := enqueueFlowerLiveSubscriberLocked(svc, sub.subscriber, batch)
	svc.mu.Unlock()
	if accepted {
		t.Fatal("invalid encoded envelope was accepted")
	}
	if frame, err := sub.Next(t.Context()); frame != nil || !errors.Is(err, ErrFlowerLiveSync) {
		t.Fatalf("invalid stream result=(%#v, %v), want terminal synchronization error", frame, err)
	}
}

func TestFlowerLiveFragmentsSlowObserverCannotBlockLargeCurrentProducer(t *testing.T) {
	svc, slow := subscribeFlowerFragmentTest(t)
	meta := flowerLiveMemoryTestMeta("env-fragment")
	fast, err := svc.SubscribeFlowerLiveStream(t.Context(), &meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer fast.Close()
	nextFlowerLiveStreamFrame(t, fast)
	current := largeFlowerLiveCurrent()
	for index := range flowerLiveSubscriberBatchLimit + 2 {
		current.ViewVersion = uint64(index + 1)
		current.Items[len(current.Items)-1].Text = fmt.Sprintf("semantic replacement %d", index)
		batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &current})
		svc.mu.Lock()
		enqueueFlowerLiveSubscriberLocked(svc, slow.subscriber, batch)
		accepted := enqueueFlowerLiveSubscriberLocked(svc, fast.subscriber, batch)
		svc.mu.Unlock()
		if !accepted || !bytes.Equal(nextFlowerLiveStreamFrame(t, fast).Data, batch.data) {
			t.Fatal("slow observer blocked or corrupted the draining observer")
		}
	}
	frame := nextFlowerLiveStreamFrame(t, slow)
	var latest FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &latest); err != nil || latest.Current == nil || latest.Current.ViewVersion != flowerLiveSubscriberBatchLimit+2 {
		t.Fatalf("slow semantic queue latest=%s", frame.Data)
	}
	if fast.subscriber.closed {
		t.Fatal("slow observer closed a healthy observer")
	}
}

func TestFlowerWorkspaceLargeBaselineRecoversAfterPartialDisconnect(t *testing.T) {
	// Install the scripted current before activation starts runtime observation
	// and maintenance. The service keeps its real canonical store and lifecycle.
	svc, err := NewServiceContext(t.Context(), Options{
		StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/bash", DeferExecution: true,
		Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
			ID: "openai", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Large current baseline", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	current := largeFlowerLiveCurrent()
	current.ThreadID = identity.ThreadID(thread.ThreadID)
	summaries, err := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{})
	if err != nil || len(summaries) != 1 {
		t.Fatalf("canonical summaries=%v error=%v", summaries, err)
	}
	summaries[0].Activity = flruntime.ThreadActivityActive
	runtime := &authorityContinuityRuntime{ThreadService: svc.threadRuntime}
	runtime.list = func(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) { return summaries, nil }
	runtime.view = func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return current, nil }
	svc.threadRuntime = runtime
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	first, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	nextFlowerLiveStreamFrame(t, first)
	assertFlowerViewerReadBaseline(t, first, thread.ThreadID)
	enqueueFlowerFragmentTest(t, svc, first, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread.ThreadID, Current: &current}))
	if frame, err := first.Next(t.Context()); err != nil || frame.Kind != FlowerLiveStreamThreadBatch {
		t.Fatalf("first baseline fragment=%v error=%v", frame, err)
	}
	first.Close()
	if svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("partial baseline disconnect retained bytes")
	}
	reconnected, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	if ready := nextFlowerLiveStreamFrame(t, reconnected); ready.Kind != FlowerLiveStreamReady {
		t.Fatal("reconnect did not start with ready")
	}
	assertFlowerViewerReadBaseline(t, reconnected, thread.ThreadID)
	enqueueFlowerFragmentTest(t, svc, reconnected, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread.ThreadID, Current: &current}))
	baseline := nextFlowerLiveStreamFrame(t, reconnected)
	want, err := json.Marshal(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread.ThreadID, Current: &current})
	if err != nil || len(want) < 1489792 || !bytes.Equal(baseline.Data, want) {
		t.Fatalf("complete reconnect baseline bytes=%d want=%d error=%v", len(baseline.Data), len(want), err)
	}
}

func TestFlowerLiveFragmentsAccountLatestAndActiveMediaWithoutLifecycleInterference(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	publish := func(sequence uint64) *flowerLiveEncodedBatch {
		batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerFrame,
			ComputerFrame: &FlowerComputerFrame{ThreadID: "thread-media", TargetID: "target-media", Sequence: sequence}})
		svc.mu.Lock()
		accepted := replaceFlowerLiveSubscriberMediaLocked(svc, sub.subscriber, batch)
		svc.mu.Unlock()
		if !accepted {
			t.Fatal("media frame was rejected")
		}
		return batch
	}
	first := publish(1)
	latest := publish(2)
	if sub.subscriber.mediaBytes != len(latest.data) || svc.flowerLiveQueuedBytes != len(latest.data) || sub.subscriber.queuedBytes != 0 {
		t.Fatal("replaced media retained old bytes or consumed lifecycle bytes")
	}
	if bytes.Equal(first.data, latest.data) || !bytes.Equal(nextFlowerLiveStreamFrame(t, sub).Data, latest.data) {
		t.Fatal("media replacement did not retain the latest frame")
	}
	if sub.subscriber.mediaBytes != 0 || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("consumed media retained bytes")
	}
	large := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerFrame,
		ComputerFrame: &FlowerComputerFrame{ThreadID: "thread-media", TargetID: strings.Repeat("target", 12000)}})
	svc.mu.Lock()
	if !replaceFlowerLiveSubscriberMediaLocked(svc, sub.subscriber, large) {
		t.Fatal("large media envelope was rejected")
	}
	svc.mu.Unlock()
	if _, err := sub.Next(t.Context()); err != nil {
		t.Fatal(err)
	}
	latest = publish(3)
	if sub.subscriber.mediaBytes != len(large.data)+len(latest.data) || svc.flowerLiveQueuedBytes != sub.subscriber.mediaBytes {
		t.Fatal("active and pending media did not share the retained budget")
	}
	sub.Close()
	if sub.subscriber.mediaBytes != 0 || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("closing active media retained bytes")
	}
}

func TestFlowerLiveFragmentsCarryCompleteManagedModelContext(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	snapshot := flruntime.ModelContextSnapshot{}
	for i := range 4 {
		snapshot.Sections = append(snapshot.Sections, flruntime.ModelContextSection{Key: fmt.Sprintf("section_%d", i), Title: "Runtime facts", Text: strings.Repeat("x", 64000)})
	}
	if err := snapshot.Validate(); err != nil {
		t.Fatal(err)
	}
	facts := &flruntime.ThreadModelContext{Snapshot: snapshot, EntryID: "entry-facts", PathDepth: 1, TurnID: "turn-facts", RunID: "run-facts", UpdatedAt: time.Now(), ChangedKeys: []string{"section_0", "section_1", "section_2", "section_3"}, RemovedKeys: []string{}}
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread-facts", ModelContext: facts})
	enqueueFlowerFragmentTest(t, svc, sub, batch)
	frame := nextFlowerLiveStreamFrame(t, sub)
	if !bytes.Equal(frame.Data, batch.data) || sub.subscriber.closed {
		t.Fatal("valid complete runtime facts disconnected or changed")
	}
	var received FlowerLiveStreamEnvelope
	if err := json.Unmarshal(frame.Data, &received); err != nil {
		t.Fatal(err)
	}
	if received.ModelContext == nil || len(received.ModelContext.Snapshot.Sections) != 4 || len(received.ModelContext.Snapshot.Sections[3].Text) != 64000 {
		t.Fatal("runtime facts were truncated")
	}
}
