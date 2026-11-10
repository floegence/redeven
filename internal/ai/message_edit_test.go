package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func awaitMessageEditTurn(t *testing.T, svc *Service, threadID string, turnID identity.TurnID) flruntime.ThreadView {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		view, err := svc.threadRuntime.View(ctx, identity.ThreadID(threadID))
		if err != nil {
			t.Fatal(err)
		}
		if view.TurnID == turnID && view.Activity == flruntime.ThreadActivityIdle {
			if view.Failure != nil {
				t.Fatalf("turn failed: %+v", view.Failure)
			}
			return view
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

func TestMessageEditPreservesResourcesHistoryAndReplay(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "edit message", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	action := &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: "assistant.ask.flower", Provider: "flower", Target: ContextActionTarget{TargetID: "current", Locality: "auto"}, Source: ContextActionSource{Surface: "flower_composer"}, Context: []ContextActionContextItem{{Kind: "text_snapshot", Title: "Captured text", Content: "FULL_CAPTURED_TEXT"}}}
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "original", ThreadID: thread.ThreadID, Input: RunInput{Text: "Original input", ContextAction: action}})
	if err != nil {
		t.Fatal(err)
	}
	awaitMessageEditTurn(t, svc, thread.ThreadID, identity.TurnID(sent.TurnID))
	draft, err := svc.GetMessageEditDraft(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Prompt != "Original input" || len(draft.References) != 1 || len(draft.ReferenceIDs) != 1 || draft.StorageGeneration != svc.storageGeneration {
		t.Fatalf("draft=%+v", draft)
	}
	raw, _ := json.Marshal(draft)
	if strings.Contains(string(raw), "resource_ref") || !strings.Contains(string(raw), "FULL_CAPTURED_TEXT") {
		t.Fatalf("public draft=%s", raw)
	}
	owner, _ := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	body, name := "NEW_ATTACHMENT_BODY", "edit.txt"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(body), DisplayName: name, UploadRequestID: "message-edit-upload", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(body))), ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	req := EditMessageRequest{ClientRequestID: "replace", StorageGeneration: svc.storageGeneration, ItemID: draft.ItemID, Content: EditQueuedContent{ExpectedInputFingerprint: draft.InputFingerprint, Text: "Replacement input", RetainedReferenceIDs: draft.ReferenceIDs, Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability}}
	ack, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, req)
	if err != nil {
		t.Fatal(err)
	}
	current := awaitMessageEditTurn(t, svc, thread.ThreadID, ack.TurnID)
	users := 0
	for _, item := range current.Items {
		if item.Kind == flruntime.ThreadItemUser {
			users++
			if item.Text != "Replacement input" || len(item.Attachments) != 1 || len(item.References) != 1 {
				t.Fatalf("replacement=%+v", item)
			}
		}
	}
	if users != 1 {
		t.Fatalf("active users=%d", users)
	}
	replay, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, req)
	if err != nil || replay != ack {
		t.Fatalf("replay=%+v %v", replay, err)
	}
	changed := req
	changed.Content.Text = "Changed payload"
	if _, err = svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, changed); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("changed replay=%v", err)
	}
	stale := req
	stale.ClientRequestID = "stale"
	if _, err = svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, stale); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("stale=%v", err)
	}
	latest, err := svc.GetMessageEditDraft(t.Context(), meta, thread.ThreadID)
	if err != nil || latest.RevisionRequestKey != "edit-message:replace" {
		t.Fatalf("latest=%+v %v", latest, err)
	}
	history, err := svc.GetMessageEditHistory(t.Context(), meta, thread.ThreadID, latest.RevisionRequestKey)
	if err != nil || history.Draft.Prompt != "Original input" {
		t.Fatalf("history=%+v %v", history, err)
	}
	restore := EditMessageRequest{ClientRequestID: "restore", StorageGeneration: svc.storageGeneration, ItemID: latest.ItemID, RestoreRevisionKey: latest.RevisionRequestKey, Content: EditQueuedContent{ExpectedInputFingerprint: latest.InputFingerprint, Text: history.Draft.Prompt, RetainedReferenceIDs: history.Draft.ReferenceIDs}}
	restored, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, restore)
	if err != nil {
		t.Fatal(err)
	}
	awaitMessageEditTurn(t, svc, thread.ThreadID, restored.TurnID)
	oldReplay, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, req)
	if err != nil || oldReplay != ack {
		t.Fatalf("old replay after another revision=%+v %v", oldReplay, err)
	}
}

func TestMessageEditRejectsAuthorizationAndStaleGeneration(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "protected", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	unauthorized := *meta
	unauthorized.CanExecute = false
	if _, err := svc.GetMessageEditDraft(t.Context(), &unauthorized, thread.ThreadID); err == nil {
		t.Fatal("draft leaked without authority")
	}
	if _, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, EditMessageRequest{StorageGeneration: "stale"}); !errors.Is(err, ErrFlowerStorageRestored) {
		t.Fatalf("restore fence=%v", err)
	}
	foreign := *meta
	foreign.EndpointID = "other"
	if _, err := svc.GetMessageEditDraft(t.Context(), &foreign, thread.ThreadID); err == nil {
		t.Fatal("cross-endpoint draft allowed")
	}
}

type uncertainMessageEditor struct {
	flruntime.ThreadService
	flruntime.ThreadMessageEditor
	flruntime.ThreadSummaryReader
}

func (s uncertainMessageEditor) EditLastUserMessage(ctx context.Context, in flruntime.EditLastUserMessageInput) (flruntime.ThreadCommandAck, error) {
	ack, err := s.ThreadMessageEditor.EditLastUserMessage(ctx, in)
	if err != nil {
		return ack, err
	}
	return flruntime.ThreadCommandAck{}, context.DeadlineExceeded
}
func TestMessageEditLostResponseReconcilesCanonicalRequest(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "lost response", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "original", ThreadID: thread.ThreadID, Input: RunInput{Text: "Original"}})
	if err != nil {
		t.Fatal(err)
	}
	awaitMessageEditTurn(t, svc, thread.ThreadID, identity.TurnID(sent.TurnID))
	draft, err := svc.GetMessageEditDraft(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	req := EditMessageRequest{ClientRequestID: "lost", StorageGeneration: svc.storageGeneration, ItemID: draft.ItemID, Content: EditQueuedContent{ExpectedInputFingerprint: draft.InputFingerprint, Text: "Edited"}}
	base := svc.threadRuntime
	svc.threadRuntime = uncertainMessageEditor{base, base.(flruntime.ThreadMessageEditor), base.(flruntime.ThreadSummaryReader)}
	if _, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, req); !errors.Is(err, ErrMessageEditUnconfirmed) {
		t.Fatalf("uncertainty=%v", err)
	}
	svc.threadRuntime = base
	ack, err := svc.EditLastUserMessage(t.Context(), meta, thread.ThreadID, req)
	if err != nil {
		t.Fatal(err)
	}
	current := awaitMessageEditTurn(t, svc, thread.ThreadID, ack.TurnID)
	users := 0
	for _, item := range current.Items {
		if item.Kind == flruntime.ThreadItemUser {
			users++
		}
	}
	if users != 1 {
		t.Fatalf("duplicate admitted users: %d", users)
	}
}
