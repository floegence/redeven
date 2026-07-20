package ai

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestThreadLifecycleGateSerializesSameThreadOnly(t *testing.T) {
	svc := newSendTurnTestService(t)
	firstUnlock, err := svc.threadMgr.lockThreadLifecycle("env_gate", "thread_gate")
	if err != nil {
		t.Fatal(err)
	}
	secondAcquired := make(chan struct{})
	secondRelease := make(chan struct{})
	go func() {
		unlock, lockErr := svc.threadMgr.lockThreadLifecycle("env_gate", "thread_gate")
		if lockErr != nil {
			close(secondAcquired)
			return
		}
		close(secondAcquired)
		<-secondRelease
		unlock()
	}()
	select {
	case <-secondAcquired:
		t.Fatal("same-thread lifecycle gate was acquired concurrently")
	case <-time.After(25 * time.Millisecond):
	}
	otherUnlock, err := svc.threadMgr.lockThreadLifecycle("env_gate", "thread_other")
	if err != nil {
		t.Fatal(err)
	}
	otherUnlock()
	firstUnlock()
	select {
	case <-secondAcquired:
	case <-time.After(time.Second):
		t.Fatal("same-thread lifecycle gate did not resume")
	}
	close(secondRelease)
}

func TestThreadEffectGateAllowsConcurrentEffectsAndFencesLifecycleWriter(t *testing.T) {
	svc := newSendTurnTestService(t)
	firstRelease, err := svc.threadMgr.lockThreadEffect("env_effect_gate", "thread_effect_gate", "thread_effect_gate", threadEffectJoin{})
	if err != nil {
		t.Fatal(err)
	}
	secondRelease, err := svc.threadMgr.lockThreadEffect("env_effect_gate", "thread_effect_gate", "thread_effect_gate", threadEffectJoin{})
	if err != nil {
		firstRelease()
		t.Fatal(err)
	}

	writerAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadLifecycle("env_effect_gate", "thread_effect_gate")
		if lockErr != nil {
			writerAcquired <- nil
			return
		}
		writerAcquired <- release
	}()
	select {
	case release := <-writerAcquired:
		if release != nil {
			release()
		}
		t.Fatal("lifecycle writer crossed concurrent effects")
	case <-time.After(25 * time.Millisecond):
	}
	firstRelease()
	select {
	case release := <-writerAcquired:
		if release != nil {
			release()
		}
		t.Fatal("lifecycle writer crossed the remaining effect")
	case <-time.After(25 * time.Millisecond):
	}
	secondRelease()
	select {
	case release := <-writerAcquired:
		if release == nil {
			t.Fatal("lifecycle writer failed after effects completed")
		}
		release()
	case <-time.After(time.Second):
		t.Fatal("lifecycle writer did not resume after effects completed")
	}
}

func TestThreadEffectGateLetsActiveCohortFinishAfterWriterQueues(t *testing.T) {
	svc := newSendTurnTestService(t)
	const endpointID = "env_effect_cohort"
	const threadID = "thread_effect_cohort"
	const childThreadID = "child_effect_cohort"
	firstRelease, err := svc.threadMgr.lockThreadEffect(endpointID, threadID, threadID, threadEffectJoin{childThreadIDs: []string{childThreadID}})
	if err != nil {
		t.Fatal(err)
	}

	writerAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadLifecycle(endpointID, threadID)
		if lockErr != nil {
			writerAcquired <- nil
			return
		}
		writerAcquired <- release
	}()
	key := runThreadKey(endpointID, threadID)
	deadline := time.Now().Add(time.Second)
	for {
		svc.threadMgr.mu.Lock()
		gate := svc.threadMgr.lifecycleGates[key]
		svc.threadMgr.mu.Unlock()
		queued := false
		if gate != nil {
			gate.mu.Lock()
			queued = gate.waitingWriters > 0
			gate.mu.Unlock()
		}
		if queued {
			break
		}
		if time.Now().After(deadline) {
			firstRelease()
			t.Fatal("lifecycle writer did not queue behind the active effect")
		}
		time.Sleep(time.Millisecond)
	}

	secondAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadEffect(endpointID, threadID, childThreadID, threadEffectJoin{})
		if lockErr != nil {
			secondAcquired <- nil
			return
		}
		secondAcquired <- release
	}()
	var secondRelease func()
	select {
	case secondRelease = <-secondAcquired:
		if secondRelease == nil {
			firstRelease()
			t.Fatal("required descendant effect failed to join the active cohort")
		}
	case <-time.After(time.Second):
		firstRelease()
		t.Fatal("queued lifecycle writer blocked a required descendant effect")
	}

	unrelatedAcquired := make(chan func(), 1)
	go func() {
		release, lockErr := svc.threadMgr.lockThreadEffect(endpointID, threadID, "unrelated_child", threadEffectJoin{})
		if lockErr != nil {
			unrelatedAcquired <- nil
			return
		}
		unrelatedAcquired <- release
	}()
	select {
	case release := <-unrelatedAcquired:
		if release != nil {
			release()
		}
		secondRelease()
		firstRelease()
		t.Fatal("unrelated effect joined a close-scoped cohort after a writer queued")
	case <-time.After(25 * time.Millisecond):
	}

	secondRelease()
	select {
	case release := <-writerAcquired:
		if release != nil {
			release()
		}
		firstRelease()
		t.Fatal("lifecycle writer crossed the original active effect")
	case <-time.After(25 * time.Millisecond):
	}
	firstRelease()
	select {
	case release := <-writerAcquired:
		if release == nil {
			t.Fatal("lifecycle writer failed after the effect cohort completed")
		}
		release()
	case <-time.After(time.Second):
		t.Fatal("lifecycle writer did not resume after the effect cohort completed")
	}
	select {
	case release := <-unrelatedAcquired:
		if release == nil {
			t.Fatal("unrelated effect failed after lifecycle writer completed")
		}
		release()
	case <-time.After(time.Second):
		t.Fatal("unrelated effect did not resume after lifecycle writer completed")
	}
}

