package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestImageReadRejectsAmbiguousLocatorInputsBeforeResourceAccess(t *testing.T) {
	r := &run{supportsImageInput: true}
	meta := &session.Meta{CanRead: true}
	for _, args := range []map[string]any{
		{},
		{"file_path": "image.png", "locator": "media:v1:" + strings.Repeat("a", 64)},
		{"locator": "media:v1:" + strings.Repeat("a", 64), "target_id": "remote"},
	} {
		_, err := r.toolImageRead(t.Context(), meta, "read", args)
		if err == nil || (!strings.Contains(err.Error(), "exactly one") && !strings.Contains(err.Error(), "target_id")) {
			t.Fatalf("args=%v err=%v", args, err)
		}
	}
}

func TestUploadedImageLocatorReusesCanonicalBytesAndTypedAttachment(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "gif", "webp"} {
		t.Run(format, func(t *testing.T) {
			svc := newRealtimeTestService(t, time.Millisecond)
			svc.cfg.Providers[0].Models[0] = config.AIProviderModel{ModelName: "gpt-5-mini", InputModalities: []string{"text", "image"}}
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Upload reread", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
			if err != nil {
				t.Fatal(err)
			}
			scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			body := imageReadFixture(t, format)
			name := "receipt." + format
			digest := fmt.Sprintf("%x", sha256.Sum256(body))
			upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: bytes.NewReader(body), DisplayName: name, UploadRequestID: "upload-image", ExpectedContentSHA256: digest, ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
			if err != nil {
				t.Fatal(err)
			}
			response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "admit-image", ThreadID: thread.ThreadID, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "Remember this image", Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}}})
			if err != nil {
				t.Fatal(err)
			}
			current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(response.ThreadID))
			if err != nil || len(current.Items) == 0 || len(current.Items[0].Attachments) != 1 {
				t.Fatalf("canonical attachment missing: %+v %v", current, err)
			}
			descriptor := current.Items[0].Attachments[0]
			locator, err := descriptor.Locator()
			if err != nil {
				t.Fatal(err)
			}
			r := &run{supportsImageInput: true, host: runHostCapabilities{readImageAttachment: func(ctx context.Context, meta *session.Meta, locator string) (canonicalImageSnapshot, error) {
				return svc.readCanonicalThreadImage(ctx, meta, thread.ThreadID, locator, "")
			}}}
			value, err := r.toolImageRead(t.Context(), meta, "reread", map[string]any{"locator": locator})
			if err != nil {
				t.Fatal(err)
			}
			output := value.(toolExecutionOutput)
			if len(output.Attachments) != 1 || output.Attachments[0].ResourceRef != descriptor.ResourceRef || output.Attachments[0].SHA256 != digest {
				t.Fatalf("reread copied or changed resource: %+v", output)
			}
			converted, err := floretToolResultFromFlower(r, ToolResult{ToolID: "reread", ToolName: "image.read", Status: toolResultStatusSuccess, Data: map[string]any{"display_name": name}, Attachments: output.Attachments})
			if err != nil || len(converted.Attachments) != 1 || converted.Attachments[0].ID != descriptor.ResourceRef {
				t.Fatalf("typed upload lost at gateway: %+v %v", converted, err)
			}
			if converted.Activity == nil || len(converted.Activity.TargetRefs) != 1 || converted.Activity.TargetRefs[0].ResourceRef != locator {
				t.Fatalf("upload reread lost authorized preview: %+v", converted.Activity)
			}
			snapshot, err := svc.readCanonicalThreadImage(t.Context(), meta, thread.ThreadID, locator, "")
			if err != nil || !bytes.Equal(snapshot.Body, body) {
				t.Fatalf("original image changed: %v", err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
			fork, err := svc.ForkThread(t.Context(), meta, thread.ThreadID, "Upload fork")
			if err != nil {
				t.Fatal(err)
			}
			forked, err := svc.readCanonicalThreadImage(t.Context(), meta, fork.ThreadID, locator, "")
			if err != nil || !bytes.Equal(forked.Body, body) {
				t.Fatalf("fork lost uploaded original: %v", err)
			}
			other, err := svc.CreateThread(t.Context(), meta, "Other", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.readCanonicalThreadImage(t.Context(), meta, other.ThreadID, locator, ""); err == nil {
				t.Fatal("locator granted cross-thread access")
			}
			foreign := *meta
			foreign.UserPublicID = "another-user"
			if _, err := svc.readCanonicalThreadImage(t.Context(), &foreign, thread.ThreadID, locator, ""); err == nil {
				t.Fatal("upload owner mismatch accepted")
			}
			opened, err := svc.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, thread.ThreadID, response.TurnID, upload.AttachmentID)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(opened.FilePath, []byte("corrupt"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.readCanonicalThreadImage(t.Context(), meta, thread.ThreadID, locator, ""); err == nil {
				t.Fatal("corrupt original accepted")
			}
			if err := os.Remove(opened.FilePath); err != nil {
				t.Fatal(err)
			}
			if _, err := r.toolImageRead(t.Context(), meta, "missing-reread", map[string]any{"locator": locator}); err == nil || strings.Contains(err.Error(), opened.FilePath) {
				t.Fatalf("missing original must fail without a storage path: %v", err)
			}
			if _, _, err := svc.ResolveToolImageForThread(t.Context(), meta, thread.ThreadID, locator); err == nil || strings.Contains(err.Error(), opened.FilePath) {
				t.Fatalf("missing preview must fail without a storage path: %v", err)
			}
		})
	}
}

func TestCanonicalImageMembershipIgnoresActivityAndQueue(t *testing.T) {
	a := flruntime.MessageAttachment{ResourceRef: "image://" + strings.Repeat("a", 64) + "/png", Name: "image.png", MIMEType: "image/png", SizeBytes: 1}
	view := flruntime.ThreadView{Items: []flruntime.ThreadItem{{Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{Presentation: &fltools.ActivityPresentation{TargetRefs: []fltools.ActivityTargetRef{{Kind: "tool_image", ResourceRef: a.ResourceRef}}}}}}}
	if _, _, err := findCanonicalThreadAttachment(view, "", func(item flruntime.MessageAttachment) bool { return item.ResourceRef == a.ResourceRef }); err == nil {
		t.Fatal("presentation granted ownership")
	}
	view.Queue = []flruntime.QueuedInput{{Input: flruntime.UserInput{Attachments: []flruntime.MessageAttachment{a}}}}
	if _, _, err := findCanonicalThreadAttachment(view, "", func(item flruntime.MessageAttachment) bool { return item.ResourceRef == a.ResourceRef }); err == nil {
		t.Fatal("queued resource granted admitted ownership")
	}
	view.Items[0].Attachments = []flruntime.MessageAttachment{a}
	if _, _, err := findCanonicalThreadAttachment(view, "", func(item flruntime.MessageAttachment) bool { return item.ResourceRef == a.ResourceRef }); err != nil {
		t.Fatal(err)
	}
}
