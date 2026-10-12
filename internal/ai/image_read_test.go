package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/session"
)

func imageReadFixture(t *testing.T, format string) []byte {
	t.Helper()
	frame := image.NewRGBA(image.Rect(0, 0, 8, 6))
	frame.Set(2, 3, color.RGBA{R: 200, G: 100, B: 50, A: 255})
	var out bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&out, frame)
	case "jpeg":
		err = jpeg.Encode(&out, frame, nil)
	case "gif":
		err = gif.Encode(&out, frame, nil)
	case "webp":
		// A small 8x6 WebP generated from a solid-color source image.
		body, decodeErr := base64.StdEncoding.DecodeString("UklGRjgAAABXRUJQVlA4ICwAAABwAQCdASoIAAYAAUAmJaACdAFAAAD+7c7eDZIpuR/+QH//5Af//kB//HkAAA==")
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		return body
	default:
		t.Fatal(format)
	}
	if err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestImageReadPreservesNativeSnapshotsAndReadsFirstGIFFrame(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "gif", "webp"} {
		t.Run(format, func(t *testing.T) {
			body := imageReadFixture(t, format)
			workspace := t.TempDir()
			path := filepath.Join(workspace, "misleading.txt")
			if err := os.WriteFile(path, body, 0600); err != nil {
				t.Fatal(err)
			}
			store := newToolMediaStore(t.TempDir())
			r := &run{agentHomeDir: workspace, workingDir: workspace, supportsImageInput: true, host: runHostCapabilities{saveToolMedia: store.put, readToolMedia: store.read}}
			value, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "misleading.txt"})
			if err != nil {
				t.Fatal(err)
			}
			output := value.(toolExecutionOutput)
			if len(output.Attachments) != 1 {
				t.Fatal("missing typed image")
			}
			descriptor := output.Attachments[0]
			result := output.Payload.(imageReadResult)
			expectedFormat := format
			if format == "gif" {
				expectedFormat = "png"
			}
			if result.MIMEType != "image/"+expectedFormat || result.Width != 8 || result.Height != 6 || result.FirstFrame != (format == "gif") {
				t.Fatalf("result=%+v", result)
			}
			if err := os.WriteFile(path, []byte("changed"), 0600); err != nil {
				t.Fatal(err)
			}
			recovered, err := newToolMediaStore(store.directory).read(t.Context(), descriptor.ResourceRef)
			if err != nil {
				t.Fatal(err)
			}
			if format != "gif" && !bytes.Equal(recovered, body) {
				t.Fatal("native image was rewritten")
			}
			part, err := r.resolveFloretToolMedia(t.Context(), flprovider.Attachment{ResourceRef: descriptor.ResourceRef, Name: descriptor.Name, MIMEType: descriptor.MIMEType, SizeBytes: descriptor.SizeBytes})
			if err != nil {
				t.Fatal(err)
			}
			if part.Type != "image" || !strings.HasSuffix(part.FileURI, base64.StdEncoding.EncodeToString(recovered)) {
				t.Fatal("provider did not receive native image bytes")
			}
			if got := fmt.Sprintf("%x", sha256.Sum256(recovered)); got != descriptor.SHA256 {
				t.Fatal("snapshot digest changed")
			}
		})
	}
}

func TestImageReadRejectsDeniedUnsupportedCorruptAndOutOfScopeInputs(t *testing.T) {
	workspace := t.TempDir()
	store := newToolMediaStore(t.TempDir())
	r := &run{agentHomeDir: workspace, workingDir: workspace, supportsImageInput: true, host: runHostCapabilities{saveToolMedia: store.put}}
	if err := os.WriteFile(filepath.Join(workspace, "bad.png"), []byte("not an image"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.toolImageRead(t.Context(), &session.Meta{}, "read", map[string]any{"file_path": "bad.png"}); err == nil || !strings.Contains(err.Error(), "permission") {
		t.Fatalf("permission=%v", err)
	}
	r.supportsImageInput = false
	if _, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "bad.png"}); err == nil || !strings.Contains(err.Error(), "image-capable") {
		t.Fatalf("vision=%v", err)
	}
	r.supportsImageInput = true
	for _, path := range []string{"bad.png", workspace, filepath.Join(t.TempDir(), "outside.png")} {
		if _, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": path}); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := r.toolImageRead(canceled, &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "bad.png"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	if _, _, _, err := imageSnapshot(make([]byte, maxImageReadBytes+1), "large.png"); err == nil {
		t.Fatal("large image accepted")
	}
}

