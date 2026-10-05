package ai

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

// These scenarios combine real model turns with concurrent or deliberately
// interleaved product commands. Provider responses are never scripted.
func (f *ollamaTaskFixture) check(err error) {
	f.t.Helper()
	if err != nil {
		f.t.Fatal(err)
	}
}

func (f *ollamaTaskFixture) restart() {
	f.t.Helper()
	f.disconnect()
	f.check(f.svc.Close())
	var err error
	f.svc, err = NewService(f.opts)
	f.check(err)
	f.mu.Lock()
	f.frames = nil
	f.mu.Unlock()
	f.disconnect = f.observe()
}

func ollamaConcurrent(commands ...func() error) []error {
	start := make(chan struct{})
	errs := make([]error, len(commands))
	var wg sync.WaitGroup
	for i, command := range commands {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; errs[i] = command() }()
	}
	close(start)
	wg.Wait()
	return errs
}

func (f *ollamaTaskFixture) assertUsers(count int) {
	f.t.Helper()
	seen := 0
	for _, item := range f.view().Current.Items {
		if item.Kind == flruntime.ThreadItemUser {
			seen++
		}
	}
	if seen != count {
		f.t.Fatalf("canonical user messages=%d want=%d", seen, count)
	}
}

func (f *ollamaTaskFixture) stoppedQueue(count int) {
	f.t.Helper()
	d := f.wait("stopped queue", func(d *FlowerThreadDetail) bool {
		return d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
	})
	if *d.Current.LastOutcome != flruntime.TurnOutcomeCancelled || len(d.Current.Queue) != count {
		f.t.Fatalf("stop changed queue or outcome: %+v", d.Current)
	}
}

func ollamaAppendPrompt(file, line string) string {
	return fmt.Sprintf("In the current directory, use terminal.exec exactly once to execute: printf '%s\\n' >> %s . Then verify the file with a read-only command and report DONE. Do not repeat the append.", line, file)
}

func ollamaInterleaveDuplicateSend(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("duplicate-active", "Without tools, explain sorting algorithms in twenty paragraphs.")
	f.fault.waitHit(f.t)
	request := SendUserTurnRequest{ThreadID: f.threadID, ClientRequestID: "duplicate-input", Input: RunInput{Text: ollamaAppendPrompt("dedupe.txt", "ONCE")}}
	responses := make([]SendUserTurnResponse, 2)
	commands := make([]func() error, 2)
	for i := range commands {
		commands[i] = func() error {
			var err error
			responses[i], err = f.svc.SendUserTurn(f.ctx, f.meta, request)
			return err
		}
	}
	for _, err := range ollamaConcurrent(commands...) {
		f.check(err)
	}
	if responses[0].Kind != "queued" || responses[0].QueueID != responses[1].QueueID || len(f.view().Current.Queue) != 1 {
		f.t.Fatal("duplicate concurrent input created more than one queue item")
	}
	conflict := request
	conflict.Input.Text = "Conflicting content"
	if _, err := f.svc.SendUserTurn(f.ctx, f.meta, conflict); err == nil {
		f.t.Fatal("conflicting request identity accepted")
	}
	mixed := make([]func() error, 8)
	for i := range mixed {
		mixed[i] = func() error {
			input := request
			if i%2 == 0 {
				input = conflict
			}
			_, err := f.svc.SendUserTurn(f.ctx, f.meta, input)
			return err
		}
	}
	for i, err := range ollamaConcurrent(mixed...) {
		if i%2 == 0 && !errors.Is(err, ErrTurnIdempotencyConflict) || i%2 != 0 && err != nil {
			f.t.Fatalf("mixed replay %d returned another request's outcome: %v", i, err)
		}
	}
	stop := func() error { _, err := f.svc.StopThread(f.ctx, f.meta, f.threadID); return err }
	for _, err := range ollamaConcurrent(stop, stop, stop) {
		f.check(err)
	}
	f.stoppedQueue(1)
	f.restart()
	f.stoppedQueue(1)
	_, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, responses[0].QueueID)
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("dedupe.txt", "ONCE\n")
	_, err = f.svc.SendUserTurn(f.ctx, f.meta, request)
	f.check(err)
	f.assertUsers(2)
	f.file("dedupe.txt", "ONCE\n")
	f.report["duplicate_sends"] = 2
	f.report["concurrent_stops"] = 3
	f.report["mixed_concurrent_replays"] = len(mixed)
}

