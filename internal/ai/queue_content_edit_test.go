package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func TestQueuedContentEditClaimsResourcesAndReplaysAfterDeletion(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "queue-content", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{ModelContextSnapshot: &flruntime.ModelContextSnapshot{Sections: []flruntime.ModelContextSection{{Key: "skills", Title: "Skills", Text: "captured catalog"}}}, Text: "original", References: []flruntime.MessageReference{{ReferenceID: "old", Kind: flruntime.MessageReferenceText, Label: "Old context", Text: "OLD_CONTEXT"}}, Context: []flruntime.MessageContextItem{{Kind: "runtime_context", Title: "Runtime", Text: "captured runtime"}}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "queued-content", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	owner, _ := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	body, name := "EDIT_ATTACHMENT_BODY\n", "new.txt"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(body), DisplayName: name, UploadRequestID: "queue-edit-upload", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(body))), ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	req := EditQueuedInputRequest{ClientRequestID: "queue-content-edit", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(original), Text: "updated", Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, ContextAction: &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: "assistant.ask.flower", Provider: "flower", Target: ContextActionTarget{TargetID: "current", Locality: "auto"}, Source: ContextActionSource{Surface: "flower_composer"}, Context: []ContextActionContextItem{{Kind: "text_snapshot", Title: "New context", Content: "NEW_CONTEXT"}}}}}
	base := svc.threadRuntime
	failure := errors.New("canonical edit write failed")
	svc.threadRuntime = &failingQueuedEditor{ThreadService: base, ThreadQueueController: base.(flruntime.ThreadQueueController), ThreadQueueEditReader: base.(flruntime.ThreadQueueEditReader), ThreadSummaryReader: base.(flruntime.ThreadSummaryReader), failure: failure}
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", req); !errors.Is(err, failure) {
		t.Fatalf("write failure=%v", err)
	}
	svc.threadRuntime = base
	updated, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", req)
	if err != nil {
		t.Fatal(err)
	}
	input := updated.Queue[0].Input
	if input.ModelContextSnapshot == nil || len(input.ModelContextSnapshot.Sections) != 1 || input.ModelContextSnapshot.Sections[0].Text != "captured catalog" {
		t.Fatalf("managed snapshot lost: %#v", input)
	}
	if input.Text != "updated" || len(input.Attachments) != 1 || len(input.References) != 1 || input.References[0].Text != "NEW_CONTEXT" {
		t.Fatalf("input=%#v", input)
	}
	retained := EditQueuedInputRequest{ClientRequestID: "retain-content", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(input), Text: input.Text, RetainedAttachmentIDs: []string{upload.AttachmentID}, RetainedReferenceIDs: []string{input.References[0].ReferenceID}}}
	same, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", retained)
	if err != nil || queuedInputFingerprint(same.Queue[0].Input) != queuedInputFingerprint(input) {
		t.Fatalf("retain=%+v error=%v", same, err)
	}
	forged := retained
	forged.ClientRequestID = "forged-retention"
	forgedContent := *retained.Content
	forgedContent.RetainedAttachmentIDs = []string{"upl_forged"}
	forged.Content = &forgedContent
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", forged); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("forged attachment=%v", err)
	}
	removed := EditQueuedInputRequest{ClientRequestID: "remove-content", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(input), Text: input.Text}}
	without, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", removed)
	if err != nil || len(without.Queue[0].Input.Attachments) != 0 || len(without.Queue[0].Input.References) != 0 || len(without.Queue[0].Input.Context) != 1 || without.Queue[0].Input.Context[0].Kind != "runtime_context" {
		t.Fatalf("remove=%+v error=%v", without, err)
	}
	retained.ClientRequestID = "same-text-stale"
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", retained); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("same text stale content=%v", err)
	}
	stale := req
	stale.ClientRequestID = "stale-content"
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", stale); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("stale=%v", err)
	}
	if err := svc.DeleteQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", req); err != nil {
		t.Fatalf("replay after deletion=%v", err)
	}
	changed := req
	content := *req.Content
	content.Text = "changed replay"
	changed.Content = &content
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:queued-content", changed); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("changed replay=%v", err)
	}
}

func TestQueuedCurrentProjectsEditableSnapshotWithoutOpaqueResources(t *testing.T) {
	input := flruntime.UserInput{Text: "queued", References: []flruntime.MessageReference{{ReferenceID: "file", Kind: flruntime.MessageReferenceFile, Label: "test.go", Text: "/private/test.go", ResourceRef: "secret-ref"}}}
	raw, err := MarshalFlowerCurrentView(flruntime.ThreadView{ThreadID: "thread", Queue: []flruntime.QueuedInput{{ID: "queue:request", Input: input}}})
	if err != nil {
		t.Fatal(err)
	}
	var current struct {
		Queue []struct {
			InputFingerprint string              `json:"input_fingerprint"`
			Input            flruntime.UserInput `json:"input"`
		} `json:"queue"`
	}
	if err := json.Unmarshal(raw, &current); err != nil {
		t.Fatal(err)
	}
	if current.Queue[0].InputFingerprint != queuedInputFingerprint(input) || current.Queue[0].Input.References[0].ResourceRef != "" || current.Queue[0].Input.References[0].Text != "" {
		t.Fatalf("public=%s", raw)
	}
}

