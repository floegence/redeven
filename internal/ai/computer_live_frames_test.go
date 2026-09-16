package ai

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type liveFrameExecutor struct {
	calls      atomic.Int32
	body       []byte
	attachment TargetToolAttachment
}

type drainingLiveFrameExecutor struct {
	*liveFrameExecutor
	entered chan struct{}
	finish  chan struct{}
}

func (e *drainingLiveFrameExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	close(e.entered)
	select {
	case <-ctx.Done():
		return TargetToolResult{}, ctx.Err()
	case <-e.finish:
		return e.liveFrameExecutor.ExecuteTargetTool(ctx, call)
	}
}

func TestComputerViewerCloseDrainsCaptureWithoutCancelingTargetSession(t *testing.T) {
	executor := &drainingLiveFrameExecutor{liveFrameExecutor: newLiveFrameExecutor(t), entered: make(chan struct{}), finish: make(chan struct{})}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	acquireLiveFrameTestTarget(t, runtime, "thread")
	var published atomic.Int32
	stop, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread", ObserverID: "viewer", TargetID: "target", Revision: 1}}, func(FlowerComputerFrame) { published.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		close(executor.finish)
		stop()
		if published.Load() != 0 {
			t.Error("a closed viewer published a late frame")
		}
	}()
	<-executor.entered
	stopped := make(chan struct{})
	go func() { stop(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("closing the viewer canceled the helper's in-flight capture")
	case <-time.After(50 * time.Millisecond):
	}
}

func newLiveFrameExecutor(t *testing.T) *liveFrameExecutor {
	body, attachment := computerFrameFixture(t)
	return &liveFrameExecutor{body: body, attachment: attachment}
}

func (e *liveFrameExecutor) ExecuteTargetTool(context.Context, TargetToolCall) (TargetToolResult, error) {
	n := e.calls.Add(1)
	return TargetToolResult{frameBytes: e.body, Attachments: []TargetToolAttachment{e.attachment}, Result: n}, nil
}

func TestComputerLiveFramesPublishesAndStops(t *testing.T) {
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", Ready: true, State: "ready"}); err != nil {
		t.Fatal(err)
	}
	executor := newLiveFrameExecutor(t)
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	acquireLiveFrameTestTarget(t, runtime, "thread")
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	var frames atomic.Int32
	stop, err := runtime.startComputerLiveFrames(ctx, computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread", ObserverID: "session", TargetID: "target", Revision: 1}}, func(FlowerComputerFrame) { frames.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(380 * time.Millisecond)
	stop()
	count := frames.Load()
	if count < 1 {
		t.Fatalf("frames=%d, want at least one", count)
	}
	before := executor.calls.Load()
	time.Sleep(400 * time.Millisecond)
	if executor.calls.Load() != before {
		t.Fatal("sampler continued after stop")
	}
}

func TestComputerLiveFramesOldStopCannotCancelReplacement(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": newLiveFrameExecutor(t)}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	acquireLiveFrameTestTarget(t, runtime, "thread")
	stop, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread", ObserverID: "session", TargetID: "target", Revision: 1}}, func(FlowerComputerFrame) {})
	if err != nil {
		t.Fatal(err)
	}
	stop()
	var frames atomic.Int32
	replacement, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread", ObserverID: "session", TargetID: "target", Revision: 1}}, func(frame FlowerComputerFrame) {
		frames.Add(1)
		_, _ = runtime.ResolveComputerLiveFrame(t.Context(), "thread", "target", frame.ResourceRef)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer replacement()
	stop()
	time.Sleep(2 * computerLiveFrameInterval)
	if frames.Load() < 2 {
		t.Fatal("stale stop cancelled replacement sampler")
	}
}

func TestComputerLiveFramesRejectClosedRuntime(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": newLiveFrameExecutor(t)}, t.TempDir())
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	stop, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread", ObserverID: "session", TargetID: "target", Revision: 1}}, func(FlowerComputerFrame) {})
	if stop != nil {
		stop()
	}
	if err == nil {
		t.Fatal("closed runtime accepted a sampler")
	}
}

