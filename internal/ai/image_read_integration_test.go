package ai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flidentity "github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestImageReadReachesNativeProviderAndSurvivesRestartForkAndFileDeletion(t *testing.T) {
	for _, tc := range []struct {
		provider, model string
		permission      FlowerPermissionType
	}{
		{"deepseek", "deepseek-v4-flash-vision-exp", FlowerPermissionReadonly},
		{"deepseek", "deepseek-v4-flash-vision-exp", FlowerPermissionApprovalRequired},
		{"deepseek", "deepseek-v4-flash-vision-exp", FlowerPermissionFullAccess},
		{"openai", "gpt-5-mini", FlowerPermissionReadonly},
	} {
		permission := tc.permission
		t.Run(tc.provider+"/"+string(permission), func(t *testing.T) {
			var mu sync.Mutex
			var requests [][]byte
			var historicalLocator string
			nativeReceived := make(chan struct{}, 1)
			releaseNative := make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(releaseNative) }) }
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				var request map[string]any
				if err := json.Unmarshal(raw, &request); err != nil {
					t.Error(err)
					return
				}
				tools, _ := request["tools"].([]any)
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if len(tools) == 0 {
					writeDeepSeekIntegrationNaturalResponse(w, flusher, "title", "Image reading")
					return
				}
				mu.Lock()
				requests = append(requests, raw)
				index := len(requests)
				mu.Unlock()
				if index == 1 || index == 3 {
					found := false
					for _, tool := range tools {
						item, _ := tool.(map[string]any)
						if item["name"] == "image_read" {
							found = true
						}
					}
					if !found {
						t.Error("shared image.read absent from provider tools")
					}
					args := map[string]any{"file_path": "source.png"}
					if index == 3 {
						mu.Lock()
						args = map[string]any{"locator": historicalLocator}
						mu.Unlock()
					}
					arguments, _ := json.Marshal(args)
					call := map[string]any{"type": "function_call", "id": fmt.Sprintf("image-call-%d", index), "call_id": fmt.Sprintf("image-call-%d", index), "name": "image_read", "arguments": string(arguments)}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": call})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": call})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "image-read", "status": "completed", "output": []any{call}}})
					return
				}
				if index == 2 {
					nativeReceived <- struct{}{}
					select {
					case <-releaseNative:
					case <-r.Context().Done():
						return
					}
				}
				if tc.provider == "openai" {
					text := "The image contains a red square."
					item := map[string]any{"type": "message", "id": fmt.Sprintf("answer-%d", index), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": fmt.Sprintf("answer-%d", index), "role": "assistant", "status": "in_progress", "content": []any{}}})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "item_id": fmt.Sprintf("answer-%d", index), "delta": text})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("answer-%d", index), "status": "completed", "output": []any{item}, "usage": map[string]any{"input_tokens": 200, "output_tokens": 40}}})
					return
				}
				writeDeepSeekIntegrationNaturalResponse(w, flusher, fmt.Sprintf("answer-%d", index), "The image contains a red square.")
			}))
			defer func() { release(); provider.Close() }()
			state := t.TempDir()
			frame := image.NewRGBA(image.Rect(0, 0, 3614, 1920))
			for y := 100; y < 500; y++ {
				for x := 100; x < 500; x++ {
					frame.Set(x, y, color.RGBA{R: 255, A: 255})
				}
			}
			noise := rand.New(rand.NewPCG(42, 91))
			for y := 600; y < 1600; y++ {
				for x := 600; x < 1624; x++ {
					offset := frame.PixOffset(x, y)
					random := noise.Uint64()
					frame.Pix[offset], frame.Pix[offset+1], frame.Pix[offset+2], frame.Pix[offset+3] = byte(random), byte(random>>8), byte(random>>16), 255
				}
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, frame); err != nil {
				t.Fatal(err)
			}
			if encoded.Len() < 3_400_000 || encoded.Len() > 4_200_000 {
				t.Fatalf("qualification image size=%d", encoded.Len())
			}
			t.Logf("native image qualification: 3614x1920, %d bytes", encoded.Len())
			source := filepath.Join(state, "source.png")
			if err := os.WriteFile(source, encoded.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			nativeImage := base64.StdEncoding.EncodeToString(encoded.Bytes())
			vision, _ := config.AIModelCatalogEntry(tc.provider, tc.model)
			textModel := config.AIProviderModel{ModelName: "text-only", ContextWindow: 128000, MaxOutputTokens: 4096, InputModalities: []string{"text"}}
			options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: tc.provider + "/" + vision.ModelName, Providers: []config.AIProvider{{ID: tc.provider, Type: tc.provider, BaseURL: provider.URL, Models: []config.AIProviderModel{vision, textModel}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 60 * time.Second, FirstOutputTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}}
			svc, err := NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if svc != nil {
					_ = svc.Close()
				}
			}()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Image reading", tc.provider+"/"+vision.ModelName, "", state)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(permission)); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "read-image", Input: RunInput{Text: "Read source.png directly."}, Options: RunOptions{PermissionType: string(permission)}}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-nativeReceived:
			case <-time.After(30 * time.Second):
				t.Fatal("provider never received the native image")
			}
			orphan, _, orphanBody, err := imageSnapshot(imageReadFixture(t, "jpeg"), "orphan.jpg")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.toolMedia.put(t.Context(), orphan, orphanBody); err != nil {
				t.Fatal(err)
			}
			if removed, err := svc.sweepToolMedia(t.Context(), false); removed != 0 || !errors.Is(err, errToolMediaExecutionActive) {
				t.Fatalf("active execution media sweep=%d %v", removed, err)
			}
			if _, err := svc.toolMedia.read(t.Context(), orphan.ResourceRef); err != nil {
				t.Fatalf("active execution lost unadmitted bytes: %v", err)
			}
			release()
			view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
			if view.RunStatus != "success" {
				current, _ := svc.threadRuntime.View(t.Context(), flidentity.ThreadID(thread.ThreadID))
				t.Fatalf("image execution=%s %s; canonical failure=%+v", view.RunErrorCode, view.RunError, current.Failure)
			}
			detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			ref := ""
			for _, item := range detail.Current.Items {
				if item.Activity == nil || item.Activity.Presentation == nil {
					continue
				}
				for _, target := range item.Activity.Presentation.TargetRefs {
					if target.Kind == "tool_image" {
						ref = target.ResourceRef
					}
				}
			}
			if ref == "" {
				t.Fatal("canonical result lost image membership")
			}
			for _, item := range detail.Current.Items {
				for _, a := range item.Attachments {
					if a.ResourceRef == ref {
						historicalLocator, err = a.Locator()
						if err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			if historicalLocator == "" {
				t.Fatal("confirmed tool image absent from canonical attachments")
			}
			original, err := svc.readCanonicalThreadImage(t.Context(), meta, thread.ThreadID, historicalLocator, "")
			if err != nil || !bytes.Equal(original.Body, encoded.Bytes()) {
				t.Fatalf("canonical locator reread: %v", err)
			}
			if _, err := svc.sweepToolMedia(t.Context(), false); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.toolMedia.read(t.Context(), orphan.ResourceRef); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("idle maintenance did not collect orphan: %v", err)
			}
			body, mime, err := svc.ResolveToolImageForThread(t.Context(), meta, thread.ThreadID, ref)
			if err != nil || mime != "image/png" || !bytes.Equal(body, encoded.Bytes()) {
				t.Fatalf("preview=%s %v", mime, err)
			}
			other, err := svc.CreateThread(t.Context(), meta, "Other", tc.provider+"/"+vision.ModelName, "", state)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.readCanonicalThreadImage(t.Context(), meta, other.ThreadID, historicalLocator, ""); err == nil {
				t.Fatal("locator granted cross-thread access")
			}
			revoked := *meta
			revoked.CanRead = false
			if _, err := svc.readCanonicalThreadImage(t.Context(), &revoked, thread.ThreadID, historicalLocator, ""); err == nil {
				t.Fatal("revoked read permission accepted")
			}
			if _, _, err := svc.ResolveToolImageForThread(t.Context(), meta, other.ThreadID, ref); err == nil {
				t.Fatal("cross-thread snapshot opened")
			}
			foreign := *meta
			foreign.EndpointID = "foreign"
			if _, _, err := svc.ResolveToolImageForThread(t.Context(), &foreign, thread.ThreadID, ref); err == nil {
				t.Fatal("cross-endpoint snapshot opened")
			}
			if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, tc.provider+"/text-only"); !errors.Is(err, ErrThreadImageModelUnsupported) {
				t.Fatalf("incompatible model=%v", err)
			}
			if err := os.Remove(source); err != nil {
				t.Fatal(err)
			}
			if err := svc.toolMedia.put(t.Context(), orphan, orphanBody); err != nil {
				t.Fatal(err)
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.toolMedia.read(t.Context(), orphan.ResourceRef); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("startup did not collect orphan: %v", err)
			}
			fork, err := svc.ForkThread(t.Context(), meta, thread.ThreadID, "Fork image")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.DeleteThread(t.Context(), meta, thread.ThreadID, false); err != nil {
				t.Fatal(err)
			}
			recovered, err := svc.readCanonicalThreadImage(t.Context(), meta, fork.ThreadID, historicalLocator, "")
			if err != nil || !bytes.Equal(recovered.Body, encoded.Bytes()) {
				t.Fatalf("restart/fork locator changed snapshot: %v", err)
			}
			if _, _, err := svc.ResolveToolImageForThread(t.Context(), meta, fork.ThreadID, ref); err != nil {
				t.Fatalf("fork snapshot missing: %v", err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: fork.ThreadID, ClientRequestID: "followup", Input: RunInput{Text: "Describe the same image again."}, Options: RunOptions{PermissionType: string(permission)}}); err != nil {
				t.Fatal(err)
			}
			completed := waitForAskUserIntegrationThread(t, svc, meta, fork.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
			if completed.RunStatus != "success" {
				t.Fatalf("restart/fork=%s %s", completed.RunErrorCode, completed.RunError)
			}
			mu.Lock()
			captured := append([][]byte(nil), requests...)
			mu.Unlock()
			if len(captured) != 4 {
				t.Fatalf("provider requests=%d; unexpected extra tool work", len(captured))
			}
			for index := 1; index < len(captured); index++ {
				if !bytes.Contains(captured[index], []byte(`"type":"input_image"`)) || !bytes.Contains(captured[index], []byte(nativeImage)) {
					t.Fatalf("request %d lacks original native image", index)
				}
				if strings.Contains(string(captured[index]), "browser_navigate") && bytes.Contains(captured[index], []byte(`"name":"browser_navigate","arguments"`)) {
					t.Fatal("image inspection used browser")
				}
			}
			if err := svc.DeleteThread(t.Context(), meta, fork.ThreadID, false); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for {
				_, err := svc.toolMedia.read(t.Context(), ref)
				if errors.Is(err, os.ErrNotExist) {
					break
				}
				if err != nil || time.Now().After(deadline) {
					t.Fatalf("last thread owner deletion failed to collect media: %v", err)
				}
				time.Sleep(10 * time.Millisecond)
			}
		})
	}
}
