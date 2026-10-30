package ai

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestHistoricalImageManifestStaysInItsToolResult(t *testing.T) {
	descriptor, _, body, err := imageSnapshot(imageReadFixture(t, "png"), "history.png")
	if err != nil {
		t.Fatal(err)
	}
	r := &run{attachmentToolReadEnabled: true, host: runHostCapabilities{readToolMedia: func(context.Context, string) ([]byte, error) { return body, nil }}}
	attachment := flprovider.Attachment{ResourceRef: descriptor.ResourceRef, Name: descriptor.Name, MIMEType: descriptor.MIMEType, SizeBytes: descriptor.SizeBytes}
	provider := newFloretProviderAdapter(nil, "openai", "text-only", ProviderControls{}, TurnBudgets{}, "")
	messages, err := provider.floretMessagesToFlowerWithResolver(t.Context(), []flprovider.Message{{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "image-call", ToolName: "image.read", Text: "Image captured", Attachments: []flprovider.Attachment{attachment}}}}, r.resolveFloretToolMedia)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || len(messages[0].Content) != 1 {
		t.Fatalf("manifest escaped tool result: %+v", messages)
	}
	result := messages[0].Content[0]
	if result.Type != "tool_result" || result.ToolCallID != "image-call" || !strings.Contains(result.Text, "Image captured") || !strings.Contains(result.Text, "attachment.materialize") || !strings.Contains(result.Text, "media:v1:") || strings.Contains(result.Text, descriptor.ResourceRef) {
		t.Fatalf("tool image was rejected or lost attribution: %+v", result)
	}
	body[0] ^= 1
	if _, err := r.resolveFloretToolMedia(t.Context(), attachment); err == nil {
		t.Fatal("text manifest bypassed image integrity verification")
	}
}

func TestAttachmentsReachModelWithoutNativeSupport(t *testing.T) {
	for _, mime := range []string{"image/png", "application/pdf", "text/plain; charset=utf-8", "audio/wav", "video/mp4", "application/x-unknown", "application/octet-stream"} {
		for _, tools := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/tools=%v", mime, tools), func(t *testing.T) {
				const uploadID = "upl_aaaaaaaaaaaaaaaaaaaaaaaa"
				const name = "user-file"
				const body = "original attachment bytes"
				digest := fmt.Sprintf("%x", sha256.Sum256([]byte(body)))
				ref, err := immutableFloretUploadResourceRef(uploadID, digest)
				if err != nil {
					t.Fatal(err)
				}
				attachment := flruntime.MessageAttachment{ResourceRef: ref, Name: name, MIMEType: mime, SizeBytes: int64(len(body))}
				record := threadstore.UploadRecord{UploadID: uploadID, Name: name, DetectedMediaType: mime, SizeBytes: attachment.SizeBytes, ContentSHA256: digest, State: threadstore.UploadStateLive}
				r := &run{threadID: "thread", endpointID: "endpoint", userPublicID: "user", channelID: "channel"}
				r.product.getThreadOwnedUpload = func(context.Context, string) (*threadstore.UploadRecord, error) { return &record, nil }
				r.host.openLiveAttachment = func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error) {
					membership, err := canonicalUploadMembership(r.threadID, "turn", attachment)
					return openedCanonicalAttachment{Membership: membership, Upload: &OpenUploadResult{Info: &UploadResponse{AttachmentID: uploadID, Name: name, DetectedMediaType: mime, SizeBytes: attachment.SizeBytes, ContentSHA256: digest}}}, err
				}
				gateway := &recordingPreparedGateway{}
				provider := newFloretProviderAdapter(gateway, "openai", "text-only", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentToolRead(tools))
				_, frozen, err := r.preflightFloretTurnAttachments(t.Context(), flruntime.TurnInput{Text: "Inspect the file", Attachments: []flruntime.MessageAttachment{attachment}}, provider)
				if err != nil {
					t.Fatalf("attachment rejected before model: %v", err)
				}
				for _, preparedAttachments := range []map[string]frozenFloretAttachment{frozen, nil} {
					resolve := r.floretAttachmentResolver(preparedAttachments, provider)
					provider.attachmentResolver = func(ctx context.Context, a flprovider.Attachment) (ContentPart, error) {
						return resolve(ctx, runtimeAttachmentFromProvider(a))
					}
					prepared, err := provider.Prepare(t.Context(), flprovider.Request{RunID: "run", PromptScopeID: "thread", ReusePolicy: &flprovider.RequestReusePolicy{}, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "Inspect the file", Attachments: []flprovider.Attachment{{ResourceRef: ref, Name: name, MIMEType: mime, SizeBytes: attachment.SizeBytes}}}}})
					if err != nil {
						t.Fatalf("provider rejected attachment: %v", err)
					}
					stream, err := prepared.Stream(t.Context())
					if err != nil {
						t.Fatal(err)
					}
					for range stream {
					}
					if err := prepared.Close(); err != nil {
						t.Fatal(err)
					}
				}
				if len(gateway.requests) != 2 {
					t.Fatalf("model received %d requests", len(gateway.requests))
				}
				for _, request := range gateway.requests {
					var text strings.Builder
					for _, message := range request.Messages {
						for _, part := range message.Content {
							if part.Type != "text" {
								t.Fatalf("unsupported native payload sent: %+v", part)
							}
							text.WriteString(part.Text)
						}
					}
					manifest := text.String()
					for _, expected := range []string{name, mime, logicalAttachmentLocator(uploadID, name), "body is not included", "explain that limitation to the user"} {
						if !strings.Contains(manifest, expected) {
							t.Fatalf("model did not receive %q: %s", expected, manifest)
						}
					}
					if strings.Contains(manifest, "Use attachment.") != tools {
						t.Fatalf("manifest misstates tool availability: %s", manifest)
					}
					if strings.Contains(manifest, ref) || strings.Contains(manifest, body) {
						t.Fatalf("manifest leaked authority or claimed file content: %s", manifest)
					}
				}
			})
		}
	}
}