func ollamaInterleaveApprovalQueue(f *ollamaTaskFixture) {
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionApprovalRequired))
	f.send("approval-pending", ollamaAppendPrompt("forbidden.txt", "OLD"))
	approval := f.approval()
	aText := ollamaAppendPrompt("approval-order.txt", "OLD_A")
	a := f.send("approval-a", aText)
	b := f.send("approval-b", ollamaAppendPrompt("approval-order.txt", "B"))
	c := f.send("approval-c", ollamaAppendPrompt("deleted.txt", "DELETED"))
	_, err := f.svc.EditQueuedInput(f.ctx, f.meta, f.threadID, a.QueueID, EditQueuedInputRequest{ClientRequestID: "approval-edit", ExpectedText: &aText, Text: ollamaAppendPrompt("approval-order.txt", "A")})
	f.check(err)
	f.check(f.svc.ReorderQueue(f.ctx, f.meta, f.threadID, ReorderQueueRequest{OrderedQueueIDs: []string{b.QueueID, a.QueueID, c.QueueID}}))
	f.check(f.svc.DeleteQueuedInput(f.ctx, f.meta, f.threadID, c.QueueID))
	f.stop()
	f.stoppedQueue(2)
	if _, err := f.svc.SubmitFlowerApproval(f.meta, SubmitFlowerApprovalRequest{ThreadID: f.threadID, InteractionID: approval.ID, Approved: true}); err == nil {
		f.t.Fatal("late approval revived cancelled tool")
	}
	f.restart()
	f.stoppedQueue(2)
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionFullAccess))
	_, err = f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, b.QueueID)
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("approval-order.txt", "B\nA\n")
	f.missing("forbidden.txt")
	f.missing("deleted.txt")
	f.assertUsers(3)
}

func ollamaInterleaveApprovalReplay(f *ollamaTaskFixture) {
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionApprovalRequired))
	f.send("approval-once", "Use terminal.exec exactly once to execute: printf 'APPROVED\\n' >> approved-once.txt . Do not issue further tools. Report the command's actual result. If approval is denied, do not use another tool.")
	i := f.approval()
	f.missing("approved-once.txt")
	approve := func() error {
		_, err := f.svc.SubmitFlowerApproval(f.meta, SubmitFlowerApprovalRequest{ThreadID: f.threadID, InteractionID: i.ID, Approved: true})
		return err
	}
	errs := ollamaConcurrent(approve, approve)
	if errs[0] != nil && errs[1] != nil {
		f.t.Fatalf("both approval commands failed: %v", errs)
	}
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("approved-once.txt", "APPROVED\n")
	f.check(approve())
	if _, err := f.svc.SubmitFlowerApproval(f.meta, SubmitFlowerApprovalRequest{ThreadID: f.threadID, InteractionID: i.ID, Approved: false}); err == nil {
		f.t.Fatal("conflicting approval replay accepted")
	}
	f.restart()
	f.check(approve())
	f.file("approved-once.txt", "APPROVED\n")
	f.finish("approval-next", "Reply exactly REPLAY_FINISHED without tools.", "REPLAY_FINISHED")
	f.report["concurrent_approval_errors"] = fmt.Sprint(errs)
}

func ollamaInterleaveStaleAnswer(f *ollamaTaskFixture) {
	f.send("question-old", "Use ask_user to request a fictional fixture label with a single free-text question id label and response_mode write. After the answer, write it to old-answer.txt. Do not guess the answer.")
	p := f.ask()
	q := f.send("question-next", "The previous question is cancelled. Use terminal.exec to execute: printf 'NEW\\n' > new-answer.txt . Verify that file and report NEW.")
	f.stop()
	f.stoppedQueue(1)
	f.restart()
	_, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, q.QueueID)
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	answer := SubmitRequestUserInputResponseRequest{ThreadID: f.threadID, Response: RequestUserInputResponse{PromptID: p.PromptID, Answers: map[string]RequestUserInputAnswer{"label": {Text: "STALE"}}}}
	if _, err := f.svc.SubmitRequestUserInputResponse(f.ctx, f.meta, answer); err == nil {
		f.t.Fatal("stale answer revived a cancelled question")
	}
	f.file("new-answer.txt", "NEW\n")
	f.missing("old-answer.txt")
	f.assertUsers(2)
}

