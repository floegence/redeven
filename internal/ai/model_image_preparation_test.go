package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

func screenshotPreparationFixture(t *testing.T) ([]byte, flprovider.Attachment, ContentPart) {
	t.Helper()
	pixels := image.NewNRGBA(image.Rect(0, 0, 512, 256))
	rng := rand.New(rand.NewPCG(1, 2))
	for y := 0; y < 256; y++ {
		for x := 0; x < 512; x++ {
			pixels.SetNRGBA(x, y, color.NRGBA{uint8(rng.Uint32()), uint8(rng.Uint32()), uint8(rng.Uint32()), 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, pixels); err != nil {
		t.Fatal(err)
	}
	body := out.Bytes()
	hash := fmt.Sprintf("%x", sha256.Sum256(body))
	a := flprovider.Attachment{ResourceRef: "computer://test/" + hash, MIMEType: "image/png", Name: "screenshot", SizeBytes: int64(len(body))}
	return body, a, ContentPart{Type: "image", MimeType: "image/png", FileURI: "data:image/png;base64," + base64.StdEncoding.EncodeToString(body)}
}
func TestModelScreenshotPreparationAndOriginalRead(t *testing.T) {
	body, a, part := screenshotPreparationFixture(t)
	source := sha256.Sum256(body)
	got, notice, err := prepareModelScreenshot(t.Context(), a, part, false)
	if err != nil || got.MimeType != "image/jpeg" || len(got.FileURI) >= len(part.FileURI) || !strings.Contains(notice, "512x256") || sha256.Sum256(body) != source {
		t.Fatalf("mime=%s notice=%s err=%v", got.MimeType, notice, err)
	}
	exact, notice, err := prepareModelScreenshot(t.Context(), a, part, true)
	if err != nil || exact.FileURI != part.FileURI || notice != "" {
		t.Fatal("original read changed", err)
	}
	adapter := &floretProviderAdapter{supportsImageInput: true, providerType: "deepseek", modelName: "deepseek-flash"}
	resolver := func(context.Context, flprovider.Attachment) (ContentPart, error) { return part, nil }
	messages := []flprovider.Message{{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "capture", ToolName: "computer.exec", Attachments: []flprovider.Attachment{a, a, a, a, a, a}}}}
	mapped, err := adapter.floretMessagesToFlowerWithResolver(t.Context(), messages, resolver)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, p := range mapped[0].Content {
		if p.Type == "image" {
			count++
			if p.MimeType != "image/jpeg" {
				t.Fatal("image not optimized")
			}
		}
	}
	if count != 6 {
		t.Fatal("image lost", count)
	}
	messages[0].ToolResult.ToolName = "image.read"
	mapped, err = adapter.floretMessagesToFlowerWithResolver(t.Context(), messages, resolver)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range mapped[0].Content {
		if p.Type == "image" && p.FileURI != part.FileURI {
			t.Fatal("explicit original lost")
		}
	}
}
func TestCanonicalCropPreservesOriginalPixelsAndAuthority(t *testing.T) {
	body, a, _ := screenshotPreparationFixture(t)
	before := sha256.Sum256(body)
	reads, writes := 0, 0
	var saved []byte
	snapshot := canonicalImageSnapshot{Attachment: flruntime.MessageAttachment{ResourceRef: a.ResourceRef, Name: a.Name, MIMEType: a.MIMEType, SizeBytes: a.SizeBytes}, Body: body, Width: 512, Height: 256}
	r := &run{supportsImageInput: true, host: runHostCapabilities{
		readImageAttachment: func(context.Context, *session.Meta, string) (canonicalImageSnapshot, error) {
			reads++
			return snapshot, nil
		},
		saveToolMedia: func(_ context.Context, _ TargetToolAttachment, b []byte) error {
			writes++
			saved = bytes.Clone(b)
			return nil
		}}}
	args := map[string]any{"locator": "media:v1:" + strings.Repeat("a", 64), "crop": map[string]any{"x": 10, "y": 20, "width": 30, "height": 40}}
	value, err := r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "crop", args)
	if err != nil {
		t.Fatal(err)
	}
	output := value.(toolExecutionOutput)
	result := output.Payload.(imageReadResult)
	if reads != 1 || writes != 1 || result.Width != 30 || result.Height != 40 || result.SourceCrop.X != 10 || sha256.Sum256(body) != before {
		t.Fatal("crop changed source or metadata")
	}
	decoded, _, _ := image.Decode(bytes.NewReader(saved))
	original, _, _ := image.Decode(bytes.NewReader(body))
	if decoded.At(0, 0) != original.At(10, 20) {
		a, b, c, d := decoded.At(0, 0).RGBA()
		w, x, y, z := original.At(10, 20).RGBA()
		if a != w || b != x || c != y || d != z {
			t.Fatal("crop pixels changed")
		}
	}
	args["crop"] = map[string]any{"x": 500, "y": 0, "width": 30, "height": 40}
	if _, err = r.toolImageRead(t.Context(), &session.Meta{CanRead: true}, "crop", args); err == nil || writes != 1 {
		t.Fatal("out of bounds crop accepted")
	}
	if _, err = r.toolImageRead(t.Context(), &session.Meta{}, "crop", args); err == nil || reads != 2 {
		t.Fatal("unauthorized image opened")
	}
	for _, invalid := range []any{
		map[string]any{"y": 0, "width": 10, "height": 10},
		map[string]any{"x": nil, "y": 0, "width": 10, "height": 10},
		map[string]any{"x": 0.5, "y": 0, "width": 10, "height": 10},
		map[string]any{"x": 0, "y": 0, "width": 10, "height": 10, "extra": true},
	} {
		if _, err := r.cropCanonicalImage(t.Context(), snapshot, "source", invalid); err == nil || writes != 1 {
			t.Fatalf("invalid crop accepted: %v", invalid)
		}
	}
}
func TestRequestCapacityDiagnosticSurvivesRecovery(t *testing.T) {
	cause := &flprovider.RequestByteLimitError{ActualBytes: 50 << 20, LimitBytes: 32 << 20}
	err := providerTransportFailure(cause, "deepseek")
	joined := fmt.Errorf("provider context overflow retry exhausted: %w", errors.Join(err, flprovider.ErrContextOverflow, errors.New("private cleanup details")))
	d, ok := parseProviderFailure(joined.Error())
	if !ok || d.ActualBytes != cause.ActualBytes || d.LimitBytes != cause.LimitBytes || providerDiagnosticRunCode(d) != runErrorCodeProviderRequestTooLarge {
		t.Fatalf("%+v %v", d, joined)
	}
	failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: joined.Error()}
	code, _ := projectFloretTurnFailure(failure, "")
	detail := canonicalFailureDetail(failure)
	if code != runErrorCodeProviderRequestTooLarge || !strings.Contains(detail, "actual_bytes") || strings.Contains(detail, "private") {
		t.Fatalf("code=%s detail=%s", code, detail)
	}
	if !errors.Is(joined, flprovider.ErrContextOverflow) {
		t.Fatal("overflow classification lost")
	}
}

