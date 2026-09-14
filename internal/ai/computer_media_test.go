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
	first := computerMediaStore{directory: dir}
	if err := first.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	restarted := computerMediaStore{directory: dir}
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
	store := computerMediaStore{directory: t.TempDir()}
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