func ollamaInterleaveRetryRestart(f *ollamaTaskFixture) {
	f.fault.armAfterTool("cut", "EFFECT_COMMITTED")
	f.send("retry-twice", "Use terminal.exec to execute: printf 'ONCE\\n' >> retry-once.txt; printf EFFECT_COMMITTED . After the tool succeeds, explain photosynthesis in three short sentences and end with RETRY_DONE. The append must run only once.")
	f.fault.waitHit(f.t)
	f.terminal(flruntime.TurnOutcomeFailed)
	f.file("retry-once.txt", "ONCE\n")
	f.restart()
	f.fault.arm("cut")
	_, err := f.svc.RetryThreadContinuation(f.ctx, f.meta, f.threadID)
	f.check(err)
	f.fault.waitHit(f.t)
	f.terminal(flruntime.TurnOutcomeFailed)
	f.file("retry-once.txt", "ONCE\n")
	f.restart()
	f.fault.arm("hold")
	retry := func() error { _, err := f.svc.RetryThreadContinuation(f.ctx, f.meta, f.threadID); return err }
	errs := ollamaConcurrent(retry, retry)
	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		f.t.Fatalf("concurrent retries admitted %d continuations: %v", successes, errs)
	}
	f.fault.waitHit(f.t)
	queued := f.send("after-retries", ollamaAppendPrompt("after-retry.txt", "NEXT"))
	if queued.Kind != "queued" {
		f.t.Fatal("input during retry was not queued")
	}
	f.fault.release()
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("retry-once.txt", "ONCE\n")
	f.file("after-retry.txt", "NEXT\n")
	f.assertUsers(2)
	if f.fault.snapshot()["stream_cuts"].(int) != 2 {
		f.t.Fatal("expected two real stream failures")
	}
}

func ollamaInterleaveSendNow(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("send-now-active", "Without tools, explain compilation in twenty paragraphs.")
	f.fault.waitHit(f.t)
	a := f.send("send-now-a", ollamaAppendPrompt("send-now-order.txt", "A"))
	b := f.send("send-now-b", ollamaAppendPrompt("send-now-order.txt", "B"))
	send := func() error { _, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, b.QueueID); return err }
	errs := ollamaConcurrent(send, send)
	if errs[0] != nil && errs[1] != nil {
		f.t.Fatalf("neither send-now command was admitted: %v", errs)
	}
	for _, err := range errs {
		if err != nil && !errors.Is(err, flruntime.ErrThreadBusy) {
			f.t.Fatal(err)
		}
	}
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("send-now-order.txt", "B\nA\n")
	f.check(send())
	old := ollamaAppendPrompt("send-now-order.txt", "A")
	if _, err := f.svc.EditQueuedInput(f.ctx, f.meta, f.threadID, a.QueueID, EditQueuedInputRequest{ClientRequestID: "consumed-edit", ExpectedText: &old, Text: "STALE"}); err == nil {
		f.t.Fatal("consumed queue item was editable")
	}
	f.check(f.svc.DeleteQueuedInput(f.ctx, f.meta, f.threadID, a.QueueID))
	f.restart()
	f.check(send())
	f.file("send-now-order.txt", "B\nA\n")
	f.assertUsers(3)
	// Reconnect refreshes selected detail; an idempotent replay has no new
	// lifecycle event. Fresh input also proves the live observer is reattached.
	f.finish("send-now-followup", "What is 2 + 2? Answer with the number only, without tools.", "4")
}

func ollamaInterleavePermissions(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("permission-active", "Reply exactly READY without tools.")
	f.fault.waitHit(f.t)
	f.send("permission-queued", "Write BLOCKED to permission-blocked.txt if mutation tools are available. If permission is readonly, do not attempt a write or ask a question; reply READONLY.")
	if err := f.svc.SetThreadModel(f.ctx, f.meta, f.threadID, f.opts.Config.CurrentModelID); !errors.Is(err, ErrThreadBusy) {
		f.t.Fatalf("active model change=%v want busy", err)
	}
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionReadonly))
	f.fault.release()
	d := f.terminal(flruntime.TurnOutcomeCompleted)
	f.missing("permission-blocked.txt")
	if ollamaTaskText(d.Current) == "" {
		f.t.Fatal("readonly task produced no explanation")
	}
	f.check(f.svc.SetThreadModel(f.ctx, f.meta, f.threadID, f.opts.Config.CurrentModelID))
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionApprovalRequired))
	f.send("permission-pending", "Use terminal.exec exactly once to execute: printf DENIED > permission-denied.txt . If permission is denied do not call other tools; report it.")
	i := f.approval()
	f.check(f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionFullAccess))
	current := f.view()
	unresolved := false
	for _, pending := range current.Current.Interactions {
		unresolved = unresolved || pending.ID == i.ID && !pending.Resolved
	}
	if !unresolved {
		f.t.Fatal("permission upgrade silently approved an existing interaction")
	}
	f.missing("permission-denied.txt")
	_, err := f.svc.SubmitFlowerApproval(f.meta, SubmitFlowerApprovalRequest{ThreadID: f.threadID, InteractionID: i.ID, Approved: false})
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.missing("permission-denied.txt")
	f.finish("permission-restored", ollamaAppendPrompt("permission-restored.txt", "RESTORED"), "")
	f.file("permission-restored.txt", "RESTORED\n")
}

