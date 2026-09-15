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
	stop, err := runtime.StartComputerLiveFrames(ctx, "thread", "session", "target", func(FlowerComputerFrame) { frames.Add(1) })
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
	stop, err := runtime.StartComputerLiveFrames(t.Context(), "thread", "session", "target", func(FlowerComputerFrame) {})
	if err != nil {
		t.Fatal(err)
	}
	stop()
	var frames atomic.Int32
	replacement, err := runtime.StartComputerLiveFrames(t.Context(), "thread", "session", "target", func(FlowerComputerFrame) { frames.Add(1) })
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
	stop, err := runtime.StartComputerLiveFrames(t.Context(), "thread", "session", "target", func(FlowerComputerFrame) {})
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
	stop, err := runtime.StartComputerLiveFrames(t.Context(), "owner", "session", "target", func(frame FlowerComputerFrame) {
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