func TestModelScreenshotFrozenTransportPreservesSixFrames(t *testing.T) {
	body, attachment, original := screenshotPreparationFixture(t)
	expected, _, err := prepareModelScreenshot(t.Context(), attachment, original, false)
	if err != nil {
		t.Fatal(err)
	}
	wire := make(chan []byte, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		wire <- raw
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"screenshots\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"reviewed\"}]}]}}\n\n")
	}))
	defer server.Close()
	base, err := newProviderAdapter("deepseek", server.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	adapter := newFloretProviderAdapter(base, "deepseek", "deepseek-v4-flash-vision-exp", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
	adapter.supportsImageInput = true
	resolutions := 0
	adapter.attachmentResolver = func(context.Context, flprovider.Attachment) (ContentPart, error) { resolutions++; return original, nil }
	request := flprovider.Request{RunID: "screenshots", PromptScopeID: "screenshots", Messages: []flprovider.Message{
		{Role: flprovider.RoleAssistant, ToolCalls: []flprovider.ToolCall{{ID: "capture", Name: "computer.exec", Args: "{}"}}},
		{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "capture", ToolName: "computer.exec", Text: "six frames", Attachments: []flprovider.Attachment{attachment, attachment, attachment, attachment, attachment, attachment}}},
	}}
	prepared, err := adapter.Prepare(t.Context(), request)
	if err != nil {
		t.Fatalf("prepare: %v; cause: %v", err, errors.Unwrap(err))
	}
	defer prepared.Close()
	// If either attempt resolves or encodes again, it now receives invalid bytes.
	original.FileURI = "data:image/png;base64,invalid"
	consume := func(p flprovider.PreparedRequest) []byte {
		t.Helper()
		stream, err := p.Stream(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		done := false
		for event := range stream {
			if event.Err != nil {
				t.Fatal(event.Err)
			}
			done = done || event.Type == flprovider.EventDone
		}
		if !done {
			t.Fatal("completion missing")
		}
		return <-wire
	}
	first := consume(prepared)
	retry, err := prepared.(flprovider.PreparedRequestReplay).PrepareRetry(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	defer retry.Close()
	second := consume(retry)
	encoded := strings.TrimPrefix(expected.FileURI, "data:image/jpeg;base64,")
	if resolutions != 6 || !bytes.Equal(first, second) || bytes.Count(first, []byte(encoded)) != 6 || bytes.Count(first, []byte("Model screenshot:")) != 6 || bytes.Contains(first, []byte(base64.StdEncoding.EncodeToString(body))) || int64(len(first)) >= flowerModelRequestMaxBytes {
		t.Fatalf("lost frames, original preservation or frozen replay: resolutions=%d bytes=%d", resolutions, len(first))
	}
}
