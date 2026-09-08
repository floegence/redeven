package ai

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
)

func TestExistingThreadClaimsStagedAttachmentBeforeAdmission(t *testing.T) {
	for _, invalid := range []string{"valid", "initial", "capability", "target", "owner", "missing_scope", "missing_capability", "duplicate"} {
		t.Run(invalid, func(t *testing.T) {
			svc := newRealtimeTestService(t, time.Millisecond)
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "attachment", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
			if err != nil {
				t.Fatal(err)
			}
			scopeTarget := thread.ThreadID
			if invalid == "initial" {
				scopeTarget = "initial-attachment"
			}
			if invalid == "target" {
				scopeTarget = "another-thread"
			}
			if invalid == "owner" {
				owner, err = NewUploadOwner(meta.EndpointID, "another-user", meta.ChannelID)
				if err != nil {
					t.Fatal(err)
				}
			}
			scope, err := svc.CreateUploadStagingScope(t.Context(), owner, scopeTarget)
			if err != nil {
				t.Fatal(err)
			}
			content, name := "ATTACHMENT_ADMISSION_MARKER\n", "evidence.txt"
			upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(content), DisplayName: name, UploadRequestID: "upload-evidence", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(content))), ExpectedSizeBytes: int64(len(content)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
			if err != nil {
				t.Fatal(err)
			}
			capability := scope.Capability
			if invalid == "capability" {
				capability = "invalid"
			}
			req := SendUserTurnRequest{ClientRequestID: "attachment-turn", ThreadID: thread.ThreadID, StagingScopeID: scope.StagingScopeID, StagingCapability: capability, Input: RunInput{Text: "Read the attachment.", Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}}}
			if invalid == "initial" {
				req.ThreadID, req.ClientRequestID = "", ""
				req.Create = &CreateThreadRequest{ClientRequestID: scopeTarget, Title: "initial attachment", ModelID: thread.ModelID, WorkingDir: thread.WorkingDir}
			}
			if invalid == "missing_scope" {
				req.StagingScopeID = ""
			}
			if invalid == "missing_capability" {
				req.StagingCapability = ""
			}
			if invalid == "duplicate" {
				req.Input.Attachments = append(req.Input.Attachments, req.Input.Attachments[0])
			}
			response, err := svc.SendUserTurn(t.Context(), meta, req)
			if invalid != "valid" && invalid != "initial" {
				if err == nil {
					t.Fatal("unauthorized staging claim accepted")
				}
				view, viewErr := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
				if viewErr != nil || len(view.Items) != 0 {
					t.Fatalf("rejected input admitted: %+v %v", view, viewErr)
				}
				if _, err := svc.OpenStagingUpload(t.Context(), owner, scope.StagingScopeID, scope.Capability, upload.AttachmentID); err != nil {
					t.Fatalf("rejected input mutated upload: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("send staged attachment: %v", err)
			}
			if len(response.Current.Items) == 0 || len(response.Current.Items[0].Attachments) != 1 {
				t.Fatalf("missing canonical attachment: %+v", response.Current)
			}
			if _, err := svc.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, response.ThreadID, response.TurnID, upload.AttachmentID); err != nil {
				t.Fatalf("canonical attachment unreadable: %v", err)
			}
			replay, err := svc.SendUserTurn(t.Context(), meta, req)
			if err != nil || replay.TurnID != response.TurnID {
				t.Fatalf("retry: %+v %v", replay, err)
			}
		})
	}
}