func TestComputerLiveFrameRequiresMatchingThreadAndStaysEphemeral(t *testing.T) {
	executor := newLiveFrameExecutor(t)
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	defer runtime.Close()
	acquireLiveFrameTestTarget(t, runtime, "owner")
	published := make(chan FlowerComputerFrame, 1)
	stop, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "owner", ObserverID: "session", TargetID: "target", Revision: 1}}, func(frame FlowerComputerFrame) {
		select {
		case published <- frame:
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	var frame FlowerComputerFrame
	select {
	case frame = <-published:
	case <-time.After(2 * time.Second):
		t.Fatal("no frame")
	}
	if _, err := runtime.ResolveComputerLiveFrame(t.Context(), "owner", "target", frame.ResourceRef); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][2]string{{"other", "target"}, {"owner", "other"}} {
		if _, err := runtime.ResolveComputerLiveFrame(t.Context(), ids[0], ids[1], frame.ResourceRef); err == nil {
			t.Fatal("cross-session frame accepted")
		}
	}
	if _, err := runtime.ResolveTargetToolAttachment(t.Context(), frame.ResourceRef); err == nil {
		t.Fatal("live frame was persisted as an action keyframe")
	}
	stop()
	if _, err := runtime.ResolveComputerLiveFrame(t.Context(), "owner", "target", frame.ResourceRef); err == nil {
		t.Fatal("stopped session retained media authority")
	}
}

