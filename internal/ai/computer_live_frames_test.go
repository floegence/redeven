package ai

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type liveFrameExecutor struct{ calls atomic.Int32 }

func (e *liveFrameExecutor) ExecuteTargetTool(context.Context, TargetToolCall) (TargetToolResult, error) {
	n := e.calls.Add(1)
	return TargetToolResult{Attachments: []TargetToolAttachment{{ResourceRef: "computer://target/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", MIMEType: "image/png"}}, Result: n}, nil
}

func TestComputerLiveFramesPublishesAndStops(t *testing.T) {
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", Ready: true, State: "ready"}); err != nil {
		t.Fatal(err)
	}
	executor := &liveFrameExecutor{}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor})
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