func TestPendingForkEstablishedBeforeAdmissionRejectsRunPreparation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "operation wins", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := svc.threadMgr.lockThreadLifecycle(meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		prepared, prepareErr := svc.prepareRun(meta, "run_operation_wins", RunStartRequest{
			ThreadID: thread.ThreadID,
			Input:    RunInput{MessageID: "turn_operation_wins", Text: "must not admit"},
		}, nil, nil)
		if prepared != nil {
			svc.releasePreparedRun(prepared)
		}
		result <- prepareErr
	}()
	if _, err := svc.threadsDB.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID: "fork_operation_wins", EndpointID: meta.EndpointID, SourceThreadID: thread.ThreadID,
		DestinationThreadID: "thread_operation_wins_destination", CreatedAtUnixMs: time.Now().UnixMilli(),
	}); err != nil {
		unlock()
		t.Fatal(err)
	}
	unlock()
	if err := <-result; !errors.Is(err, threadstore.ErrThreadOperationInProgress) {
		t.Fatalf("prepareRun error=%v, want %v", err, threadstore.ErrThreadOperationInProgress)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
		t.Fatal("rejected admission registered an active run")
	}
}

func TestAdmissionRegisteredBeforeForkRejectsOperation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "admission wins", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := svc.prepareRun(meta, "run_admission_wins", RunStartRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{MessageID: "turn_admission_wins", Text: "registered"},
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.releasePreparedRun(prepared)
	if _, err := svc.ForkThread(ctx, meta, thread.ThreadID, "must fail"); !errors.Is(err, ErrThreadForkUnavailable) {
		t.Fatalf("ForkThread error=%v, want %v", err, ErrThreadForkUnavailable)
	}
	operations, err := svc.threadsDB.ListPendingForkOperations(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range operations {
		if operation.SourceThreadID == thread.ThreadID && strings.TrimSpace(operation.OperationID) != "" {
			t.Fatalf("fork operation persisted after admission: %#v", operation)
		}
	}
}

func TestIdleCompactionRegisteredBeforeForkRejectsOperation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "compaction wins", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := svc.threadMgr.lockThreadLifecycle(meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	begin, err := svc.beginIdleThreadCompaction(meta.EndpointID, thread.ThreadID, "request_compaction_wins", "run_compaction_wins", FlowerTimelineAnchor{
		TargetKind: "message", MessageID: "turn_anchor", Edge: "after",
	}, func() {})
	unlock()
	if err != nil || !begin.Started {
		t.Fatalf("beginIdleThreadCompaction=%#v err=%v", begin, err)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, thread.ThreadID, begin.RequestID)
	if _, err := svc.ForkThread(ctx, meta, thread.ThreadID, "must fail"); !errors.Is(err, ErrThreadForkUnavailable) {
		t.Fatalf("ForkThread error=%v, want %v", err, ErrThreadForkUnavailable)
	}
}

func TestCanonicalAdmissionSettlementFailureBlocksForkAndDeleteIntents(t *testing.T) {
	for _, operationName := range []string{"fork", "delete"} {
		t.Run(operationName, func(t *testing.T) {
			svc := newSendTurnTestService(t)
			meta := testSendTurnMeta()
			ctx := context.Background()
			thread, err := svc.CreateThread(ctx, meta, "settlement gate", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "queue_settlement_"+operationName, "turn_settlement_"+operationName, "run_settlement_"+operationName)
			host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
			if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
				ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID),
				RunID: flruntime.RunID(command.RunID), Input: flruntime.TurnInput{Text: command.TextContent},
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.threadsDB.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
				OperationID: "fork_blocks_settlement_" + operationName, EndpointID: meta.EndpointID,
				SourceThreadID: thread.ThreadID, DestinationThreadID: "destination_blocks_settlement_" + operationName,
				CreatedAtUnixMs: time.Now().UnixMilli(),
			}); err != nil {
				t.Fatal(err)
			}

			switch operationName {
			case "fork":
				if _, err := svc.ForkThread(ctx, meta, thread.ThreadID, "must not fork"); err == nil || !strings.Contains(err.Error(), "settle admitted pending turn") {
					t.Fatalf("ForkThread error=%v, want settlement failure", err)
				}
				operations, err := svc.threadsDB.ListPendingForkOperations(ctx, 10)
				if err != nil {
					t.Fatal(err)
				}
				if len(operations) != 1 || operations[0].OperationID != "fork_blocks_settlement_fork" {
					t.Fatalf("fork operations=%#v, want only pre-existing operation", operations)
				}
			case "delete":
				if _, err := svc.DeleteThread(ctx, meta, thread.ThreadID, true); err == nil || !strings.Contains(err.Error(), "settle admitted pending turn") {
					t.Fatalf("DeleteThread error=%v, want settlement failure", err)
				}
				deleteOperation, err := svc.threadsDB.GetThreadDeleteOperation(ctx, meta.EndpointID, thread.ThreadID)
				if err != nil || deleteOperation != nil {
					t.Fatalf("delete operation=%#v err=%v, want no durable delete intent", deleteOperation, err)
				}
			}
		})
	}
}

