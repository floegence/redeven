package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/floret/v7/tools"
)

func TestConversationFilesForkPublicationFailureLeavesNoUnownedCopy(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(space.Scratch, "retained.bin"), []byte("work"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(svc.stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("CREATE TRIGGER review_reject_fork BEFORE INSERT ON ai_thread_settings BEGIN SELECT RAISE(ABORT, 'review injected publication failure'); END"); err != nil {
		t.Fatal(err)
	}
	_, err = svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, ForkThreadRequest{ClientRequestID: "review-failed-publication"})
	if err == nil {
		t.Fatal("expected publication failure")
	}
	t.Logf("injected publication result: %v", err)
	roots, err := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{})
	if err != nil {
		t.Fatal(err)
	}
	var forkID string
	for _, root := range roots {
		if root.ID.String() != source.ThreadID {
			forkID = root.ID.String()
		}
	}
	if forkID == "" {
		t.Fatal("missing canonical fork")
	}
	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, forkID)
	if err != nil || settings != nil {
		t.Fatalf("expected rollback: %+v %v", settings, err)
	}
	if _, err := os.Stat(filepath.Join(svc.stateDir, "task-files", forkID)); !os.IsNotExist(err) {
		t.Fatal("failed publication did not roll back files immediately", err)
	}
	if _, err = db.Exec("DROP TRIGGER review_reject_fork"); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteThread(t.Context(), meta, source.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(svc.stateDir, "task-files", forkID, "scratch", "retained.bin")
	if _, err := os.Stat(copyPath); !os.IsNotExist(err) {
		t.Fatalf("unpublished fork copy remains after source deletion and recovery; no product settings to discover it: %v", err)
	}
}

func TestConversationFilesDeletedCleanupContinuesPastOneBrokenDirectory(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	var ids []string
	for i := 0; i < 2; i++ {
		thread, err := svc.CreateThread(t.Context(), meta, "Deleted", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, thread.ThreadID)
		if _, err = prepareTaskFiles(svc.stateDir, thread.ThreadID); err != nil {
			t.Fatal(err)
		}
	}
	sort.Strings(ids)
	blocked := filepath.Join(svc.stateDir, "task-files", ids[0], "scratch")
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), blocked); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if err := svc.threadRuntime.Delete(t.Context(), flruntime.DeleteThreadInput{ThreadID: identity.ThreadID(id), RequestKey: flruntime.RequestKey("review-delete-" + id)}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		t.Logf("sweep %d: %v", i, svc.sweepDeletedThreadFiles(t.Context()))
	}
	if _, err := os.Stat(filepath.Join(svc.stateDir, "task-files", ids[1])); !os.IsNotExist(err) {
		t.Fatalf("one invalid directory starves later deleted thread on every sweep: %v", err)
	}
}

type countingAttachmentViews struct {
	flruntime.ThreadService
	flruntime.ThreadWindowSource
	views         atomic.Int64
	subscriptions atomic.Int64
}

func (r *countingAttachmentViews) SubscribeWindowUpdates(ctx context.Context, scope threadquery.Scope) (*flruntime.ThreadUpdateSubscription, error) {
	r.subscriptions.Add(1)
	return r.ThreadWindowSource.SubscribeWindowUpdates(ctx, scope)
}

func (r *countingAttachmentViews) View(ctx context.Context, id identity.ThreadID) (flruntime.ThreadView, error) {
	r.views.Add(1)
	return r.ThreadService.View(ctx, id)
}