// Establish the same target lease as an admitted action without storing a
// keyframe, so ephemeral-storage assertions cannot pass against durable bytes.
func acquireLiveFrameTestTarget(t *testing.T, runtime *ComputerUseRuntime, threadID string) {
	t.Helper()
	_, release, err := runtime.acquireComputerControl(t.Context(), TargetToolCall{ThreadID: threadID, RunID: "run", TargetID: "target", ToolName: "computer.screenshot"})
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestComputerFrameRateBounds(t *testing.T) {
	for _, fps := range []int{0, 3, 5, 10, 15, 30} {
		interval, err := computerFrameInterval(fps)
		if err != nil || interval <= 0 {
			t.Fatalf("fps=%d: %v", fps, err)
		}
		if fps != 0 && interval != time.Second/time.Duration(fps) {
			t.Fatal("frame rate changed")
		}
	}
	for _, fps := range []int{-1, 1, 4, 31, 1000} {
		if _, err := computerFrameInterval(fps); err == nil {
			t.Fatalf("accepted unsupported fps %d", fps)
		}
	}
}

func TestPrivateComputerFramesContinueWithoutInputAndRemainObserverScoped(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	executor := &takeoverObservationExecutor{body: body, attachment: attachment}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	call := TargetToolCall{ThreadID: "thread", TurnID: "turn", RunID: "run", TargetID: "target", ToolName: "browser.navigate"}
	if _, err := runtime.ExecuteTargetTool(t.Context(), call); err != nil {
		t.Fatal(err)
	}
	frames := make(chan FlowerComputerFrame, 32)
	var valid atomic.Bool
	valid.Store(true)
	request := computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ObserverID: "observer", Revision: 2, ThreadID: "thread", TargetID: "target", InteractionID: "interaction", FPS: 10}, privateCall: call, validate: func(context.Context) error {
		if !valid.Load() {
			return ErrWaitingPromptChanged
		}
		return nil
	}}
	stop, err := runtime.startComputerLiveFrames(t.Context(), request, func(frame FlowerComputerFrame) { frames <- frame })
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	for i := 0; i < 3; i++ {
		var frame FlowerComputerFrame
		select {
		case frame = <-frames:
		case <-time.After(time.Second):
			t.Fatal("private viewing stopped without another input")
		}
		if frame.ResourceRef != "" || frame.SHA256 != "" || frame.FrameID == "" || frame.InteractionID != "interaction" {
			t.Fatalf("private frame became a public capability: %+v", frame)
		}
		if i == 0 {
			time.Sleep(250 * time.Millisecond)
			select {
			case <-frames:
				t.Fatal("slow reader caused unsent private frames to accumulate")
			default:
			}
		}
		if i == 1 {
			_, err := runtime.resolvePrivateComputerFrame(ComputerPrivateFrameRequest{ObserverID: "observer", ViewerRevision: 2, ThreadID: "thread", InteractionID: "interaction", FrameID: "1"})
			if err != nil {
				t.Fatal(err)
			}
			time.Sleep(150 * time.Millisecond)
			select {
			case <-frames:
				t.Fatal("reading an old frame released the current frame")
			default:
			}
		}
		read := ComputerPrivateFrameRequest{ObserverID: "observer", ViewerRevision: 2, ThreadID: "thread", InteractionID: "interaction", FrameID: frame.FrameID}
		if pixels, err := runtime.resolvePrivateComputerFrame(read); err != nil || len(pixels) == 0 {
			t.Fatalf("private frame: %v", err)
		}
		for _, bad := range []ComputerPrivateFrameRequest{
			{ObserverID: "other", ViewerRevision: 2, ThreadID: "thread", InteractionID: "interaction", FrameID: frame.FrameID},
			{ObserverID: "observer", ViewerRevision: 1, ThreadID: "thread", InteractionID: "interaction", FrameID: frame.FrameID},
			{ObserverID: "observer", ViewerRevision: 2, ThreadID: "other", InteractionID: "interaction", FrameID: frame.FrameID},
			{ObserverID: "observer", ViewerRevision: 2, ThreadID: "thread", InteractionID: "other", FrameID: frame.FrameID},
		} {
			if _, err := runtime.resolvePrivateComputerFrame(bad); err == nil {
				t.Fatal("private frame accepted stale or unrelated authority")
			}
		}
		if _, err := runtime.ResolveComputerLiveFrame(t.Context(), "thread", "target", attachment.ResourceRef); err == nil {
			t.Fatal("private image entered public live media")
		}
		if _, err := runtime.ResolveTargetToolAttachment(t.Context(), attachment.ResourceRef); err == nil {
			t.Fatal("private image was persisted")
		}
	}
	if executor.userInputs.Load() != 0 || executor.observations.Load() != 0 {
		t.Fatal("private viewing dispatched input or model observations")
	}
	valid.Store(false)
	select {
	case frame := <-frames:
		if frame.ErrorCode == "" {
			t.Fatal("expired interaction still published pixels")
		}
	case <-time.After(time.Second):
		t.Fatal("expired interaction did not stop viewer")
	}
	stop()
}

func TestComputerPublicViewersCanReadIdenticalSamplesWithoutStarvingEachOther(t *testing.T) {
	executor := newLiveFrameExecutor(t)
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	defer runtime.Close()
	acquireLiveFrameTestTarget(t, runtime, "thread")
	frames := make(chan FlowerComputerFrame, 8)
	for _, observer := range []string{"first", "second"} {
		stop, err := runtime.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ObserverID: observer, Revision: 1, ThreadID: "thread", TargetID: "target", FPS: 30}}, func(frame FlowerComputerFrame) { frames <- frame })
		if err != nil {
			t.Fatal(err)
		}
		defer stop()
	}
	for range 2 {
		select {
		case <-frames:
		case <-time.After(time.Second):
			t.Fatal("initial frame missing")
		}
	}
	if _, err := runtime.ResolveComputerLiveFrame(t.Context(), "thread", "target", executor.attachment.ResourceRef); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for range 2 {
		select {
		case frame := <-frames:
			seen[frame.SessionID] = true
		case <-time.After(time.Second):
			t.Fatal("reading identical pixels starved a viewer")
		}
	}
	if len(seen) != 2 {
		t.Fatal("both public viewers must continue")
	}
}