func ollamaInterleaveReconnect(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("disconnect-active", "Without tools, explain transactions in twenty paragraphs.")
	f.fault.waitHit(f.t)
	f.disconnect()
	q := f.send("disconnect-queued", ollamaAppendPrompt("reconnected.txt", "RESUMED"))
	f.stop()
	f.stoppedQueue(1)
	f.restart()
	f.stoppedQueue(1)
	_, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, q.QueueID)
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("reconnected.txt", "RESUMED\n")
	f.assertUsers(2)
	f.report["observer_reconnected"] = true
}

func ollamaInterleaveDelete(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("delete-active", "Without tools, explain databases in twenty paragraphs.")
	f.fault.waitHit(f.t)
	q := f.send("delete-queued", ollamaAppendPrompt("deleted-work.txt", "UNEXPECTED"))
	deleted := f.threadID
	if err := f.svc.DeleteThread(f.ctx, f.meta, deleted, false); !errors.Is(err, ErrThreadBusy) {
		f.t.Fatalf("active delete=%v want busy", err)
	}
	f.check(f.svc.DeleteThread(f.ctx, f.meta, deleted, true))
	f.check(f.svc.DeleteThread(f.ctx, f.meta, deleted, true))
	if detail, err := f.svc.GetFlowerThreadDetail(f.ctx, f.meta, deleted); err == nil && detail != nil {
		f.t.Fatal("deleted thread still readable")
	}
	if _, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, deleted, q.QueueID); err == nil {
		f.t.Fatal("deleted queue revived")
	}
	if _, err := f.svc.SendUserTurn(f.ctx, f.meta, SendUserTurnRequest{ThreadID: deleted, ClientRequestID: "delete-late", Input: RunInput{Text: "UNEXPECTED"}}); err == nil {
		f.t.Fatal("deleted thread accepted input")
	}
	f.missing("deleted-work.txt")
	thread, err := f.svc.CreateThread(f.ctx, f.meta, "After deletion", f.opts.Config.CurrentModelID, "", f.root)
	f.check(err)
	f.threadID = thread.ThreadID
	f.restart()
	if detail, err := f.svc.GetFlowerThreadDetail(f.ctx, f.meta, deleted); err == nil && detail != nil {
		f.t.Fatal("restart resurrected deleted thread")
	}
	f.finish("after-delete", ollamaAppendPrompt("after-delete.txt", "NEW"), "")
	f.file("after-delete.txt", "NEW\n")
	f.report["deleted_thread"] = deleted
}

func ollamaInterleaveRoots(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("root-a-active", "Without tools, explain caching in twenty paragraphs.")
	f.fault.waitHit(f.t)
	rootA := f.threadID
	other, err := f.svc.CreateThread(f.ctx, f.meta, "Independent root", f.opts.Config.CurrentModelID, "", f.root)
	f.check(err)
	f.threadID = other.ThreadID
	f.send("root-b-active", "Use terminal.exec with yield_ms 30000 to execute: printf STARTED > other-started.txt; sleep 5; printf 'OTHER_OK\\n' > other-done.txt . Verify the result and finish.")
	f.wait("independent root started", func(*FlowerThreadDetail) bool {
		_, err := os.Stat(filepath.Join(f.root, "other-started.txt"))
		return err == nil
	})
	f.threadID = rootA
	f.stop()
	f.terminal(flruntime.TurnOutcomeCancelled)
	f.threadID = other.ThreadID
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("other-done.txt", "OTHER_OK\n")
	f.report["independent_root_final"] = f.view()
	f.threadID = rootA
	f.finish("root-a-next", "Reply exactly ROOT_A_RECOVERED without tools.", "ROOT_A_RECOVERED")
}

