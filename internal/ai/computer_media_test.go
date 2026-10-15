package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func computerFrameFixture(t *testing.T) ([]byte, TargetToolAttachment) {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	body := b.Bytes()
	hash := fmt.Sprintf("%x", sha256.Sum256(body))
	return body, TargetToolAttachment{ResourceRef: "computer://target/" + hash, MIMEType: "image/png", SHA256: hash, SizeBytes: int64(len(body))}
}

func TestComputerKeyframesRecoverAndRejectChangedContent(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	dir := t.TempDir()
	first := newToolMediaStore(dir)
	if err := first.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	restarted := newToolMediaStore(dir)
	recovered, err := restarted.read(t.Context(), attachment.ResourceRef)
	if err != nil || !bytes.Equal(body, recovered) {
		t.Fatalf("restart: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "target", attachment.SHA256+".png"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.read(t.Context(), attachment.ResourceRef); err == nil {
		t.Fatal("changed bytes accepted")
	}
	if err := restarted.put(t.Context(), attachment, body); err == nil {
		t.Fatal("changed stored bytes silently overwritten")
	}
}

func TestComputerKeyframesRejectInvalidImagesAndReferences(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	store := newToolMediaStore(t.TempDir())
	for _, ref := range []string{"computer://../bad", "computer://target/unknown", "https://example.test/image.png"} {
		if _, err := store.read(t.Context(), ref); err == nil {
			t.Fatalf("invalid ref accepted: %s", ref)
		}
	}
	invalid := attachment
	invalid.MIMEType = "text/html"
	if err := store.put(t.Context(), invalid, body); err == nil {
		t.Fatal("wrong MIME accepted")
	}
	if err := store.put(t.Context(), attachment, []byte("not an image")); err == nil {
		t.Fatal("invalid bytes accepted")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := store.put(ctx, attachment, body); err != context.Canceled {
		t.Fatalf("cancel: %v", err)
	}
}

func TestComputerRuntimePersistsOnlyActionKeyframes(t *testing.T) {
	dir := t.TempDir()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", State: "ready", Ready: true}); err != nil {
		t.Fatal(err)
	}
	executor := newLiveFrameExecutor(t)
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor}, dir)
	installBrowserStub(t, runtime)
	result, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "target", ToolName: "computer.screenshot"})
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	restarted := NewComputerUseRuntime(registry, nil, dir)
	defer restarted.Close()
	body, err := restarted.ResolveTargetToolAttachment(t.Context(), result.Attachments[0].ResourceRef)
	if err != nil || !bytes.Equal(body, executor.body) {
		t.Fatalf("runtime recovery: %v", err)
	}
}

// A faulty adapter must not leak a sensitive image through storage or live viewing.
type unsafeComputerFrameExecutor struct {
	result   TargetToolResult
	released bool
}

func (e *unsafeComputerFrameExecutor) ExecuteTargetTool(context.Context, TargetToolCall) (TargetToolResult, error) {
	return e.result, nil
}
func (e *unsafeComputerFrameExecutor) releaseTargetFrame(string) { e.released = true }
func TestComputerRuntimeDropsUnsafeFramesBeforeStorageOrViewing(t *testing.T) {
	for _, live := range []bool{false, true} {
		t.Run(fmt.Sprintf("live=%t", live), func(t *testing.T) {
			body, attachment := computerFrameFixture(t)
			executor := &unsafeComputerFrameExecutor{result: TargetToolResult{TargetID: "target", frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Safety: &InteractionSafetyDecision{Level: "takeover"}, Result: map[string]any{"action_executed": true}}}
			runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
			t.Cleanup(func() { _ = runtime.Close() })
			acquireLiveFrameTestTarget(t, runtime, "owner")
			result, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: "owner", RunID: "run", TargetID: "target", ToolName: "browser.navigate", liveFrame: live})
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Attachments) != 0 || len(result.frameBytes) != 0 {
				t.Fatal("unsafe frame escaped runtime")
			}
			if !executor.released {
				t.Fatal("unsafe adapter frame retained")
			}
			if _, err := runtime.ResolveTargetToolAttachment(t.Context(), attachment.ResourceRef); err == nil {
				t.Fatal("unsafe frame persisted")
			}
			if result.Result.(map[string]any)["action_executed"] != true {
				t.Fatal("lost completed navigation outcome")
			}
		})
	}
}

func TestComputerScreenshotRequiresSavedImageForExactTarget(t *testing.T) {
	for _, variant := range []string{"missing", "corrupt", "wrong-target", "wrong-reference", "save-failure"} {
		t.Run(variant, func(t *testing.T) {
			body, attachment := computerFrameFixture(t)
			result := TargetToolResult{TargetID: "target", frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{"action_executed": false}}
			dir := t.TempDir()
			switch variant {
			case "missing":
				result.Attachments, result.frameBytes = nil, nil
			case "corrupt":
				result.frameBytes = []byte("invalid PNG")
			case "wrong-target":
				result.TargetID = "other"
			case "wrong-reference":
				result.Attachments[0].ResourceRef = "computer://other/" + attachment.SHA256
			case "save-failure":
				dir = filepath.Join(dir, "file")
				if err := os.WriteFile(dir, []byte("not a directory"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			executor := &unsafeComputerFrameExecutor{result: result}
			runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, dir)
			t.Cleanup(func() { _ = runtime.Close() })
			got, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "target", ToolName: "computer.screenshot"})
			if err == nil || len(got.Attachments) != 0 {
				t.Fatalf("unsaved screenshot accepted: %+v %v", got, err)
			}
			if variant != "missing" && !executor.released {
				t.Fatal("transient frame leaked")
			}
			if _, err := runtime.ResolveTargetToolAttachment(t.Context(), attachment.ResourceRef); err == nil {
				t.Fatal("invalid screenshot persisted")
			}
		})
	}
}

func TestComputerMediaSaveFailurePreservesCompletedAction(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	executor := &unsafeComputerFrameExecutor{result: TargetToolResult{TargetID: "target", frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{"action_executed": true}}}
	dir := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(dir, nil, 0600); err != nil {
		t.Fatal(err)
	}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, dir)
	t.Cleanup(func() { _ = runtime.Close() })
	result, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "target", ToolName: "computer.click"})
	if err == nil || takeoverResult(result, err) || result.Result.(map[string]any)["action_executed"] != true || len(result.Attachments) != 0 || !executor.released {
		t.Fatalf("lost confirmed progress or leaked media: %+v %v", result, err)
	}
}