func TestQueuedRecoveryDoesNotCompeteWithActiveAdmissionSettlementOwner(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "single settlement owner", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "queue_single_owner", "turn_single_owner", "run_single_owner")
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "admitted")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID),
		RunID: flruntime.RunID(command.RunID), Input: flruntime.TurnInput{Text: command.TextContent},
	}); err != nil {
		t.Fatal(err)
	}
	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	svc.mu.Lock()
	svc.activeRunByTh[threadKey] = command.RunID
	svc.mu.Unlock()
	targets, err := svc.recoverQueuedTurnCommandsForStartup(context.Background())
	if err == nil || !strings.Contains(err.Error(), "active runtime settlement owner") {
		t.Fatalf("queued recovery targets=%#v err=%v, want active settlement owner rejection", targets, err)
	}
	if queued, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); err != nil || queued == nil {
		t.Fatalf("active-owner queued command=%#v err=%v, want preserved", queued, err)
	}
	if _, err := svc.ForkThread(ctx, meta, thread.ThreadID, "must remain busy"); !errors.Is(err, ErrThreadForkUnavailable) {
		t.Fatalf("ForkThread error=%v, want %v", err, ErrThreadForkUnavailable)
	}
	if queued, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); err != nil || queued == nil {
		t.Fatalf("fork raced admission settlement: queued=%#v err=%v", queued, err)
	}
	svc.mu.Lock()
	delete(svc.activeRunByTh, threadKey)
	svc.mu.Unlock()
	targets, err = svc.recoverQueuedTurnCommandsForStartup(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	svc.wakeQueuedTurnRecoveryTargets(targets)
	if queued, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); !errors.Is(err, sql.ErrNoRows) || queued != nil {
		t.Fatalf("idle recovery queued command=%#v err=%v, want settled", queued, err)
	}
}

func TestForceDeletePrepareFailureLeavesActiveRunAttached(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "prepare first", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadsDB.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID: "fork_blocks_force_delete", EndpointID: meta.EndpointID, SourceThreadID: thread.ThreadID,
		DestinationThreadID: "destination_blocks_force_delete", CreatedAtUnixMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	runID := "run_force_delete_prepare_failure"
	stuck := &run{id: runID, endpointID: meta.EndpointID, threadID: thread.ThreadID, doneCh: make(chan struct{})}
	threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	t.Cleanup(func() {
		svc.mu.Lock()
		delete(svc.activeRunByTh, threadKey)
		delete(svc.runs, runID)
		svc.mu.Unlock()
		stuck.markDone()
	})
	svc.mu.Lock()
	svc.activeRunByTh[threadKey] = runID
	svc.runs[runID] = stuck
	svc.mu.Unlock()
	if _, err := svc.DeleteThread(ctx, meta, thread.ThreadID, true); !errors.Is(err, threadstore.ErrThreadOperationInProgress) {
		t.Fatalf("DeleteThread error=%v, want %v", err, threadstore.ErrThreadOperationInProgress)
	}
	svc.mu.Lock()
	activeRunID := svc.activeRunByTh[threadKey]
	svc.mu.Unlock()
	if activeRunID != runID || stuck.isDetached() {
		t.Fatalf("active run changed before durable delete intent: active=%q detached=%t", activeRunID, stuck.isDetached())
	}
}

func TestRenameThreadUsesLifecycleGateForWritableCheckAndCanonicalWrite(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "before rename", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := svc.threadMgr.lockThreadLifecycle(meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- svc.RenameThread(ctx, meta, thread.ThreadID, "after rename")
	}()
	select {
	case err := <-done:
		unlock()
		t.Fatalf("RenameThread bypassed lifecycle gate: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	snapshot, _, err := svc.readCanonicalThreadState(ctx, thread.ThreadID)
	if err != nil {
		unlock()
		t.Fatal(err)
	}
	if snapshot.Title != "before rename" {
		unlock()
		t.Fatalf("canonical title changed while lifecycle gate was held: %q", snapshot.Title)
	}
	unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	snapshot, _, err = svc.readCanonicalThreadState(ctx, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Title != "after rename" {
		t.Fatalf("canonical title=%q, want after rename", snapshot.Title)
	}
}