func TestConversationFilesMaterializeDoesNotReadWholeHistory(t *testing.T) {
	testConversationFilesMaterialize(t, "original", false)
}
func TestConversationFilesMaterializeLongHistory(t *testing.T) {
	testConversationFilesMaterialize(t, strings.Repeat("01234567", 1<<20), true)
}
func testConversationFilesMaterialize(t *testing.T, body string, longHistory bool) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Attachment", "", "", "")
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
	name := "source.txt"
	file, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(body), DisplayName: name, UploadRequestID: "review-input", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(body))), ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "review-send", StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "Acknowledge.", Attachments: []RunAttachmentIn{{AttachmentID: file.AttachmentID}}}})
	if err != nil {
		t.Fatal(err)
	}
	waitForFloretThreadIdle(t, svc.threadRuntime, identity.ThreadID(thread.ThreadID))
	if longHistory {
		output := strings.Repeat("history body ", 64)
		tool := tools.Define[struct{}](tools.Definition{Name: "attachment_history_fixture", ReadOnly: true, InputSchema: tools.StrictObject(map[string]any{}, nil), Permission: tools.PermissionSpec{Mode: tools.PermissionAllow}}, nil, nil, func(context.Context, tools.Invocation[struct{}]) (tools.Result, error) {
			return tools.Result{Text: output}, nil
		})
		calls := 0
		gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
			events := make(chan flprovider.Event, 2)
			calls++
			if calls == 1 {
				batch := make([]flprovider.ToolCall, 160)
				for i := range batch {
					batch[i] = flprovider.ToolCall{ID: fmt.Sprintf("history-%d", i), Name: "attachment_history_fixture", Args: "{}"}
				}
				events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: batch}
				events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
			} else {
				events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Ready."}
				events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
			}
			close(events)
			return events, nil
		})
		agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "attachment-history", Name: "Attachment history"}, SystemPrompt: "Read then answer.", Context: flconfig.ContextPolicy{ContextWindowTokens: 10000000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentLoopLimits(flruntime.LoopLimits{DuplicateToolLimit: 1000, NoProgressLimit: 1000, WallTime: 5 * time.Minute}))
		if err != nil {
			t.Fatal(err)
		}
		const key = "attachment-history"
		svc.floretEffects.put(identity.ThreadID(thread.ThreadID), key, floretEffectRequest{agent: agent, meta: *meta, req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
		if _, err := svc.threadRuntime.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: key, Input: flruntime.UserInput{Text: "Read history."}}); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(5 * time.Minute)
		for {
			summary, err := svc.threadRuntime.(flruntime.ThreadSummaryReader).Summary(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			if summary.Activity == flruntime.ThreadActivityIdle {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("long history fixture did not settle")
			}
			time.Sleep(10 * time.Millisecond)
		}
		view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
		if err != nil || len(view.Items) < 160 {
			t.Fatalf("long history fixture: %d items %v", len(view.Items), err)
		}
		t.Logf("history_items=%d original_bytes=%d", len(view.Items), len(body))
	}
	counted := &countingAttachmentViews{ThreadService: svc.threadRuntime, ThreadWindowSource: svc.threadRuntime.(flruntime.ThreadWindowSource)}
	reader := &Service{threadRuntime: counted, threadsDB: svc.threadsDB, uploadsDir: svc.uploadsDir}
	r := &run{id: "review-run", threadID: thread.ThreadID, endpointID: meta.EndpointID, userPublicID: meta.UserPublicID, channelID: meta.ChannelID, stateDir: svc.stateDir}
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, sent.TurnID, true)
	r.host.openLiveAttachment = func(ctx context.Context, owner UploadOwner, id string) (openedCanonicalAttachment, error) {
		return reader.openCanonicalLiveAttachment(ctx, owner, thread.ThreadID, id)
	}
	locator := logicalAttachmentLocator(file.AttachmentID, name)
	var before, after goruntime.MemStats
	goruntime.ReadMemStats(&before)
	start := time.Now()
	result, err := r.toolAttachmentMaterialize(t.Context(), meta, locator)
	elapsed := time.Since(start)
	goruntime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("production_tool_duration=%s allocated_bytes=%d full_views=%d canonical_scans=%d", elapsed, after.TotalAlloc-before.TotalAlloc, counted.views.Load(), counted.subscriptions.Load())
	if got := counted.views.Load(); got != 0 {
		t.Fatalf("materialization reads complete history %d times", got)
	}
	if got := counted.subscriptions.Load(); got != 1 {
		t.Fatalf("duplicate canonical scan: %d", got)
	}
	copied, err := os.ReadFile(result["file_path"].(string))
	if err != nil || string(copied) != body {
		t.Fatal("wrong materialized snapshot", err)
	}
	// A resolved handle does not certify bytes: every consumer verifies its own snapshot.
	opened, err := reader.openCanonicalLiveAttachment(t.Context(), owner, thread.ThreadID, file.AttachmentID)
	if err != nil {
		t.Fatal(err)
	}
	damaged, err := os.OpenFile(opened.Upload.FilePath, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := damaged.WriteAt([]byte("!"), 0); err != nil {
		t.Fatal(err)
	}
	damaged.Close()
	if _, err := r.toolAttachmentMaterialize(t.Context(), meta, locator); err == nil {
		t.Fatal("corrupt original materialized")
	}
	if _, err := r.toolAttachmentRead(t.Context(), meta, attachmentReadArgs{Locator: locator}); err == nil {
		t.Fatal("corrupt original read")
	}
	if _, err := reader.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, thread.ThreadID, sent.TurnID, file.AttachmentID); err == nil {
		t.Fatal("corrupt original downloaded")
	}
	entries, err := os.ReadDir(filepath.Dir(filepath.Dir(result["file_path"].(string))))
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed copy leaked: %d %v", len(entries), err)
	}

}

