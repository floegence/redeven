package ai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type recordingPreparedGateway struct {
	mu       sync.Mutex
	requests []ModelGatewayRequest
}

func (g *recordingPreparedGateway) StreamTurn(_ context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	g.mu.Lock()
	g.requests = append(g.requests, req)
	g.mu.Unlock()
	if onEvent != nil {
		onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "ok"})
	}
	return ModelGatewayResult{FinishReason: "stop", Text: "ok"}, nil
}

func TestFloretProviderPreparedRequestFreezesCompleteRenderedPayload(t *testing.T) {
	gateway := &recordingPreparedGateway{}
	resolveCalls := 0
	adapter := newFloretProviderAdapter(
		gateway,
		"openai",
		"gpt-test",
		ProviderControls{},
		TurnBudgets{},
		"",
		withFloretAttachmentResolver(func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
			resolveCalls++
			return ContentPart{
				Type: "file", Text: "notes.txt", MimeType: "text/plain",
				FileURI: "data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte("complete attachment body")),
			}, nil
		}, false, true),
	)

	prepared, err := adapter.Prepare(context.Background(), flprovider.Request{
		RunID: "run-prepared", PromptScopeID: "scope-prepared",
		ReusePolicy: &flprovider.RequestReusePolicy{},

		Messages: []flprovider.Message{{
			Role: flprovider.RoleUser,
			Attachments: []flprovider.Attachment{{
				ResourceRef: "redeven-upload:upl_123456789012345678901234:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				Name:        "notes.txt", MIMEType: "text/plain", SizeBytes: 24,
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	original := prepared.RenderedPayloadFingerprint()
	fitted, err := prepared.(flprovider.PreparedRequestOutputLimiter).WithMaxOutputTokens(t.Context(), 1234)
	if err != nil {
		t.Fatal(err)
	}
	if resolveCalls != 1 || prepared.RenderedPayloadFingerprint() != original || fitted.RenderedPayloadFingerprint() == original {
		t.Fatal("output refit changed or reread frozen input")
	}
	if err := prepared.Close(); err != nil {
		t.Fatal(err)
	}
	prepared = fitted
	handle, ok := prepared.(*preparedFloretModelRequest)
	if !ok {
		t.Fatalf("prepared request type = %T", prepared)
	}

	if resolveCalls != 1 {
		t.Fatalf("attachment resolve calls = %d, want 1", resolveCalls)
	}
	payload, err := json.Marshal(handle.request)
	if err != nil {
		t.Fatal(err)
	}
	estimate := prepared.TokenEstimate()
	if estimate.EstimatedInputTokens <= 0 ||
		estimate.PrefixTokens+estimate.MessageTokens+estimate.ToolDefinitionTokens != estimate.EstimatedInputTokens ||
		estimate.Coverage != "complete_request" ||
		estimate.Confidence != "approximate" || estimate.Method != "generic_payload_estimate" {
		t.Fatalf("prepared estimate = %#v, payload bytes = %d", estimate, len(payload))
	}
	if !strings.HasPrefix(prepared.RenderedPayloadFingerprint(), "sha256:") || len(prepared.RenderedPayloadFingerprint()) != len("sha256:")+64 {
		t.Fatalf("prepared fingerprint = %q", prepared.RenderedPayloadFingerprint())
	}

	stream, err := prepared.Stream(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for range stream {
	}
	if resolveCalls != 1 {
		t.Fatalf("attachment was re-resolved while streaming: calls=%d", resolveCalls)
	}
	if _, err := prepared.Stream(context.Background()); err == nil {
		t.Fatal("prepared request allowed a second stream")
	}
	if err := prepared.Close(); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Close(); err != nil {
		t.Fatalf("idempotent close: %v", err)
	}
	next := handle.providerRequest
	next.AttemptID = "replacement"
	next.AttemptEpoch = 2
	replay, err := handle.PrepareRetry(t.Context(), next)
	if err != nil {
		t.Fatal(err)
	}
	if replay.RenderedPayloadFingerprint() != prepared.RenderedPayloadFingerprint() || !reflect.DeepEqual(replay.TokenEstimate(), estimate) {
		t.Fatal("retry changed finalized request fingerprint or estimate")
	}
	replayStream, err := replay.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for range replayStream {
	}
	if err := replay.Close(); err != nil {
		t.Fatal(err)
	}
	if resolveCalls != 1 {
		t.Fatalf("retry resolved attachments %d times", resolveCalls)
	}
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	if len(gateway.requests) != 2 {
		t.Fatalf("rendered model requests = %d, want 2", len(gateway.requests))
	}
	for _, request := range gateway.requests {
		if request.Budgets.MaxOutputToken != 1234 {
			t.Fatalf("retry lost finalized output limit: %d", request.Budgets.MaxOutputToken)
		}
	}
	if len(gateway.requests) != 2 || (gateway.requests[0].ReusePolicy == nil || gateway.requests[0].ReusePolicy.ProviderStateAllowed || gateway.requests[0].ReusePolicy.PromptCacheEnabled || gateway.requests[0].ReusePolicy.PreferContinuation) {
		t.Fatalf("prepared isolation lost: %+v", gateway.requests[0].ReusePolicy)
	}
}

func TestAnthropicTextAttachmentDoesNotSilentlyTruncate(t *testing.T) {
	for _, body := range []string{
		strings.Repeat("a", 40_000) + "TAIL_SENTINEL",
		"  leading and trailing  \r\n",
		" \t\r\n  ",
		"第一行\r\n第二行🙂\r\n",
	} {
		messages, err := buildAnthropicMessages([]Message{{
			Role: "user",
			Content: []ContentPart{{
				Type: "file", Text: "long.txt", MimeType: "text/plain",
				FileURI: "data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte(body)),
			}},
		}})
		if err != nil {
			t.Fatal(err)
		}
		if len(messages) != 1 || len(messages[0].Content) != 1 || messages[0].Content[0].OfDocument == nil || messages[0].Content[0].OfDocument.Source.OfText == nil {
			t.Fatalf("Anthropic text attachment did not produce one plain-text document: %#v", messages)
		}
		if got := messages[0].Content[0].OfDocument.Source.OfText.Data; got != body {
			t.Fatalf("Anthropic text attachment changed UTF-8 content: got %q, want %q", got, body)
		}
		raw, err := json.Marshal(messages)
		if err != nil {
			t.Fatal(err)
		}
		var wire []struct {
			Content []struct {
				Source struct {
					Data string `json:"data"`
				} `json:"source"`
			} `json:"content"`
		}
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		if len(wire) != 1 || len(wire[0].Content) != 1 || wire[0].Content[0].Source.Data != body {
			t.Fatalf("Anthropic wire payload changed UTF-8 content: %s", raw)
		}
	}
}

var _ ModelGateway = (*recordingPreparedGateway)(nil)

func TestDeepSeekPreparedDesktopImageUsesUpstreamBudgetAndExactBody(t *testing.T) {
	data, frameAttachment, original := screenshotPreparationFixture(t)
	modelPart, _, err := prepareModelScreenshot(t.Context(), frameAttachment, original, false)
	if err != nil {
		t.Fatal(err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	var sent []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		sent, err = io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"desktop-budget\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"observed\"}]}]}}\n\n")
	}))
	defer server.Close()
	base, err := newProviderAdapter("deepseek", server.URL, "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	resolutions, admissions, releases := 0, 0, 0
	adapter := newFloretProviderAdapter(base, "deepseek", "deepseek-v4-flash-vision-exp", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled,
		withFloretRequestAdmission(func(ctx context.Context, _ flprovider.Request) (context.Context, func(), error) {
			admissions++
			return ctx, func() { releases++ }, nil
		}))
	adapter.supportsImageInput = true
	adapter.attachmentResolver = func(context.Context, flprovider.Attachment) (ContentPart, error) {
		resolutions++
		return ContentPart{Type: "image", FileURI: dataURL, MimeType: "image/png"}, nil
	}
	request := flprovider.Request{RunID: "run", PromptScopeID: "scope", Messages: []flprovider.Message{
		{Role: flprovider.RoleAssistant, ToolCalls: []flprovider.ToolCall{{ID: "screen", Name: "computer.screenshot", Args: "{}"}}},
		{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "screen", ToolName: "computer.screenshot", Text: "captured", Attachments: []flprovider.Attachment{{ResourceRef: "computer://desktop-main/" + strings.Repeat("a", 64), MIMEType: "image/png", SizeBytes: int64(len(data))}}}},
	}}
	for _, tool := range builtInToolDefinitions() {
		var schema map[string]any
		if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		request.Tools = append(request.Tools, fltools.ToolDefinition{Name: tool.Name, Description: tool.Description, InputSchema: schema})
	}
	prepared, err := adapter.Prepare(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	estimate := prepared.TokenEstimate()
	if estimate.EstimatedInputTokens < 1024 || estimate.EstimatedInputTokens > 200000 || estimate.Source != "rendered_deepseek_v4_content_v5" || estimate.Breakdown.Quality != "token_estimate" || estimate.Breakdown.AttributionCoverage != "partial" || estimate.Breakdown.AttachmentTokens != 0 || estimate.AttachmentTokens < 1024 {
		t.Fatalf("desktop image did not use upstream visual estimate: %+v", estimate)
	}
	if admissions != 0 || resolutions != 1 {
		t.Fatal("preparation must resolve once without sending or acquiring admission")
	}
	if estimate.Breakdown.Details == nil || len(estimate.Breakdown.Details.Items) == 0 {
		t.Fatal("missing tool source details")
	}
	estimate.Breakdown.Details.Items[0].Key = "mutated-by-consumer"
	if prepared.TokenEstimate().Breakdown.Details.Items[0].Key == "mutated-by-consumer" {
		t.Fatal("consumer mutation changed prepared estimate")
	}
	dataURL = "data:image/png;base64,AQID"
	stream, err := prepared.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var done bool
	for event := range stream {
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		if event.Type == flprovider.EventDone {
			done = true
		}
	}
	if !done || resolutions != 1 || admissions != 1 || releases != 1 {
		t.Fatal("prepared stream changed admission, resolution, or terminal behavior")
	}
	if prepared.RenderedPayloadFingerprint() != fmt.Sprintf("sha256:%x", sha256.Sum256(sent)) {
		t.Fatal("budget fingerprint differs from the transmitted body")
	}
	if !strings.Contains(string(sent), strings.TrimPrefix(modelPart.FileURI, "data:image/jpeg;base64,")) || !strings.Contains(string(sent), `"type":"input_image"`) {
		t.Fatal("prepared desktop encoding changed before transmission")
	}
	if _, err := prepared.Stream(t.Context()); err == nil {
		t.Fatal("allowed prepared request replay")
	}
}

func TestPreparedEstimateExcludesHostMetadata(t *testing.T) {
	adapter := newFloretProviderAdapter(&recordingPreparedGateway{}, "openai", "gpt-4o", ProviderControls{}, TurnBudgets{}, "")
	count := func(runID flidentity.RunID) int64 {
		t.Helper()
		p, err := adapter.Prepare(context.Background(), flprovider.Request{RunID: runID, PromptScopeID: "scope-estimate",
			Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: strings.Repeat("Review the source code and explain the changes.\n", 100)}}})
		if err != nil {
			t.Fatal(err)
		}
		defer p.Close()
		return p.TokenEstimate().EstimatedInputTokens
	}
	short, long := count("run-a"), count(flidentity.RunID(strings.Repeat("host-only-id", 10)))
	if short != long {
		t.Fatalf("host metadata changed model estimate: %d -> %d", short, long)
	}
	if short >= 2300 {
		t.Fatalf("text estimate still inflated: %d", short)
	}
}