func TestQueuedContentEditRemovesReferenceFactsAndPreservesRuntime(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	action := &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: "assistant.ask.flower", Provider: "flower", Target: ContextActionTarget{TargetID: "current", Locality: "auto"}, Source: ContextActionSource{Surface: "git_browser"}, Context: []ContextActionContextItem{
		{Kind: "text_snapshot", Title: "Old context", Content: "OLD_CONTEXT", Detail: "OLD_DETAIL"},
		{Kind: "text_snapshot", Title: "Keep text", Content: "KEEP_TEXT", Detail: "KEEP_DETAIL"},
	}}
	projection, err := floretContextProjectionForInput(RunInput{ContextAction: action}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{Text: "same", References: projection.References, Context: append(projection.Context, flruntime.MessageContextItem{Kind: "runtime_context", Title: "Runtime", Text: "KEEP_RUNTIME"})}
	refs, facts, err := svc.queuedEditReferences(t.Context(), meta, original, EditQueuedContent{RetainedReferenceIDs: []string{"context:1"}}, "edit-facts")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(facts)
	if len(refs) != 1 || strings.Contains(string(raw), "OLD_DETAIL") || !strings.Contains(string(raw), "KEEP_DETAIL") || !strings.Contains(string(raw), "KEEP_RUNTIME") {
		t.Fatalf("refs=%#v facts=%s", refs, raw)
	}
}

func TestQueuedContentEditEmptyReferencesReplay(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "queue-empty", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{Text: "original"}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "empty", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	req := EditQueuedInputRequest{ClientRequestID: "edit-empty", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(original), Text: "updated"}}
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:empty", req); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:empty", req); err != nil {
		t.Fatalf("replay: %v", err)
	}
}

func TestQueuedContentEditConcurrentReplay(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "queue-concurrent", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.UserInput{Text: "original"}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "concurrent", Input: original}}}); err != nil {
		t.Fatal(err)
	}
	req := EditQueuedInputRequest{ClientRequestID: "edit-concurrent", Content: &EditQueuedContent{ExpectedInputFingerprint: queuedInputFingerprint(original), Text: "updated"}}
	start := make(chan struct{})
	results := make(chan error, 8)
	for range cap(results) {
		go func() {
			<-start
			_, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, "queue:concurrent", req)
			results <- err
		}()
	}
	close(start)
	for range cap(results) {
		if err := <-results; err != nil {
			t.Errorf("concurrent replay: %v", err)
		}
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(current.Queue) != 1 || current.Queue[0].Input.Text != "updated" {
		t.Fatalf("current=%#v err=%v", current, err)
	}
}

// Fail only the canonical mutation, after the host has claimed new resources.
type failingQueuedEditor struct {
	flruntime.ThreadSummaryReader
	flruntime.ThreadService
	flruntime.ThreadQueueController
	flruntime.ThreadQueueEditReader
	failure error
}

func (editor *failingQueuedEditor) EditQueued(context.Context, flruntime.EditQueuedInput) (flruntime.ThreadView, error) {
	return flruntime.ThreadView{}, editor.failure
}

func TestQueuedCanonicalReferencePreviewRequiresCurrentExactMembership(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	home := t.TempDir()
	file := filepath.Join(home, "note.txt")
	if err := os.WriteFile(file, []byte("preview"), 0600); err != nil {
		t.Fatal(err)
	}
	registry, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: home})
	if err != nil {
		t.Fatal(err)
	}
	svc.scope = registry
	thread, err := svc.CreateThread(t.Context(), meta, "queued-reference", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	authority, err := resolveFlowerCanonicalReferenceTargetAuthority(meta.EndpointID, svc.ToolTargetPolicy())
	if err != nil {
		t.Fatal(err)
	}
	ref, err := floretFilePathReference(ContextActionContextItem{Kind: "file_path", Path: file}, 0, authority)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: identity.ThreadID(thread.ThreadID), Items: []flruntime.ImportedPendingInput{{RequestKey: "preview", Input: flruntime.UserInput{Text: "queued", References: []flruntime.MessageReference{ref}}}}}); err != nil {
		t.Fatal(err)
	}
	request := FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, QueueID: "queue:preview", ReferenceID: ref.ReferenceID}
	target, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(t.Context(), meta, request)
	real, _ := filepath.EvalSymlinks(file)
	if err != nil || target.Path != real {
		t.Fatalf("preview=%+v err=%v", target, err)
	}
	wrong := request
	wrong.QueueID = "queue:another"
	if _, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(t.Context(), meta, wrong); !errors.Is(err, ErrFlowerCanonicalReferenceNotFound) {
		t.Fatalf("wrong scope=%v", err)
	}
	if err := svc.DeleteQueuedInput(t.Context(), meta, thread.ThreadID, request.QueueID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(t.Context(), meta, request); !errors.Is(err, ErrFlowerCanonicalReferenceNotFound) {
		t.Fatalf("deleted scope=%v", err)
	}
}
