package ai

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestQueuedDraftPreservesSnapshotsAndCopiesAttachmentsForOrdinarySend(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "take back", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{Text: "original", References: []flruntime.MessageReference{
		{ReferenceID: "text", Kind: flruntime.MessageReferenceText, Label: "Selected text", Text: "original text"},
		{ReferenceID: "terminal", Kind: flruntime.MessageReferenceTerminal, Label: "Terminal", Text: "captured output", Truncated: true},
		{ReferenceID: "process", Kind: flruntime.MessageReferenceProcess, Label: "Process", Text: "captured process"},
	}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "draft", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	owner, _ := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	body, name := "QUEUED_ATTACHMENT_BODY\n", "notes.txt"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(body), DisplayName: name, UploadRequestID: "original-upload", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(body))), ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:draft", EditQueuedInputRequest{ClientRequestID: "attach", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(original), Text: original.Text, RetainedReferenceIDs: []string{"text", "terminal", "process"}, Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability}})
	if err != nil {
		t.Fatal(err)
	}
	original = updated.Queue[0].Input
	req := QueuedDraftRequest{ExpectedInputFingerprint: queuedInputFingerprint(original), StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability}
	draft, err := svc.PrepareQueuedDraft(t.Context(), meta, thread.ThreadID, "queue:draft", req)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Prompt != original.Text || len(draft.References) != 3 || len(draft.Attachments) != 1 || draft.Attachments[0].AttachmentID == upload.AttachmentID {
		t.Fatalf("draft=%+v", draft)
	}
	replayed, err := svc.PrepareQueuedDraft(t.Context(), meta, thread.ThreadID, "queue:draft", req)
	if err != nil || !reflect.DeepEqual(draft, replayed) {
		t.Fatalf("repeated preparation=%+v err=%v", replayed, err)
	}
	projection, err := floretContextProjectionForInput(RunInput{ContextAction: &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: contextActionAskFlowerID, Provider: contextActionFlowerProvider, Target: ContextActionTarget{TargetID: "current", Locality: "auto"}, Source: ContextActionSource{Surface: contextActionSurfaceComposer}, Context: draft.References}}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for index, reference := range projection.References {
		want := original.References[index]
		reference.ReferenceID = want.ReferenceID
		if !reflect.DeepEqual(reference, want) {
			t.Fatalf("restored reference=%+v want=%+v", reference, want)
		}
	}
	for range 2 {
		current, err := svc.TakeBackQueuedInput(t.Context(), meta, thread.ThreadID, "queue:draft", req.ExpectedInputFingerprint)
		if err != nil || len(current.Queue) != 0 {
			t.Fatalf("take back=%+v err=%v", current, err)
		}
	}
	opened, err := svc.OpenStagingUpload(t.Context(), owner, scope.StagingScopeID, scope.Capability, draft.Attachments[0].AttachmentID)
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(opened.FilePath)
	if err != nil || string(content) != body {
		t.Fatalf("copied attachment=%q err=%v", content, err)
	}
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "send-restored", ThreadID: thread.ThreadID, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "revised", Attachments: []RunAttachmentIn{{AttachmentID: draft.Attachments[0].AttachmentID}}}})
	if err != nil || len(sent.Current.Items) == 0 || len(sent.Current.Items[0].Attachments) != 1 {
		t.Fatalf("ordinary send=%+v err=%v", sent, err)
	}
}

func TestQueuedDraftRejectsChangedInputWithoutRemovingIt(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "changed queue", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{Text: "same text", References: []flruntime.MessageReference{{ReferenceID: "ref", Kind: flruntime.MessageReferenceText, Label: "Context", Text: "original snapshot"}}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "changed", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	fingerprint := queuedInputFingerprint(original)
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:changed", EditQueuedInputRequest{ClientRequestID: "remove-reference", Content: &EditQueuedContent{ExpectedInputFingerprint: fingerprint, Text: original.Text}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PrepareQueuedDraft(t.Context(), meta, thread.ThreadID, "queue:changed", QueuedDraftRequest{ExpectedInputFingerprint: fingerprint}); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("stale preparation=%v", err)
	}
	if _, err := svc.TakeBackQueuedInput(t.Context(), meta, thread.ThreadID, "queue:changed", fingerprint); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("stale take back=%v", err)
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(current.Queue) != 1 || current.Queue[0].Input.Text != original.Text {
		t.Fatalf("queue changed by rejected take back=%+v err=%v", current, err)
	}
}

func TestQueuedDraftRestoresFileDirectoryAndThreadReferences(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "reference draft", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	authority, err := resolveFlowerCanonicalReferenceTargetAuthority(meta.EndpointID, svc.ToolTargetPolicy())
	if err != nil {
		t.Fatal(err)
	}
	file, err := floretFilePathReference(ContextActionContextItem{Kind: contextActionKindFilePath, Path: "/workspace/main.go"}, 0, authority)
	if err != nil {
		t.Fatal(err)
	}
	directory, err := floretFilePathReference(ContextActionContextItem{Kind: contextActionKindFilePath, Path: "/workspace/src", IsDirectory: true}, 1, authority)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := ThreadReferenceSnapshot{RuntimeID: "runtime", ThreadID: thread.ThreadID, Title: "Referenced conversation", Status: "idle", WorkingDir: "/workspace", CreatedAtMs: 1, UpdatedAtMs: 2, CapturedAtMs: 3}
	raw, _ := json.Marshal(snapshot)
	original := flruntime.UserInput{Text: "references", References: []flruntime.MessageReference{file, directory, {ReferenceID: "thread", Kind: flruntime.MessageReferenceThread, ReferencedThreadID: identity.ThreadID(thread.ThreadID), Label: snapshot.Title, Text: string(raw)}}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "references", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	draft, err := svc.PrepareQueuedDraft(t.Context(), meta, thread.ThreadID, "queue:references", QueuedDraftRequest{ExpectedInputFingerprint: queuedInputFingerprint(original)})
	if err != nil {
		t.Fatal(err)
	}
	want := []ContextActionContextItem{
		{Kind: contextActionKindFilePath, Path: "/workspace/main.go"},
		{Kind: contextActionKindFilePath, Path: "/workspace/src", IsDirectory: true},
		{Kind: contextActionKindThread, Thread: &snapshot},
	}
	if !reflect.DeepEqual(draft.References, want) {
		t.Fatalf("references=%+v want=%+v", draft.References, want)
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(current.Queue) != 1 {
		t.Fatalf("preparation removed queue item: %+v %v", current, err)
	}
}

func TestReferenceSnapshotRejectsUnexpectedFields(t *testing.T) {
	var item ContextActionContextItem
	if err := json.Unmarshal([]byte(`{"kind":"reference_snapshot","reference_snapshot":{"kind":"text","label":"Selected","text":"Body","resource_ref":"forged"}}`), &item); err == nil {
		t.Fatal("unknown nested snapshot field accepted")
	}
}
