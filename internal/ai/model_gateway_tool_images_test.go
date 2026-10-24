package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestProductionProvidersPreservePairedToolImagesAndNativeBudget(t *testing.T) {
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	// The large valid transport must be budgeted as native image content, never
	// as base64 prose. DecodeConfig still reads the exact 16 by 16 pixel header.
	data := append(pixels.Bytes(), bytes.Repeat([]byte{0x52, 0x6a, 0x91}, 400_000)...)
	uri := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	for _, tc := range []struct{ provider, model string }{
		{"openai", "gpt-5-mini"},
		{"kimi_code", "k3.1-pro"},
		{"openai_compatible", "gpt-4o"},
		{"anthropic", "claude-sonnet"},
		{"deepseek", "deepseek-v4-flash-vision-exp"},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			wire := make(chan []byte, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				wire <- raw
				if tc.provider == "anthropic" {
					r.Body = io.NopCloser(bytes.NewReader(raw))
					(&anthropicMock{token: "inspected"}).handle(w, r)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/responses") {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"native-tool-images\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"inspected\"}]}]}}\n\n")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"id\":\"chat-native-images\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"inspected\"},\"finish_reason\":null}]}\n\n")
				fmt.Fprint(w, "data: {\"id\":\"chat-native-images\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer server.Close()
			key := "sk-test"
			if tc.provider == "anthropic" {
				key = "sk-ant-test"
			}
			base, err := newProviderAdapter(tc.provider, server.URL+"/v1", key, nil)
			if err != nil {
				t.Fatal(err)
			}
			adapter := newFloretProviderAdapter(base, tc.provider, tc.model, ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
			adapter.supportsImageInput = true
			resolutions := 0
			adapter.attachmentResolver = func(context.Context, flprovider.Attachment) (ContentPart, error) {
				resolutions++
				return ContentPart{Type: "image", FileURI: uri, MimeType: "image/png"}, nil
			}
			attachment := func(suffix byte) flprovider.Attachment {
				return flprovider.Attachment{ResourceRef: "image://" + strings.Repeat(string(suffix), 64) + "/png", MIMEType: "image/png", Name: "read.png", SizeBytes: int64(len(data))}
			}
			request := flprovider.Request{RunID: "run-images", PromptScopeID: "scope-images", Messages: []flprovider.Message{
				{Role: flprovider.RoleAssistant, ToolCalls: []flprovider.ToolCall{
					{ID: "first", Name: "image.read", Args: `{"file_path":"first.png"}`},
					{ID: "second", Name: "image.read", Args: `{"file_path":"second.png"}`},
				}},
				{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "first", ToolName: "image.read", Text: "first image pair", Attachments: []flprovider.Attachment{attachment('a'), attachment('b')}}},
				{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "second", ToolName: "image.read", Text: "second image", Attachments: []flprovider.Attachment{attachment('c')}}},
			}}
			prepared, err := adapter.Prepare(t.Context(), request)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			estimate := prepared.TokenEstimate()
			if estimate.AttachmentTokens <= 0 || estimate.AttachmentTokens > estimate.MessageTokens || estimate.EstimatedInputTokens <= estimate.AttachmentTokens || estimate.EstimatedInputTokens > 8_000 || estimate.Coverage != "complete_request" || estimate.Breakdown.Quality != "token_estimate" || estimate.Breakdown.AttributionCoverage != "partial" || estimate.Breakdown.AttachmentTokens != 0 {
				t.Fatalf("native tool images escaped the complete visual budget: %+v", estimate)
			}
			uri = strings.Replace(uri, "data:image/png", "data:image/jpeg", 1)
			stream, err := prepared.Stream(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			var done bool
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
				done = done || event.Type == flprovider.EventDone
			}
			actual := <-wire
			uri = strings.Replace(uri, "data:image/jpeg", "data:image/png", 1)
			if !done || resolutions != 3 || bytes.Count(actual, []byte(base64.StdEncoding.EncodeToString(data))) != 3 || prepared.RenderedPayloadFingerprint() != fmt.Sprintf("sha256:%x", sha256.Sum256(actual)) {
				t.Fatal("tool image bytes, count, preparation identity, or completion changed")
			}
			var body struct {
				Input    []map[string]any `json:"input"`
				Messages []map[string]any `json:"messages"`
			}
			if err := json.Unmarshal(actual, &body); err != nil {
				t.Fatal(err)
			}
			switch tc.provider {
			case "openai", "kimi_code", "deepseek":
				outputs := 0
				for _, item := range body.Input {
					if item["type"] != "function_call_output" {
						continue
					}
					outputs++
					content, ok := item["output"].([]any)
					if !ok {
						t.Fatal("native tool images became a string function output")
					}
					images := 0
					for _, value := range content {
						part := value.(map[string]any)
						if part["type"] == "input_image" {
							images++
						}
					}
					if (item["call_id"] == "first" && images != 2) || (item["call_id"] == "second" && images != 1) {
						t.Fatal("function output images lost their tool call identity")
					}
				}
				if outputs != 2 {
					t.Fatalf("paired function outputs=%d", outputs)
				}
			case "openai_compatible":
				if len(body.Messages) != 4 || body.Messages[1]["role"] != "tool" || body.Messages[1]["tool_call_id"] != "first" || body.Messages[2]["role"] != "tool" || body.Messages[2]["tool_call_id"] != "second" || body.Messages[3]["role"] != "user" {
					t.Fatal("Chat native images interrupted the parallel tool result group")
				}
				content := body.Messages[3]["content"].([]any)
				if len(content) != 5 || !strings.Contains(content[0].(map[string]any)["text"].(string), "first") || !strings.Contains(content[3].(map[string]any)["text"].(string), "second") {
					t.Fatal("Chat multi-image call order or provenance changed")
				}
			case "anthropic":
				uses := body.Messages[0]["content"].([]any)
				if len(uses) != 2 || uses[0].(map[string]any)["type"] != "tool_use" || uses[1].(map[string]any)["type"] != "tool_use" {
					t.Fatal("Anthropic lost the assistant tool-use pair")
				}
				for i, message := range body.Messages[1:] {
					blocks := message["content"].([]any)
					result := blocks[0].(map[string]any)
					parts := result["content"].([]any)
					if len(blocks) != 1 || result["type"] != "tool_result" || len(parts) != 3-i {
						t.Fatal("Anthropic image is outside its canonical tool result")
					}
				}
			}
		})
	}
}

func TestGatewayAttachmentsRejectUnknownRoute(t *testing.T) {
	if err := validateGatewayAttachmentParts([]Message{{Role: "tool", Content: []ContentPart{{Type: "image", FileURI: "data:image/png;base64,AQID", MimeType: "image/png"}}}}, "unsupported-route"); err == nil {
		t.Fatal("unknown wire route silently accepted native image input")
	}
}

func TestResponsesToolOutputPreservesNativeFile(t *testing.T) {
	messages := []Message{{Role: "tool", Content: []ContentPart{
		{Type: "file", FileURI: "data:application/pdf;base64,AQID", MimeType: "application/pdf", Text: "evidence.pdf"},
		{Type: "tool_result", ToolCallID: "pdf", Text: "read PDF"},
	}}}
	input, _, err := buildOpenAIInput(messages, providerToolAliases{})
	if err != nil {
		t.Fatal(err)
	}
	output := input[0].OfFunctionCallOutput.Output.OfResponseFunctionCallOutputItemArray
	if len(output) != 2 || output[0].OfInputFile == nil || output[0].OfInputFile.FileData.Value != "AQID" || output[0].OfInputFile.Filename.Value != "evidence.pdf" {
		t.Fatal("Responses discarded typed file output")
	}
}