func TestImageReadUsesExplicitTargetWithoutLocalFallback(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "source.png"), imageReadFixture(t, "png"), 0600); err != nil {
		t.Fatal(err)
	}
	store := newToolMediaStore(t.TempDir())
	executor := &recordingTargetExecutor{}
	r := &run{agentHomeDir: workspace, workingDir: workspace, supportsImageInput: true, host: runHostCapabilities{saveToolMedia: store.put}, toolTargetPolicy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"allowed"}}, targetToolExecutor: executor, targetResolver: mappedTargetResolver{"allowed": {ID: "allowed", Ready: true}}}
	bindTargetTestRun(t, r)
	for _, target := range []string{"", "forged", "unavailable"} {
		if _, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "source.png", "target_id": target}); err == nil {
			t.Fatalf("target %q accepted", target)
		}
	}
	if len(executor.calls) != 0 {
		t.Fatal("rejected target dispatched")
	}
	if _, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "source.png", "target_id": "allowed"}); err == nil {
		t.Fatal("executor without image silently read local file")
	}
	if len(executor.calls) != 1 || executor.calls[0].ToolName != "image.read" {
		t.Fatal("target routing lost image tool")
	}
}

func TestImageReadRejectsPixelBoundsBeforeDecoding(t *testing.T) {
	for _, dims := range [][2]uint32{{16385, 1}, {8193, 4096}} {
		body := append([]byte(nil), imageReadFixture(t, "png")...)
		binary.BigEndian.PutUint32(body[16:20], dims[0])
		binary.BigEndian.PutUint32(body[20:24], dims[1])
		binary.BigEndian.PutUint32(body[29:33], crc32.ChecksumIEEE(body[12:29]))
		if _, _, _, err := imageSnapshot(body, "oversized.png"); err == nil || !strings.Contains(err.Error(), "dimensions") {
			t.Fatalf("dimensions %v error=%v", dims, err)
		}
	}
}

func TestImageResultNeverInfersAuthorityFromOrdinaryJSON(t *testing.T) {
	ref := "image://" + strings.Repeat("a", 64) + "/png"
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "untyped", ToolName: "image.read", Status: toolResultStatusSuccess, Data: map[string]any{"resource_ref": ref, "mime_type": "image/png", "base64": "untrusted"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attachments) != 0 {
		t.Fatal("ordinary JSON became native image")
	}
	if result.Activity != nil {
		for _, target := range result.Activity.TargetRefs {
			if target.Kind == "tool_image" {
				t.Fatal("ordinary JSON granted preview authority")
			}
		}
	}
}

type imageTargetExecutor struct{ body []byte }

func (executor imageTargetExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	digest := fmt.Sprintf("%x", sha256.Sum256(executor.body))
	return TargetToolResult{TargetID: call.TargetID, Result: map[string]any{"display_name": "remote.png"}, Attachments: []TargetToolAttachment{{ResourceRef: "remote-image://" + digest, Name: "remote.png", MIMEType: "image/png", SHA256: digest, SizeBytes: int64(len(executor.body))}}}, nil
}
func (executor imageTargetExecutor) ResolveTargetToolAttachment(_ context.Context, _ string) ([]byte, error) {
	return executor.body, nil
}

func TestImageReadSnapshotsAuthorizedRemoteTargetBytes(t *testing.T) {
	body := imageReadFixture(t, "png")
	store := newToolMediaStore(t.TempDir())
	r := &run{supportsImageInput: true, host: runHostCapabilities{saveToolMedia: store.put}, toolTargetPolicy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"remote"}}, targetToolExecutor: imageTargetExecutor{body: body}, targetResolver: mappedTargetResolver{"remote": {ID: "remote", Ready: true}}}
	bindTargetTestRun(t, r)
	output, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "read", map[string]any{"file_path": "/remote-only/image.png", "target_id": "remote"})
	if err != nil {
		t.Fatal(err)
	}
	result := output.(toolExecutionOutput)
	if len(result.Attachments) != 1 || !imageSnapshotResourcePattern.MatchString(result.Attachments[0].ResourceRef) {
		t.Fatal("remote image lacks immutable canonical snapshot")
	}
	recovered, err := store.read(t.Context(), result.Attachments[0].ResourceRef)
	if err != nil || !bytes.Equal(recovered, body) {
		t.Fatalf("remote bytes=%v", err)
	}
}