func ollamaInterleaveChildRestart(f *ollamaTaskFixture) {
	f.send("child-restart", fmt.Sprintf("Spawn exactly one worker child named Interleaved Audit with mission_only context. Its mission: use terminal.exec with yield_ms 30000 to run 'printf STARTED > %s/child-started.txt; sleep 30; printf OLD > %s/child-late.txt', then finish. Wait for that child. Do not spawn another child.", f.root, f.root))
	f.wait("child terminal running", func(*FlowerThreadDetail) bool {
		_, err := os.Stat(filepath.Join(f.root, "child-started.txt"))
		return err == nil
	})
	q := f.send("child-parent-next", "The old delegated task is cancelled. Do not spawn or resume children. Use terminal.exec to execute: printf 'PARENT_NEW\\n' > parent-new.txt . Verify that file and finish.")
	children := f.children()
	if len(children) != 1 {
		f.t.Fatal("expected exactly one child")
	}
	f.stop()
	f.stoppedQueue(1)
	f.wait("child cancellation", func(*FlowerThreadDetail) bool {
		v, err := f.svc.threadRuntime.View(f.ctx, children[0].ID)
		f.check(err)
		return v.Activity == flruntime.ThreadActivityIdle && v.LastOutcome != nil && *v.LastOutcome == flruntime.TurnOutcomeCancelled
	})
	f.restart()
	f.stoppedQueue(1)
	v, err := f.svc.threadRuntime.View(f.ctx, children[0].ID)
	f.check(err)
	if v.LastOutcome == nil || *v.LastOutcome != flruntime.TurnOutcomeCancelled {
		f.t.Fatal("restart changed child cancellation")
	}
	_, err = f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, q.QueueID)
	f.check(err)
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("parent-new.txt", "PARENT_NEW\n")
	f.missing("child-late.txt")
	if len(f.children()) != 1 {
		f.t.Fatal("restart or continuation duplicated child")
	}
}

func ollamaInterleaveCompaction(f *ollamaTaskFixture) {
	const marker = "LIFECYCLE_FACT_INTERLEAVED_7319"
	for i := range 4 {
		facts := ""
		if i == 0 {
			facts = "For this synthetic test, the fictional fixture marker is " + marker + ". Retain it within this conversation. "
		}
		f.finish(fmt.Sprintf("compact-seed-%d", i), facts+ollamaContextBallast(12000)+"\nThe ballast is disposable. Reply ACK without tools or questions.", "ACK")
	}
	f.fault.arm("hold")
	f.send("compact-active", "Without tools, explain transaction logs in twenty paragraphs.")
	f.fault.waitHit(f.t)
	compact := f.send("compact-queued", "/compact")
	recall := f.send("compact-recall", "Return only the exact fictional fixture marker from the earlier conversation. Do not call tools.")
	if compact.Kind != "queued" || recall.Kind != "queued" {
		f.t.Fatal("compaction and recall must queue while active")
	}
	f.stop()
	f.stoppedQueue(2)
	f.restart()
	_, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, compact.QueueID)
	f.check(err)
	d := f.terminal(flruntime.TurnOutcomeCompleted)
	if ollamaTaskText(d.Current) != marker {
		f.t.Fatalf("post-compaction recall=%q", ollamaTaskText(d.Current))
	}
	if len(d.Thread.ContextCompactions) != 1 || d.Thread.ContextCompactions[0].Status != "compacted" {
		f.t.Fatalf("compaction history=%+v", d.Thread.ContextCompactions)
	}
	usage, compactions := d.Thread.ContextUsage, d.Thread.ContextCompactions
	f.restart()
	restored := f.view()
	if !reflect.DeepEqual(usage, restored.Thread.ContextUsage) || !reflect.DeepEqual(compactions, restored.Thread.ContextCompactions) {
		f.t.Fatal("restart changed compacted context accounting")
	}
	f.finish("compact-restart-recall", "Return only the exact fictional fixture marker again. Do not call tools.", marker)
	f.report["compaction"] = compactions[0]
	f.report["context_restart_preserved"] = true
	if f.view().Current.ThreadID != identity.ThreadID(f.threadID) {
		f.t.Fatal("compaction changed thread identity")
	}
}