func TestConversationFilesForkRecoveryAfterRestartPreservesAdmittedEdits(t *testing.T) {
	server := newRealtimeTestServer(t, time.Millisecond)
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(state, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(space.Scratch, "keep.txt"), []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	admitted, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, ForkThreadRequest{ClientRequestID: "admitted"})
	if err != nil {
		t.Fatal(err)
	}
	edited := filepath.Join(state, "task-files", admitted.ThreadID, "scratch", "keep.txt")
	if err := os.WriteFile(edited, []byte("edited"), 0600); err != nil {
		t.Fatal(err)
	}
	unpublished, err := svc.threadRuntime.Fork(t.Context(), flruntime.ForkThreadInput{SourceThreadID: identity.ThreadID(source.ThreadID), RequestKey: "interrupted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := inheritForkTaskFiles(t.Context(), state, source.ThreadID, unpublished.ThreadID.String(), "interrupted", ""); err != nil {
		t.Fatal(err)
	}
	base, stage, _, err := stageForkTaskFiles(t.Context(), state, source.ThreadID, "partial", "")
	if err != nil {
		t.Fatal(err)
	}
	base.Close() // Simulate a process exit before deferred cleanup can run.
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = openRealtimeTestService(t, state, server.URL)
	if err := svc.sweepUnpublishedForkFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{unpublished.ThreadID.String(), stage} {
		if _, err := os.Stat(filepath.Join(state, "task-files", name)); !os.IsNotExist(err) {
			t.Fatalf("interrupted files survived restart: %s %v", name, err)
		}
	}
	if body, err := os.ReadFile(edited); err != nil || string(body) != "edited" {
		t.Fatalf("admitted copy changed: %q %v", body, err)
	}
	replay, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, ForkThreadRequest{ClientRequestID: "interrupted"})
	if err != nil || replay.ThreadID != unpublished.ThreadID.String() {
		t.Fatalf("retry lost canonical identity: %+v %v", replay, err)
	}
	if err := svc.sweepUnpublishedForkFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(filepath.Join(state, "task-files", replay.ThreadID, "scratch", "keep.txt")); err != nil || string(body) != "source" {
		t.Fatalf("retry lost copy: %q %v", body, err)
	}
}

