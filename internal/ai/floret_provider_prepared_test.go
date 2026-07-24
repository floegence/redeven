package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
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

	prepared, err := adapter.PrepareModelRequest(context.Background(), flruntime.ModelRequest{
		Model: "gpt-test",
		Messages: []flruntime.ModelMessage{{
			Role: flruntime.ModelMessageRoleUser,
			Attachments: []flruntime.MessageAttachment{{
				ResourceRef: "redeven-upload:upl_123456789012345678901234:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				Name:        "notes.txt", MIMEType: "text/plain", SizeBytes: 24,
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
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
	if estimate.EstimatedInputTokens != int64(len(payload)) ||
		estimate.PrefixTokens+estimate.MessageTokens+estimate.ToolDefinitionTokens != estimate.EstimatedInputTokens ||
		estimate.Coverage != flruntime.ModelRequestTokenEstimateCoverageComplete ||
		estimate.Confidence != "conservative" || estimate.Method != "provider_rendered_payload" {
		t.Fatalf("prepared estimate = %#v, payload bytes = %d", estimate, len(payload))
	}
	if !strings.HasPrefix(prepared.RenderedPayloadFingerprint(), "sha256:") || len(prepared.RenderedPayloadFingerprint()) != len("sha256:")+64 {
		t.Fatalf("prepared fingerprint = %q", prepared.RenderedPayloadFingerprint())
	}

	stream, err := prepared.StreamModel(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for range stream {
	}
	if resolveCalls != 1 {
		t.Fatalf("attachment was re-resolved while streaming: calls=%d", resolveCalls)
	}
	if _, err := prepared.StreamModel(context.Background()); err == nil {
		t.Fatal("prepared request allowed a second stream")
	}
	if err := prepared.Close(); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Close(); err != nil {
		t.Fatalf("idempotent close: %v", err)
	}
	if handle.adapter != nil || handle.request.Model != "" {
		t.Fatalf("close retained rendered request: %#v", handle.request)
	}
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	if len(gateway.requests) != 1 {
		t.Fatalf("gateway requests = %d, want 1", len(gateway.requests))
	}
}

func TestAnthropicTextAttachmentDoesNotSilentlyTruncate(t *testing.T) {
	for _, body := range []string{
		strings.Repeat("a", 40_000) + "TAIL_SENTINEL",
		"  leading and trailing  \r\n",
		" \t\r\n  ",
		"第一行\r\n第二行🙂\r\n",
	} {
		messages := buildAnthropicMessages([]Message{{
			Role: "user",
			Content: []ContentPart{{
				Type: "file", Text: "long.txt", MimeType: "text/plain",
				FileURI: "data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte(body)),
			}},
		}})
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
