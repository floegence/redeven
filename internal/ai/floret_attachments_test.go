package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newFloretAttachmentTestRun(t *testing.T) (*run, *threadstore.Store, string) {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	uploadsDir := t.TempDir()
	r := newRun(runOptions{
		EndpointID: "env_attachment", ThreadID: "thread_attachment", RunID: "run_attachment", MessageID: "turn_attachment",
		ThreadsDB: store, UploadsDir: uploadsDir,
	})
	if err := store.CreateThread(context.Background(), threadstore.ThreadSettings{
		EndpointID: r.endpointID, ThreadID: r.threadID, PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	return r, store, uploadsDir
}

func insertFloretAttachmentUpload(t *testing.T, store *threadstore.Store, uploadsDir string, record threadstore.UploadRecord, body []byte, threadID string) {
	t.Helper()
	if record.StorageRelPath == "" {
		record.StorageRelPath = record.UploadID + ".data"
	}
	if record.State == "" {
		record.State = threadstore.UploadStateLive
	}
	if record.CreatedAtUnixMs <= 0 {
		record.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	if body != nil {
		if err := os.WriteFile(filepath.Join(uploadsDir, record.StorageRelPath), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.InsertUpload(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if threadID != "" {
		if err := store.BindUploadsToRef(context.Background(), record.EndpointID, threadID, threadstore.UploadRefKindThread, threadID, []string{record.UploadID}, time.Now().UnixMilli()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFloretTurnInputAllowsAttachmentOnlyAndRejectsInvalidResources(t *testing.T) {
	r, store, uploadsDir := newFloretAttachmentTestRun(t)
	insertFloretAttachmentUpload(t, store, uploadsDir, threadstore.UploadRecord{
		UploadID: "upl_only", EndpointID: r.endpointID, Name: "only.txt", MimeType: "text/plain", SizeBytes: 4,
	}, []byte("only"), "")

	input, err := r.floretTurnInput(context.Background(), RunInput{Attachments: []RunAttachmentIn{{
		Name: "ignored transport name", MimeType: "application/octet-stream", URL: "/_redeven_proxy/api/ai/uploads/upl_only",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if input.Text != "" || len(input.Attachments) != 1 {
		t.Fatalf("attachment-only input=%#v", input)
	}
	attachment := input.Attachments[0]
	if attachment.ResourceRef != "redeven-upload:upl_only" || attachment.Name != "only.txt" || attachment.MIMEType != "text/plain" || attachment.SizeBytes != 4 {
		t.Fatalf("canonical attachment=%#v", attachment)
	}
	if _, err := r.floretTurnInput(context.Background(), RunInput{}); err == nil {
		t.Fatal("empty text and attachment list was accepted")
	}
	if _, err := r.floretTurnInput(context.Background(), RunInput{Attachments: []RunAttachmentIn{{URL: "/_redeven_proxy/api/ai/uploads/upl_missing"}}}); err == nil || !strings.Contains(err.Error(), "load attachment") {
		t.Fatalf("missing attachment error=%v", err)
	}
	insertFloretAttachmentUpload(t, store, uploadsDir, threadstore.UploadRecord{
		UploadID: "upl_large", EndpointID: r.endpointID, Name: "large.bin", MimeType: "application/octet-stream", SizeBytes: floretAttachmentMaxBytes + 1,
	}, nil, "")
	if _, err := r.floretTurnInput(context.Background(), RunInput{Attachments: []RunAttachmentIn{{URL: "/_redeven_proxy/api/ai/uploads/upl_large"}}}); err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("oversized attachment error=%v", err)
	}
}

func TestResolveFloretMessageAttachmentProjectsImageAndFailsClosed(t *testing.T) {
	r, store, uploadsDir := newFloretAttachmentTestRun(t)
	body := []byte("png-bytes")
	record := threadstore.UploadRecord{
		UploadID: "upl_image", EndpointID: r.endpointID, Name: "image.png", MimeType: "image/png", SizeBytes: int64(len(body)),
	}
	insertFloretAttachmentUpload(t, store, uploadsDir, record, body, r.threadID)
	attachment := flruntime.MessageAttachment{
		ResourceRef: "redeven-upload:upl_image", Name: record.Name, MIMEType: record.MimeType, SizeBytes: record.SizeBytes,
	}
	part, err := r.resolveFloretMessageAttachment(context.Background(), attachment)
	if err != nil {
		t.Fatal(err)
	}
	if part.Type != "image" || part.Text != "image.png" || part.MimeType != "image/png" || !strings.HasPrefix(part.FileURI, "data:image/png;base64,") {
		t.Fatalf("resolved image part=%#v", part)
	}
	mismatched := attachment
	mismatched.Name = "different.png"
	if _, err := r.resolveFloretMessageAttachment(context.Background(), mismatched); err == nil || !strings.Contains(err.Error(), "metadata differs") {
		t.Fatalf("metadata mismatch error=%v", err)
	}
	if err := os.Remove(filepath.Join(uploadsDir, record.UploadID+".data")); err != nil {
		t.Fatal(err)
	}
	if _, err := r.resolveFloretMessageAttachment(context.Background(), attachment); err == nil || !strings.Contains(err.Error(), "read attachment resource") {
		t.Fatalf("missing file error=%v", err)
	}
	if _, err := r.resolveFloretMessageAttachment(context.Background(), flruntime.MessageAttachment{ResourceRef: "https://example.invalid/file"}); err == nil || !strings.Contains(err.Error(), "unsupported attachment resource reference") {
		t.Fatalf("unsupported resource ref error=%v", err)
	}
}

func TestFloretProviderAttachmentProjectionRequiresCapabilitiesAndSupportedMIME(t *testing.T) {
	message := flruntime.ModelMessage{
		Role: flruntime.ModelMessageRoleUser,
		Attachments: []flruntime.MessageAttachment{{
			ResourceRef: "redeven-upload:upl_image", Name: "image.png", MIMEType: "image/png", SizeBytes: 4,
		}},
	}
	imageResolver := func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
		return ContentPart{Type: "image", Text: "image.png", MimeType: "image/png", FileURI: "data:image/png;base64,cG5n"}, nil
	}
	unsupportedModel := newFloretProviderAdapter(nil, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentResolver(imageResolver, false, false))
	if _, err := unsupportedModel.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{message}); err == nil || !strings.Contains(err.Error(), "does not support image input") {
		t.Fatalf("unsupported image model error=%v", err)
	}
	supportedModel := newFloretProviderAdapter(nil, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentResolver(imageResolver, true, false))
	messages, err := supportedModel.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{message})
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || len(messages[0].Content) != 1 || messages[0].Content[0].Type != "image" {
		t.Fatalf("projected messages=%#v", messages)
	}
	unsupportedMIME := newFloretProviderAdapter(nil, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentResolver(func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
		return ContentPart{Type: "image", Text: "vector.svg", MimeType: "image/svg+xml", FileURI: "data:image/svg+xml;base64,PHN2Zy8+"}, nil
	}, true, false))
	if _, err := unsupportedMIME.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{message}); err == nil || !strings.Contains(err.Error(), "unsupported image MIME") {
		t.Fatalf("unsupported MIME error=%v", err)
	}
	unsupportedRoute := newFloretProviderAdapter(nil, "openai_compatible", "gpt-test", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentResolver(func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
		return ContentPart{Type: "file", Text: "notes.txt", MimeType: "text/plain", FileURI: "data:text/plain;base64,bm90ZXM="}, nil
	}, false, true))
	if _, err := unsupportedRoute.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{message}); err == nil || !strings.Contains(err.Error(), "does not support file input") {
		t.Fatalf("unsupported provider route error=%v", err)
	}
}

func TestRunFloretHostedTurnRejectsInvalidAttachmentBeforeAdmission(t *testing.T) {
	testCases := []struct {
		name         string
		mimeType     string
		body         []byte
		sizeBytes    int64
		providerType string
		capability   contextmodel.ModelCapability
		want         string
	}{
		{
			name: "missing physical file", mimeType: "text/plain", sizeBytes: 4, providerType: "openai",
			capability: contextmodel.ModelCapability{SupportsFileInput: true}, want: "read attachment resource",
		},
		{
			name: "unsupported image model", mimeType: "image/png", body: []byte("png"), providerType: "openai",
			capability: contextmodel.ModelCapability{}, want: "does not support image input",
		},
		{
			name: "unsupported image MIME", mimeType: "image/svg+xml", body: []byte("svg"), providerType: "openai",
			capability: contextmodel.ModelCapability{SupportsImageInput: true}, want: "unsupported image MIME",
		},
		{
			name: "unsupported provider route", mimeType: "text/plain", body: []byte("text"), providerType: "openai_compatible",
			capability: contextmodel.ModelCapability{SupportsFileInput: true}, want: "provider route",
		},
		{
			name: "oversized attachment", mimeType: "application/pdf", sizeBytes: floretAttachmentMaxBytes + 1, providerType: "openai",
			capability: contextmodel.ModelCapability{SupportsFileInput: true}, want: "size limit",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			floretStore := flruntime.NewMemoryStore()
			t.Cleanup(func() { _ = floretStore.Close() })
			uploadsDir := t.TempDir()
			r := newFloretRuntimeTestRun(t, runOptions{
				Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
				StateDir:     t.TempDir(),
				AgentHomeDir: t.TempDir(),
				UploadsDir:   uploadsDir,
				Shell:        "bash",
				AIConfig:     &config.AIConfig{},
				SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
				RunID:        "run_preflight_attachment",
				ThreadID:     "thread_preflight_attachment",
				MessageID:    "turn_preflight_attachment",
				FloretStore:  floretStore,
			})
			r.service = &Service{threadsDB: r.threadsDB, persistOpTO: time.Second}

			body := testCase.body
			sizeBytes := testCase.sizeBytes
			if sizeBytes == 0 {
				sizeBytes = int64(len(body))
			}
			record := threadstore.UploadRecord{
				UploadID: "upl_preflight", EndpointID: r.endpointID, Name: "attachment", MimeType: testCase.mimeType, SizeBytes: sizeBytes,
			}
			insertFloretAttachmentUpload(t, r.threadsDB, uploadsDir, record, body, "")
			const commandID = "queue_preflight_attachment"
			if _, _, _, err := r.threadsDB.CreateFollowupWithUploadRefs(context.Background(), threadstore.QueuedTurn{
				QueueID: commandID, EndpointID: r.endpointID, ThreadID: r.threadID, ChannelID: "channel_preflight_attachment",
				Lane: threadstore.FollowupLaneQueued, TurnID: r.messageID, RunID: r.id, TextContent: "inspect attachment",
			}, []string{record.UploadID}, time.Now().UnixMilli()); err != nil {
				t.Fatal(err)
			}
			r.setPendingTurnCommand(commandID)

			provider := &capturingTurnProvider{}
			err := r.runFloretHostedTurn(t.Context(), RunRequest{
				Model: "compat/gpt-test",
				Input: RunInput{Text: "inspect attachment", Attachments: []RunAttachmentIn{{
					URL: "/_redeven_proxy/api/ai/uploads/" + record.UploadID,
				}}},
				Options:         RunOptions{PermissionType: config.AIPermissionFullAccess},
				ModelCapability: testCase.capability,
			}, config.AIProvider{ID: "compat", Type: testCase.providerType, BaseURL: "https://example.test/v1"}, "sk-test", "inspect attachment", provider)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("runFloretHostedTurn error=%v, want %q", err, testCase.want)
			}
			if provider.requestCount() != 0 {
				t.Fatalf("provider request count=%d, want 0", provider.requestCount())
			}
			host, err := flruntime.NewThreadMaintenanceHost(flruntime.ThreadMaintenanceHostOptions{Store: floretStore})
			if err != nil {
				t.Fatal(err)
			}
			overview, err := host.ReadThreadOverview(context.Background(), flruntime.ThreadID(r.threadID))
			if err != nil {
				t.Fatal(err)
			}
			if overview.LatestTurn != nil {
				t.Fatalf("invalid attachment was admitted: %#v", overview.LatestTurn)
			}
			queued, err := r.threadsDB.GetQueuedTurn(context.Background(), r.endpointID, r.threadID, commandID)
			if err != nil || queued == nil {
				t.Fatalf("queued command was not preserved: queued=%#v error=%v", queued, err)
			}
		})
	}
}
