package ai

import (
	"context"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func approvalStatusTestMeta() *session.Meta {
	return &session.Meta{
		EndpointID:        "env_approval_status",
		NamespacePublicID: "ns_approval_status",
		ChannelID:         "ch_approval_status",
		UserPublicID:      "u_approval_status",
		UserEmail:         "approval-status@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
}

func setApprovalStatusTestRuntimeStateWithOrigin(svc *Service, endpointID string, threadID string, active bool, unresolved int, origin FlowerApprovalOrigin) {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	key := runThreadKey(endpointID, threadID)
	if active {
		svc.activeRunByTh[key] = "run_approval_status"
	} else {
		delete(svc.activeRunByTh, key)
	}
	stream := newFlowerLiveThreadStream()
	if unresolved > 0 {
		stream.State.ApprovalQueue = &FlowerApprovalQueue{
			Generation:      1,
			Revision:        int64(unresolved),
			CurrentActionID: "approval-1",
			CurrentPosition: 1,
			Total:           unresolved,
			UnresolvedCount: unresolved,
		}
		stream.State.ApprovalActions["approval-1"] = FlowerApprovalAction{
			ActionID:    "approval-1",
			Origin:      origin,
			ToolName:    "terminal.exec",
			State:       FlowerApprovalStateRequested,
			Status:      FlowerApprovalStatusPending,
			CanApprove:  true,
			QueueOrder:  1,
			BatchSize:   unresolved,
			SurfaceRole: FlowerApprovalSurfacePrimaryAction,
		}
	}
	svc.flowerLiveByThread[key] = stream
}

func setApprovalStatusTestRuntimeState(svc *Service, endpointID string, threadID string, active bool, unresolved int) {
	setApprovalStatusTestRuntimeStateWithOrigin(svc, endpointID, threadID, active, unresolved, FlowerApprovalOriginDelegatedSubagent)
}

func assertApprovalStatusThreadViews(t *testing.T, svc *Service, meta *session.Meta, threadID string, want string) {
	t.Helper()
	ctx := context.Background()

	view, err := svc.GetThread(ctx, meta, threadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil || view.RunStatus != want {
		t.Fatalf("GetThread run_status=%q, want %q", view.RunStatus, want)
	}
	list, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(list.Threads) != 1 || list.Threads[0].RunStatus != want {
		t.Fatalf("ListThreads=%#v, want one thread with run_status %q", list.Threads, want)
	}
}

func TestGetThreadAndListThreadsPreferPendingApprovalStatus(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	meta := approvalStatusTestMeta()
	svc := newTestService(t, nil)

	thread, err := svc.CreateThread(ctx, meta, "approval status", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(RunStateRunning), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState(running): %v", err)
	}

	setApprovalStatusTestRuntimeState(svc, meta.EndpointID, thread.ThreadID, true, 2)
	assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(RunStateWaitingApproval))

	setApprovalStatusTestRuntimeState(svc, meta.EndpointID, thread.ThreadID, true, 1)
	assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(RunStateWaitingApproval))

	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(RunStateWaitingUser), "", "", `{"prompt_id":"prompt-1","questions":[{"id":"answer","question":"Continue?","response_mode":"write"}]}`, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState(waiting_user): %v", err)
	}
	assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(RunStateWaitingUser))

	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(RunStateRunning), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState(running after input): %v", err)
	}
	setApprovalStatusTestRuntimeState(svc, meta.EndpointID, thread.ThreadID, true, 0)
	assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(RunStateRunning))

	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(RunStateSuccess), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState(success): %v", err)
	}
	setApprovalStatusTestRuntimeState(svc, meta.EndpointID, thread.ThreadID, false, 0)
	assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(RunStateSuccess))
}

func TestGetThreadAndListThreadsApprovalLifecycleOutcomes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	meta := approvalStatusTestMeta()
	svc := newTestService(t, nil)

	thread, err := svc.CreateThread(ctx, meta, "approval lifecycle outcomes", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	testCases := []struct {
		name       string
		persisted  RunState
		active     bool
		unresolved int
		origin     FlowerApprovalOrigin
		want       RunState
	}{
		{name: "active main tool approval", persisted: RunStateRunning, active: true, unresolved: 2, origin: FlowerApprovalOriginMainTool, want: RunStateWaitingApproval},
		{name: "pure delegated approval", persisted: RunStateRunning, active: true, unresolved: 1, origin: FlowerApprovalOriginDelegatedSubagent, want: RunStateWaitingApproval},
		{name: "approved current action with sibling pending", persisted: RunStateRunning, active: true, unresolved: 1, origin: FlowerApprovalOriginMainTool, want: RunStateWaitingApproval},
		{name: "last approval resolved", persisted: RunStateRunning, active: true, unresolved: 0, origin: FlowerApprovalOriginMainTool, want: RunStateRunning},
		{name: "current approval rejected", persisted: RunStateRunning, active: true, unresolved: 0, origin: FlowerApprovalOriginMainTool, want: RunStateRunning},
		{name: "current approval timed out", persisted: RunStateRunning, active: true, unresolved: 0, origin: FlowerApprovalOriginDelegatedSubagent, want: RunStateRunning},
		{name: "run canceled clears approvals", persisted: RunStateCanceled, active: false, unresolved: 0, origin: FlowerApprovalOriginMainTool, want: RunStateCanceled},
		{name: "active run without approvals", persisted: RunStateRunning, active: true, unresolved: 0, origin: FlowerApprovalOriginMainTool, want: RunStateRunning},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(tc.persisted), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
				t.Fatalf("UpdateThreadRunState(%s): %v", tc.persisted, err)
			}
			setApprovalStatusTestRuntimeStateWithOrigin(svc, meta.EndpointID, thread.ThreadID, tc.active, tc.unresolved, tc.origin)
			assertApprovalStatusThreadViews(t, svc, meta, thread.ThreadID, string(tc.want))
		})
	}
}

func TestListThreadsConcurrentApprovalQueueProjection(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	meta := approvalStatusTestMeta()
	svc := newTestService(t, nil)

	thread, err := svc.CreateThread(ctx, meta, "approval status race", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, thread.ThreadID, string(RunStateRunning), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			setApprovalStatusTestRuntimeState(svc, meta.EndpointID, thread.ThreadID, true, i%3)
		}
	}()

	for i := 0; i < 200; i++ {
		list, listErr := svc.ListThreads(ctx, meta, 20, "")
		if listErr != nil {
			t.Fatalf("ListThreads iteration %d: %v", i, listErr)
		}
		if len(list.Threads) != 1 {
			t.Fatalf("ListThreads iteration %d returned %d threads", i, len(list.Threads))
		}
		status := list.Threads[0].RunStatus
		if status != string(RunStateRunning) && status != string(RunStateWaitingApproval) {
			t.Fatalf("ListThreads iteration %d run_status=%q", i, status)
		}
	}
	wg.Wait()
}
