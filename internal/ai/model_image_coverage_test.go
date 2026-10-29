package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAllModelImageSourcesUseDefaultPreparation(t *testing.T) {
	_, a, part := screenshotPreparationFixture(t)
	for _, source := range []string{"upload", "image.read", "computer.exec", "computer.screenshot", "computer.observe", "mcp_fixture", "summary", "history"} {
		t.Run(source, func(t *testing.T) {
			adapter := &floretProviderAdapter{supportsImageInput: true, providerType: "deepseek", modelName: "deepseek-flash"}
			ref := a
			if source != "computer.exec" {
				ref.ResourceRef = "image://" + strings.Repeat("a", 64) + "/png"
			}
			msg := flprovider.Message{Role: flprovider.RoleUser, Attachments: []flprovider.Attachment{ref}}
			if strings.Contains(source, ".") || strings.HasPrefix(source, "mcp_") {
				msg = flprovider.Message{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "call", ToolName: source, Attachments: []flprovider.Attachment{ref}}}
			}
			mapped, err := adapter.floretMessagesToFlowerWithResolver(t.Context(), []flprovider.Message{msg}, func(context.Context, flprovider.Attachment) (ContentPart, error) { return part, nil })
			if err != nil {
				t.Fatal(err)
			}
			images := 0
			for _, p := range mapped[0].Content {
				if p.Type != "image" {
					continue
				}
				images++
				if p.MimeType != "image/jpeg" || p.ModelImage == nil || p.FileURI == part.FileURI {
					t.Fatal("image bypassed preparation")
				}
			}
			if images != 1 {
				t.Fatal("image lost")
			}
		})
	}
}
func TestPreparedImagesCrossRPCWithoutRecompression(t *testing.T) {
	_, _, part := screenshotPreparationFixture(t)
	prepared, _, err := prepareModelImage(t.Context(), part)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(ModelGatewayRequest{Messages: []Message{{Role: "user", Content: []ContentPart{prepared}}}})
	var request ModelGatewayRequest
	if err = json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	actual, err := prepareModelGatewayImages(t.Context(), request)
	if err != nil || actual.Messages[0].Content[0].FileURI != prepared.FileURI {
		t.Fatal("RPC recompressed", err)
	}
	actual.Messages[0].Content[0].ModelImage.SHA256 = "forged"
	if _, err = prepareModelGatewayImages(t.Context(), actual); err == nil {
		t.Fatal("accepted forged representation")
	}
}
func TestImageLimitsSurviveRPCAndCanonicalFailure(t *testing.T) {
	for _, kind := range []string{"dimension", "count", "bytes", "total_bytes", "animated_dimension"} {
		cause := &flprovider.MediaLimitError{Kind: kind, Actual: 5120, Limit: 4096}
		err := providerTransportFailure(cause, "deepseek")
		d, ok := parseProviderFailure(err.Error())
		if !ok || d.MediaKind != kind || d.Actual != 5120 || d.Limit != 4096 || d.Stage != "image_preparation" || providerDiagnosticRunCode(d) != runErrorCodeProviderRequestTooLarge {
			t.Fatalf("lost diagnostics: %+v", d)
		}
		if flprovider.RetryAdviceForError(err).Category != flprovider.RetryPermanent || errors.Is(err, flprovider.ErrContextOverflow) {
			t.Fatal("incorrect retry classification")
		}
		rpc := &DesktopModelSourceRPCError{Code: "PROVIDER_ERROR", Message: err.Error()}
		again := providerTransportFailure(rpc, "deepseek")
		round, ok := parseProviderFailure(again.Error())
		if !ok || round.Actual != d.Actual || round.MediaKind != kind {
			t.Fatal("RPC lost media facts", again)
		}
	}
}
func TestMCPImagesPreserveOriginalsAndContentOrder(t *testing.T) {
	body, _, _ := screenshotPreparationFixture(t)
	hash := sha256.Sum256(body)
	saved := 0
	r := &run{host: runHostCapabilities{saveToolMedia: func(ctx context.Context, a TargetToolAttachment, b []byte) error {
		saved++
		if sha256.Sum256(b) != hash || a.SHA256 != fmt.Sprintf("%x", hash) {
			t.Fatal("original changed")
		}
		return nil
	}}}
	result := &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "before"}, &mcp.ImageContent{Data: body, MIMEType: "image/png"}, &mcp.TextContent{Text: "middle"}, &mcp.EmbeddedResource{Resource: &mcp.ResourceContents{URI: "resource://image", MIMEType: "image/png", Blob: body}}, &mcp.TextContent{Text: "after"}}}
	attachments, err := r.admitMCPImages(t.Context(), result)
	if err != nil || len(attachments) != 2 || saved != 2 {
		t.Fatal("MCP image lost", err)
	}
	raw, _ := json.Marshal(result)
	if bytes.Contains(raw, []byte(base64.StdEncoding.EncodeToString(body))) || !bytes.Contains(raw, []byte("image_attachment")) || result.Content[0].(*mcp.TextContent).Text != "before" || result.Content[4].(*mcp.TextContent).Text != "after" {
		t.Fatal("image JSON or order lost")
	}
}
func TestSeventeenLargeImagesUseStableDimensions(t *testing.T) {
	pixels := image.NewNRGBA(image.Rect(0, 0, 5120, 2880))
	for y := 0; y < 2880; y++ {
		for x := 0; x < 5120; x++ {
			pixels.SetNRGBA(x, y, color.NRGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, pixels); err != nil {
		t.Fatal(err)
	}
	original := ContentPart{Type: "image", MimeType: "image/png", FileURI: "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())}
	prepared, _, err := prepareModelImage(t.Context(), original)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{14, 15, 17} {
		parts := make([]ContentPart, n)
		for i := range parts {
			parts[i] = prepared
		}
		req, err := prepareModelGatewayImages(t.Context(), ModelGatewayRequest{Messages: []Message{{Role: "user", Content: parts}}})
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range req.Messages[0].Content {
			if p.ModelImage.Width != 2560 || p.ModelImage.Height != 1440 || p.FileURI != prepared.FileURI {
				t.Fatal("count changed representation")
			}
		}
	}
}

func TestImageFileAndCaseVariantsCannotBypassPreparation(t *testing.T) {
	_, _, source := screenshotPreparationFixture(t)
	for _, kind := range []string{"image", " IMAGE ", "file"} {
		part := source
		part.Type = kind
		req, err := prepareModelGatewayImages(t.Context(), ModelGatewayRequest{Messages: []Message{{Role: "user", Content: []ContentPart{part}}}})
		if err != nil {
			t.Fatal(err)
		}
		got := req.Messages[0].Content[0]
		if got.Type != "image" || got.ModelImage == nil || got.FileURI == part.FileURI {
			t.Fatal("image path bypassed policy", kind)
		}
	}
	source.FileURI = "data:image/png;base64,not-valid"
	_, _, err := prepareModelImage(t.Context(), source)
	failure := providerTransportFailure(err, "deepseek")
	detail, ok := parseProviderFailure(failure.Error())
	if !ok || detail.Code != "image_preparation_failed" || detail.Stage != "image_preparation" || detail.Message == "" || flprovider.RetryAdviceForError(failure).Category != flprovider.RetryPermanent {
		t.Fatal("opaque preparation error", failure)
	}
}

func testModelImageURI(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestMCPImageExtractionPrecedesDisplayLimitAndRetainsCompletedEffect(t *testing.T) {
	var data bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 1024, 1024))
	noise := rand.New(rand.NewPCG(1, 2))
	for i := 0; i < len(img.Pix); i += 4 {
		n := noise.Uint64()
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = byte(n), byte(n>>8), byte(n>>16), 255
	}
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	if data.Len() < 1<<20 {
		t.Fatal("fixture does not exceed display limit")
	}
	calls := 0
	server := mcp.NewServer(&mcp.Implementation{Name: "images", Version: "1"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "capture", Description: "Capture fixture"}, func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, any, error) {
		calls++
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "before"}, &mcp.ImageContent{Data: data.Bytes(), MIMEType: "image/png"}, &mcp.TextContent{Text: "after"}}}, nil, nil
	})
	httpServer := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true}))
	defer httpServer.Close()
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Save(t.Context(), MCPServerInput{ID: "fixture", Name: "Fixture", Transport: "http", URL: httpServer.URL, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	saved := 0
	r := &run{mcpManager: manager, host: runHostCapabilities{saveToolMedia: func(ctx context.Context, a TargetToolAttachment, b []byte) error {
		saved++
		return validateToolMedia(a, b)
	}}}
	value, err := r.callMCPWithImages(t.Context(), manager.Tools()[0].Name, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	output := value.(toolExecutionOutput)
	raw, _ := json.Marshal(output.Payload)
	if calls != 1 || saved != 1 || len(output.Attachments) != 1 || bytes.Contains(raw, []byte("truncated")) || !bytes.Contains(raw, []byte("before")) || !bytes.Contains(raw, []byte("after")) {
		t.Fatal("MCP output lost", calls, saved, string(raw))
	}
	r.host.saveToolMedia = func(context.Context, TargetToolAttachment, []byte) error { return context.Canceled }
	value, err = r.callMCPWithImages(t.Context(), manager.Tools()[0].Name, map[string]any{})
	raw, _ = json.Marshal(value.(toolExecutionOutput).Payload)
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, errMCPEffectUnknown) || calls != 2 || !bytes.Contains(raw, []byte("invocation_completed")) {
		t.Fatal("completed MCP effect became replayable", err, string(raw))
	}
}
