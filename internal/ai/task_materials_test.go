package ai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestTaskMaterialsForkCutCleanupAndLastReference(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Materials", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	upload := func(key, content string) (*UploadResponse, string) {
		t.Helper()
		scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		name := "same-name.txt"
		file, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(content), DisplayName: name, UploadRequestID: key, ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(content))), ExpectedSizeBytes: int64(len(content)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
		if err != nil {
			t.Fatal(err)
		}
		sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: key, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "Acknowledge the attachment.", Attachments: []RunAttachmentIn{{AttachmentID: file.AttachmentID}}}})
		if err != nil {
			t.Fatal(err)
		}
		waitForFloretThreadIdle(t, svc.threadRuntime, identity.ThreadID(thread.ThreadID))
		return file, sent.TurnID
	}
	first, firstTurn := upload("first", "first original\n")
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	cut := ""
	for _, item := range view.Items {
		if item.Kind == flruntime.ThreadItemAssistant && !item.Live {
			cut = item.ID
		}
	}
	if cut == "" {
		t.Fatalf("no committed assistant: failure=%+v", view.Failure)
	}
	firstOriginal, err := svc.openCanonicalLiveAttachment(t.Context(), owner, thread.ThreadID, first.AttachmentID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(firstOriginal.Upload.FilePath); err != nil {
		t.Fatal(err)
	}
	second, _ := upload("second", "second original\n")
	list, err := svc.GetTaskMaterials(t.Context(), meta, thread.ThreadID, "")
	if err != nil || len(list.Items) != 2 {
		t.Fatalf("materials=%+v %v", list, err)
	}
	if list.Items[0].ID == list.Items[1].ID || list.Items[0].Name != list.Items[1].Name {
		t.Fatal("same-name identity lost")
	}
	for _, item := range list.Items {
		if strings.Contains(item.URL, svc.stateDir) || !strings.HasPrefix(item.Locator, "attachment://v1/") {
			t.Fatalf("invalid public resource %+v", item)
		}
	}
	space, err := prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(space.Scratch, "helper.txt"), []byte("work"), 0600); err != nil {
		t.Fatal(err)
	}
	historical, err := svc.ForkThreadWithOptions(t.Context(), meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "historical", SourceItemID: cut})
	if err != nil {
		t.Fatal(err)
	}
	inherited, err := svc.GetTaskMaterials(t.Context(), meta, historical.ThreadID, "")
	if err != nil || len(inherited.Items) != 1 {
		t.Fatalf("historical materials=%+v %v", inherited, err)
	}
	if !strings.Contains(inherited.Items[0].Locator, first.AttachmentID) {
		t.Fatal("fork inherited future attachment")
	}
	if _, err := svc.openCanonicalLiveAttachment(t.Context(), owner, historical.ThreadID, second.AttachmentID); err == nil {
		t.Fatal("fork authorized future attachment")
	}
	current, err := svc.ForkThreadWithOptions(t.Context(), meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "current"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.CleanTaskFiles(t.Context(), meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, thread.ThreadID, firstTurn, first.AttachmentID); err != nil {
		t.Fatal("cleanup removed input", err)
	}
	if err := svc.DeleteThread(t.Context(), meta, thread.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.openCanonicalLiveAttachment(t.Context(), owner, historical.ThreadID, first.AttachmentID); err != nil {
		t.Fatal("parent deletion lost input", err)
	}
	child, _ := taskFiles(svc.stateDir, historical.ThreadID)
	if b, err := os.ReadFile(filepath.Join(child.Scratch, "helper.txt")); err != nil || string(b) != "work" {
		t.Fatal("parent cleanup lost fork files", err)
	}
	if err := svc.DeleteThread(t.Context(), meta, current.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.openCanonicalLiveAttachment(t.Context(), owner, historical.ThreadID, first.AttachmentID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteThread(t.Context(), meta, historical.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.sweepPendingUploads(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(firstOriginal.Upload.FilePath); !os.IsNotExist(err) {
		t.Fatalf("last-reference upload remains: %v", err)
	}
}

func TestTaskMaterialsRejectScopeAndCancellation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Materials", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	other := *meta
	other.EndpointID = "foreign"
	if _, err := svc.GetTaskMaterials(t.Context(), &other, thread.ThreadID, ""); err == nil {
		t.Fatal("foreign scope accepted")
	}
	if _, err := svc.GetTaskMaterials(t.Context(), meta, thread.ThreadID, "invalid"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
	encoded, _ := json.Marshal(taskMaterialCursor{Thread: thread.ThreadID, Endpoint: meta.EndpointID, Leaf: "stale-leaf", Before: "unknown-item"})
	if _, err := svc.GetTaskMaterials(t.Context(), meta, thread.ThreadID, base64.RawURLEncoding.EncodeToString(encoded)); err == nil {
		t.Fatal("accepted stale cursor")
	}
	if _, err := svc.GetTaskMaterials(t.Context(), meta, thread.ThreadID, strings.Repeat("a", 6000)); err == nil {
		t.Fatal("accepted oversized cursor")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := svc.GetTaskMaterials(ctx, meta, thread.ThreadID, ""); err == nil {
		t.Fatal("canceled query accepted")
	}
}

func TestDeletedTaskFilesResumeFromCanonicalTombstone(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Delete recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(space.Scratch, "work.txt"), []byte("work"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadRuntime.Delete(t.Context(), flruntime.DeleteThreadInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: "delete-test"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(space.Root); !os.IsNotExist(err) {
		t.Fatalf("deleted work retained: %v", err)
	}
	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, thread.ThreadID)
	if err != nil || settings != nil {
		t.Fatalf("cleanup anchor retained: %+v %v", settings, err)
	}
}

func TestDeletedTaskFilesSweepPreservesUnknownCanonicalThread(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Unknown canonical state", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	original, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	settings := *original
	settings.ThreadID = "thread_absent_canonical"
	if err := svc.threadsDB.AdoptCanonicalRootSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, settings.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(space.Scratch, "keep.txt")
	if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(path); err != nil || string(body) != "keep" {
		t.Fatal("missing history authorized deletion", err)
	}
	if got, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, settings.ThreadID); err != nil || got == nil {
		t.Fatal("lost cleanup anchor", err)
	}
}