func TestConversationFilesForkRecoverySkipsInFlightAndHonorsCancellation(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	state := svc.stateDir
	if _, err := prepareTaskFiles(state, "source"); err != nil {
		t.Fatal(err)
	}
	release, err := svc.taskFiles.freeze(t.Context(), "target")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	releaseStage, err := svc.taskFiles.freeze(t.Context(), forkTaskStagingName("source", "partial"))
	if err != nil {
		t.Fatal(err)
	}
	defer releaseStage()
	if err := inheritForkTaskFiles(t.Context(), state, "source", "target", "ready", ""); err != nil {
		t.Fatal(err)
	}
	base, stage, discard, err := stageForkTaskFiles(t.Context(), state, "source", "partial", "")
	if err != nil {
		t.Fatal(err)
	}
	defer discard()
	if err := svc.sweepUnpublishedForkFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"target", stage} {
		if _, err := base.Stat(name); err != nil {
			t.Fatal("in-flight copy removed", err)
		}
	}
	release()
	releaseStage()
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if err := svc.sweepUnpublishedForkFiles(canceled); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := base.Stat("target"); err != nil {
		t.Fatal("cancellation removed target", err)
	}
	if err := svc.sweepUnpublishedForkFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"target", stage} {
		if _, err := base.Stat(name); !os.IsNotExist(err) {
			t.Fatal("unpublished copy remains", name, err)
		}
	}
	if _, err := base.Stat("source"); err != nil {
		t.Fatal("unknown ordinary directory removed", err)
	}
}

func TestConversationFilesDeletedCleanupAdvancesPagesAndRetriesFailures(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	ids := make([]string, 51)
	for i := range ids {
		thread, err := svc.CreateThread(t.Context(), meta, "Deleted", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = thread.ThreadID
		if _, err := prepareTaskFiles(svc.stateDir, thread.ThreadID); err != nil {
			t.Fatal(err)
		}
	}
	sort.Strings(ids)
	blocked := filepath.Join(svc.stateDir, "task-files", ids[0], "scratch")
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), blocked); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if err := svc.threadRuntime.Delete(t.Context(), flruntime.DeleteThreadInput{ThreadID: identity.ThreadID(id), RequestKey: flruntime.RequestKey("delete:" + id)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err == nil {
		t.Fatal("missing failed-item diagnostic")
	}
	if _, err := os.Stat(filepath.Join(svc.stateDir, "task-files", ids[50])); err != nil {
		t.Fatal("sweep exceeded page", err)
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(svc.stateDir, "task-files", ids[50])); !os.IsNotExist(err) {
		t.Fatal("later page starved", err)
	}
	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, ids[0])
	if err != nil || settings == nil {
		t.Fatal("failed item lost retry anchor", err)
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := svc.sweepDeletedThreadFiles(t.Context()); err != nil {
		t.Fatal(err)
	}
	settings, err = svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, ids[0])
	if err != nil || settings != nil {
		t.Fatal("failed item never retried", err)
	}
}

func TestConversationFilesOrphanDeletionCleansUnpublishedFork(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	fork, err := svc.threadRuntime.Fork(t.Context(), flruntime.ForkThreadInput{SourceThreadID: identity.ThreadID(source.ThreadID), RequestKey: "orphan"})
	if err != nil {
		t.Fatal(err)
	}
	if err := inheritForkTaskFiles(t.Context(), svc.stateDir, source.ThreadID, fork.ThreadID.String(), "orphan", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteOrphanCanonicalRoot(t.Context(), DeleteOrphanCanonicalRootRequest{ThreadID: fork.ThreadID.String(), OperatorPublicID: meta.UserPublicID}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(svc.stateDir, "task-files", fork.ThreadID.String())); !os.IsNotExist(err) {
		t.Fatal("orphan files survived deletion", err)
	}
}

func TestConversationFilesRecoveryRejectsSymlinkRoot(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	outside := t.TempDir()
	name := forkTaskStagingName("source", "private")
	if err := os.Mkdir(filepath.Join(outside, name), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(svc.stateDir, "task-files")); err != nil {
		t.Fatal(err)
	}
	if err := svc.sweepUnpublishedForkFiles(t.Context()); err == nil {
		t.Fatal("symlink root accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, name)); err != nil {
		t.Fatal("outside data removed", err)
	}
}
