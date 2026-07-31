package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v3/config"
	"github.com/floegence/floret/v3/identity"
	"github.com/floegence/floret/v3/observation"
	flruntime "github.com/floegence/floret/v3/runtime"
	fltools "github.com/floegence/floret/v3/tools"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/websearch"
)

type recordingSubagentRuntime struct {
	releaseCount atomic.Int32
}

func insertFinalizedChildPermissionSnapshotForTest(t *testing.T, parent *run, childThreadID string, childRunID string, spawnToolCallID string, snapshot PermissionSnapshot) error {
	t.Helper()
	record, err := parent.childPermissionSnapshotRecord(
		childThreadID,
		childRunID,
		spawnToolCallID,
		"finalized",
		parent.currentPermissionSnapshot(),
		snapshot,
	)
	if err != nil {
		return err
	}
	return runThreadStoreForTest(t, parent).InsertChildPermissionSnapshot(context.Background(), record)
}

func (r *recordingSubagentRuntime) manage(context.Context, string, map[string]any) (map[string]any, error) {
	return map[string]any{"status": "ok"}, nil
}

func (r *recordingSubagentRuntime) release() {
	r.releaseCount.Add(1)
}

func (r *recordingSubagentRuntime) snapshots(context.Context) ([]subagentSnapshot, error) {
	return nil, nil
}

func TestRunCancelDoesNotReleaseSubagentRuntime(t *testing.T) {
	t.Parallel()

	runtime := &recordingSubagentRuntime{}
	r := newRun(runOptions{
		Log:             slog.Default(),
		AgentHomeDir:    t.TempDir(),
		SubagentRuntime: runtime,
	})

	r.requestCancel("canceled")
	r.cancel()

	if got := runtime.releaseCount.Load(); got != 0 {
		t.Fatalf("releaseCount=%d, want 0; parent cancellation must not close durable subagent runtime", got)
	}
}

func TestFloretSubagentTerminalCleanupSettlesCompletedChildPendingProcess(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	svc := &Service{
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.Default(),
		persistOpTO:       5 * time.Second,
	}

	endpointID := "env_subagent_cleanup"
	parentThreadID := "parent_thread_cleanup"
	parentRunID := "run_parent_cleanup"
	parentTurnID := "turn_parent_cleanup"
	parent := newTerminalProcessTestRun(t, workspace, svc, store, endpointID, parentThreadID, parentRunID, parentTurnID)
	parent.permissionSnapshot = permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil), endpointID, parentThreadID, parentRunID,
	)

	completedChildThreadID := "child_thread_completed"
	completedChildRunID := "run_child_completed"
	completedChildTurnID := "turn_child_completed"
	completedFloretRunID := "floret_run_completed"
	completedFloretTurnID := "floret_turn_completed"
	runningChildThreadID := "child_thread_running"
	runningChildRunID := "run_child_running"
	runningChildTurnID := "turn_child_running"
	completedPermissionSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil), endpointID, completedChildThreadID, completedChildRunID,
	)
	if err := insertFinalizedChildPermissionSnapshotForTest(t, parent, completedChildThreadID, completedChildRunID, "tool_spawn_completed", completedPermissionSnapshot); err != nil {
		t.Fatalf("insert completed child snapshot: %v", err)
	}
	runningPermissionSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil), endpointID, runningChildThreadID, runningChildRunID,
	)
	if err := insertFinalizedChildPermissionSnapshotForTest(t, parent, runningChildThreadID, runningChildRunID, "tool_spawn_running", runningPermissionSnapshot); err != nil {
		t.Fatalf("insert running child snapshot: %v", err)
	}
	upsertTerminalProcessTestRun(t, store, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID)
	upsertTerminalProcessTestRun(t, store, endpointID, runningChildThreadID, runningChildRunID, runningChildTurnID)

	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{
			{ParentThreadID: identity.ThreadID(parentThreadID), ThreadID: identity.ThreadID(completedChildThreadID), Status: flruntime.SubAgentStatusCompleted, LatestTurnID: identity.TurnID(completedFloretTurnID)},
			{ParentThreadID: identity.ThreadID(parentThreadID), ThreadID: identity.ThreadID(runningChildThreadID), Status: flruntime.SubAgentStatusRunning, LatestTurnID: identity.TurnID(runningChildTurnID)},
		},
		settleResult: terminalProcessTestSettlementResult(terminalProcessTestProjection(completedFloretRunID, completedChildThreadID, completedFloretTurnID, "tool_completed")),
	}
	completedChildRun := newTerminalProcessTestRun(t, workspace, svc, store, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID)
	completedChildRun.settlementThreadID = completedChildThreadID
	completedChildRun.settlementRunID = completedFloretRunID
	completedChildRun.settlementTurnID = completedFloretTurnID
	completedChildRun.setActiveFloretHost(host)
	svc.runs = map[string]*run{completedChildRunID: completedChildRun}

	runtime := newFloretSubagentRuntimeWithExecutionOwner(parent, func(_ *run, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
		return svc.bindSubagentExecutionForParent(parent, childThreadID, childRunID)
	})
	runtime.host = host
	completedProc := startPendingTerminalProcessForTestWithSettlement(t, manager, host, workspace, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID, completedFloretRunID, completedFloretTurnID, "tool_completed")
	runningProc := startPendingTerminalProcessForTest(t, manager, host, workspace, endpointID, runningChildThreadID, runningChildRunID, runningChildTurnID, "tool_running")

	if err := runtime.cleanupTerminalProcessesForTerminalSubagents(context.Background()); err != nil {
		t.Fatalf("cleanupTerminalProcessesForTerminalSubagents: %v", err)
	}

	host.mu.Lock()
	settleRequests := append([]floretPendingToolSettlementRequest(nil), host.settleRequests...)
	host.mu.Unlock()
	if len(settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want 1", len(settleRequests))
	}
	if settleRequests[0].Target.ThreadID != identity.ThreadID(completedChildThreadID) ||
		settleRequests[0].Target.RunID != identity.RunID(completedFloretRunID) ||
		settleRequests[0].Target.TurnID != identity.TurnID(completedFloretTurnID) ||
		settleRequests[0].Target.ToolCallID != "tool_completed" ||
		settleRequests[0].Status != flruntime.PendingToolSettlementCanceled {
		t.Fatalf("settle request=%#v, want completed child terminal cancellation", settleRequests[0])
	}
	completedSnapshot := completedProc.Snapshot()
	if completedSnapshot.Status != terminalProcessStatusCanceled {
		t.Fatalf("completed child terminal status=%q, want canceled", completedSnapshot.Status)
	}
	if completedSnapshot.RunID != completedChildRunID || completedSnapshot.TurnID != completedChildTurnID {
		t.Fatalf("completed child product identity=%#v", completedSnapshot)
	}
	runningSnapshot := runningProc.Snapshot()
	if runningSnapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("running child terminal status=%q, want running", runningSnapshot.Status)
	}
}

type recordingFloretHost struct {
	mu                 sync.Mutex
	threadID           identity.ThreadID
	parentThreadID     identity.ThreadID
	closeSubagentCount atomic.Int32
	deleteThreadCount  atomic.Int32
	listSubagentCount  atomic.Int32
	spawnErr           error
	snapshots          []flruntime.SubAgentSnapshot
	threads            map[identity.ThreadID]flruntime.ThreadSnapshot
	detail             flruntime.SubAgentDetail
	detailErr          error
	detailThreadIDs    []identity.ThreadID
	detailRequests     []flruntime.ThreadDetailRequest
	turnPage           flruntime.ThreadTurnsPage
	turnPages          []flruntime.ThreadTurnsPage
	turnErr            error
	turnRequests       []flruntime.ThreadTurnsRequest
	exactTurnRequests  []identity.TurnID
	spawnRequests      []flruntime.SpawnSubAgentCommand
	afterSpawn         func(flruntime.SpawnSubAgentCommand, flruntime.SubAgentSnapshot) error
	sendInputRequests  []flruntime.SendSubAgentMessageCommand
	sendInputResult    *flruntime.SubAgentSnapshot
	settleRequests     []floretPendingToolSettlementRequest
	settleResult       flruntime.PendingToolSettlementResult
	settleErr          error
	readProjection     flruntime.ThreadTurnProjection
	readProjectionErr  error
	readProjectionReqs []testReadTurnProjectionRequest
	deleteThreadIDs    []identity.ThreadID
	closeSubagentReqs  []flruntime.CloseSubAgentCommand
	closeResult        *flruntime.SubAgentSnapshot
	approvalQueue      flruntime.ApprovalQueue
	resolveApproval    func(flruntime.ResolveApprovalCommand) (flruntime.ResolveApprovalResult, error)
	resolveApprovalReq []flruntime.ResolveApprovalCommand
}

type testReadTurnProjectionRequest struct {
	ThreadID identity.ThreadID
	TurnID   identity.TurnID
	RunID    identity.RunID
}

func bindFloretSubagentRead(svc *Service, parentThreadID string, host floretSubagentReadHost) {
	if svc.floretReads == nil {
		svc.floretReads = &floretReadCapabilities{}
	}
	svc.floretReads.subagent = func(_ context.Context, got identity.ThreadID) (floretSubagentReadHost, error) {
		if strings.TrimSpace(string(got)) != strings.TrimSpace(parentThreadID) {
			return nil, errors.New("unexpected SubAgent read parent")
		}
		return host, nil
	}
}

type recordingFloretSubagentReadHost struct {
	host *recordingFloretHost
}

func bindRecordingSubagentReadHost(svc *Service, parentThreadID string, host *recordingFloretHost) {
	host.mu.Lock()
	host.parentThreadID = identity.ThreadID(parentThreadID)
	host.mu.Unlock()
	bindFloretSubagentRead(svc, parentThreadID, recordingFloretSubagentReadHost{host: host})
}

func (h recordingFloretSubagentReadHost) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return h.host.ListSubAgents(ctx)
}

func (h recordingFloretSubagentReadHost) ReadThreadTurn(ctx context.Context, _ identity.ThreadID, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return h.host.ReadThreadTurn(ctx, turnID)
}

func (h recordingFloretSubagentReadHost) ListThreadTurns(ctx context.Context, childThreadID identity.ThreadID, request flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.host.listThreadTurns(ctx, request, childThreadID)
}

func (h recordingFloretSubagentReadHost) ReadSubAgentDetail(ctx context.Context, childThreadID identity.ThreadID, request flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error) {
	return h.host.readSubAgentDetail(ctx, childThreadID, request)
}

func bindRecordingThreadRead(svc *Service, threadID string, host floretThreadReadHost) {
	if svc.floretReads == nil {
		svc.floretReads = &floretReadCapabilities{}
	}
	if recorder, ok := host.(*recordingFloretHost); ok {
		recorder.mu.Lock()
		recorder.threadID = identity.ThreadID(threadID)
		recorder.mu.Unlock()
	}
	svc.floretReads.thread = func(_ context.Context, got identity.ThreadID) (floretThreadReadHost, error) {
		if strings.TrimSpace(string(got)) != strings.TrimSpace(threadID) {
			return nil, errors.New("unexpected thread read authority")
		}
		return host, nil
	}
}

func bindRecordingThreadDelete(svc *Service, threadID string, host interface {
	Delete(context.Context) error
}) {
	if recorder, ok := host.(*recordingFloretHost); ok {
		recorder.mu.Lock()
		recorder.threadID = identity.ThreadID(threadID)
		recorder.mu.Unlock()
	}
	svc.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, got identity.ThreadID) error {
		if strings.TrimSpace(string(got)) != strings.TrimSpace(threadID) {
			return errors.New("unexpected thread delete authority")
		}
		return host.Delete(ctx)
	})}
}

func (h *recordingFloretHost) ReadThreadAgentTodos(context.Context) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: h.threadID}, nil
}

func (h *recordingFloretHost) UpdateThreadAgentTodos(_ context.Context, req flruntime.UpdateTodosCommand) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: h.threadID, Version: req.ExpectedVersion + 1, Items: req.Items}, nil
}

func (h *recordingFloretHost) ReadThread(context.Context) (flruntime.ThreadSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.threads != nil {
		if snapshot, ok := h.threads[h.threadID]; ok {
			return snapshot, nil
		}
	}
	return flruntime.ThreadSnapshot{}, nil
}

func (h *recordingFloretHost) ReadThreadOverview(ctx context.Context) (flruntime.ThreadOverview, error) {
	snapshot, err := h.ReadThread(ctx)
	if err != nil {
		return flruntime.ThreadOverview{}, err
	}
	return flruntime.ThreadOverview{Thread: snapshot}, nil
}

func (h *recordingFloretHost) ReadThreadContext(context.Context) (flruntime.ThreadContextSnapshot, error) {
	return flruntime.ThreadContextSnapshot{ThreadID: h.threadID}, nil
}

func (h *recordingFloretHost) ListThreadTurns(_ context.Context, req flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return h.listThreadTurns(context.Background(), req, h.threadID)
}

func (h *recordingFloretHost) listThreadTurns(_ context.Context, req flruntime.ThreadTurnsRequest, defaultThreadID identity.ThreadID) (flruntime.ThreadTurnsPage, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.turnRequests = append(h.turnRequests, req)
	if h.turnErr != nil {
		return flruntime.ThreadTurnsPage{}, h.turnErr
	}
	page := h.turnPage
	if len(h.turnPages) > 0 {
		page = h.turnPages[0]
		h.turnPages = h.turnPages[1:]
	}
	if page.ThreadID == "" {
		page.ThreadID = defaultThreadID
	}
	return page, nil
}

func (h *recordingFloretHost) ReadThreadTurn(_ context.Context, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.exactTurnRequests = append(h.exactTurnRequests, turnID)
	if h.turnErr != nil {
		return flruntime.ThreadTurnSnapshot{}, h.turnErr
	}
	pages := append([]flruntime.ThreadTurnsPage{h.turnPage}, h.turnPages...)
	for _, page := range pages {
		for _, turn := range page.Turns {
			if turn.TurnID == turnID {
				return turn, nil
			}
		}
	}
	return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
}

func (h *recordingFloretHost) ReadApprovalQueue(context.Context) (flruntime.ApprovalQueue, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	queue := h.approvalQueue
	if queue.RootThreadID == "" {
		queue = flruntime.ApprovalQueue{RootThreadID: h.threadID, GeneratedAt: time.Now()}
	}
	queue.Items = append([]flruntime.ApprovalRecord(nil), queue.Items...)
	return queue, nil
}

func (h *recordingFloretHost) ResolveApproval(_ context.Context, req flruntime.ResolveApprovalCommand) (flruntime.ResolveApprovalResult, error) {
	h.mu.Lock()
	h.resolveApprovalReq = append(h.resolveApprovalReq, req)
	resolve := h.resolveApproval
	h.mu.Unlock()
	if resolve == nil {
		return flruntime.ResolveApprovalResult{}, errors.New("unexpected approval resolution")
	}
	return resolve(req)
}

func (h *recordingFloretHost) ReadTurnProjection(_ context.Context, turnID identity.TurnID, runID identity.RunID) (flruntime.ThreadTurnProjection, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.readProjectionReqs = append(h.readProjectionReqs, testReadTurnProjectionRequest{ThreadID: h.threadID, TurnID: turnID, RunID: runID})
	if h.readProjectionErr != nil {
		return flruntime.ThreadTurnProjection{}, h.readProjectionErr
	}
	if h.readProjection.RunID != "" || h.readProjection.ThreadID != "" || h.readProjection.TurnID != "" || len(h.readProjection.Segments) > 0 {
		return h.readProjection, nil
	}
	return flruntime.ThreadTurnProjection{}, flruntime.ErrTurnNotFound
}

func (h *recordingFloretHost) SettlePendingTool(_ context.Context, req floretPendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.settleRequests = append(h.settleRequests, req)
	if h.settleErr != nil {
		return flruntime.PendingToolSettlementResult{}, h.settleErr
	}
	result := h.settleResult
	if strings.TrimSpace(string(result.Target.ThreadID)) == "" {
		result.Target = req.Target
	}
	if strings.TrimSpace(string(result.Event.ThreadID)) == "" {
		result.Event = pendingToolSettlementResultForTest(result.Target, result.ProjectionAvailability, result.Projection, result.ProjectionError).Event
	}
	return result, nil
}

func (h *recordingFloretHost) SpawnSubAgent(_ context.Context, req flruntime.SpawnSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	h.spawnRequests = append(h.spawnRequests, req)
	if h.spawnErr != nil {
		err := h.spawnErr
		h.mu.Unlock()
		return flruntime.SubAgentSnapshot{}, err
	}
	now := time.Now()
	childThreadID := identity.ThreadID("fixture_child_" + strings.TrimSpace(req.TaskName))
	if len(h.snapshots) > 0 && h.snapshots[len(h.snapshots)-1].ThreadID != "" {
		childThreadID = h.snapshots[len(h.snapshots)-1].ThreadID
	}
	snapshot := flruntime.SubAgentSnapshot{
		ThreadID:        childThreadID,
		ParentThreadID:  h.parentThreadID,
		TaskName:        req.TaskName,
		TaskDescription: req.TaskDescription,
		HostProfileRef:  req.HostProfileRef,
		ForkMode:        req.ForkMode,
		Status:          flruntime.SubAgentStatusRunning,
		CreatedAt:       now,
		UpdatedAt:       now,
		CanSendInput:    true,
		CanInterrupt:    true,
		CanClose:        true,
	}
	h.snapshots = append(h.snapshots, snapshot)
	afterSpawn := h.afterSpawn
	h.mu.Unlock()
	if afterSpawn != nil {
		if err := afterSpawn(req, snapshot); err != nil {
			return flruntime.SubAgentSnapshot{}, err
		}
	}
	return snapshot, nil
}

func (h *recordingFloretHost) SendSubAgentInput(_ context.Context, req flruntime.SendSubAgentMessageCommand) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sendInputRequests = append(h.sendInputRequests, req)
	if h.sendInputResult != nil {
		return *h.sendInputResult, nil
	}
	for _, snapshot := range h.snapshots {
		if snapshot.ThreadID == req.ChildThreadID {
			snapshot.UpdatedAt = time.Now()
			return snapshot, nil
		}
	}
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) InterruptSubAgent(_ context.Context, req flruntime.InterruptSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, snapshot := range h.snapshots {
		if snapshot.ThreadID != req.ChildThreadID {
			continue
		}
		snapshot.UpdatedAt = time.Now()
		h.snapshots[index] = snapshot
		return snapshot, nil
	}
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) WaitSubAgents(_ context.Context, req flruntime.WaitSubAgentsCommand) (flruntime.WaitSubAgentsResult, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	targets := map[identity.ThreadID]struct{}{}
	for _, id := range req.ChildThreadIDs {
		targets[id] = struct{}{}
	}
	out := make([]flruntime.SubAgentSnapshot, 0, len(h.snapshots))
	for _, snapshot := range h.snapshots {
		if len(targets) == 0 {
			out = append(out, snapshot)
			continue
		}
		if _, ok := targets[snapshot.ThreadID]; ok {
			out = append(out, snapshot)
		}
	}
	return flruntime.WaitSubAgentsResult{Snapshots: out}, nil
}

func (h *recordingFloretHost) ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error) {
	h.listSubagentCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (h *recordingFloretHost) CloseSubAgent(_ context.Context, req flruntime.CloseSubAgentCommand) (flruntime.SubAgentSnapshot, error) {
	h.closeSubagentCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closeSubagentReqs = append(h.closeSubagentReqs, req)
	if h.closeResult != nil {
		return *h.closeResult, nil
	}
	for index, snapshot := range h.snapshots {
		if snapshot.ThreadID != req.ChildThreadID {
			continue
		}
		snapshot.Status = flruntime.SubAgentStatusClosed
		snapshot.Closed = true
		snapshot.CanClose = false
		snapshot.CanSendInput = false
		snapshot.CanInterrupt = false
		snapshot.UpdatedAt = time.Now()
		h.snapshots[index] = snapshot
		return snapshot, nil
	}
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) readSubAgentDetail(_ context.Context, childThreadID identity.ThreadID, req flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.detailThreadIDs = append(h.detailThreadIDs, childThreadID)
	h.detailRequests = append(h.detailRequests, req)
	if h.detailErr != nil {
		return flruntime.SubAgentDetail{}, h.detailErr
	}
	return h.detail, nil
}

func (h *recordingFloretHost) Delete(context.Context) error {
	h.deleteThreadCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deleteThreadIDs = append(h.deleteThreadIDs, h.threadID)
	return nil
}

type testFloretReadHost struct {
	floretThreadReadHost
	floretSubagentReadHost
}

func openTestFloretHost(t *testing.T, storePath string, parentThreadID string, fakeResponse string) (testFloretReadHost, *flruntime.Host) {
	t.Helper()
	source, err := prepareFloretStorage(context.Background(), storePath, nil)
	if err != nil {
		t.Fatalf("prepare Floret storage: %v", err)
	}
	store, err := flruntime.Open(context.Background(), flruntime.Options{Storage: source})
	if err != nil {
		t.Fatalf("runtime.Open: %v", err)
	}
	adapter := testFloretBootstrap(t, store)
	_ = fakeResponse
	subagentRead, err := adapter.newSubagentRead(context.Background(), identity.ThreadID(parentThreadID))
	if err != nil {
		_ = store.Shutdown(context.Background())
		t.Fatalf("open SubAgent read host: %v", err)
	}
	threadRead, err := adapter.newThreadRead(context.Background(), identity.ThreadID(parentThreadID))
	if err != nil {
		_ = store.Shutdown(context.Background())
		t.Fatalf("open thread read host: %v", err)
	}
	return testFloretReadHost{floretThreadReadHost: threadRead, floretSubagentReadHost: subagentRead}, store
}

type testFloretHost struct {
	floretTurnHost
	floretSubagentHost
}

func (h *testFloretHost) Run(ctx context.Context, command flruntime.StartTurnCommand) (flruntime.TurnResult, error) {
	started, err := h.StartTurn(ctx, command)
	if err != nil {
		return flruntime.TurnResult{}, err
	}
	snapshot, err := h.ReadTurn(ctx, started.TurnID)
	if err != nil {
		return flruntime.TurnResult{}, err
	}
	return floretTurnResultFromSnapshot(started.ThreadID, snapshot), nil
}

func newTestFloretHostFromService(t *testing.T, svc *Service, parentThreadID string, fakeResponse string) *testFloretHost {
	t.Helper()
	if svc == nil || svc.floretRuntime == nil {
		t.Fatal("Floret runtime capability is required")
	}
	runtimeCaps, err := svc.bindFloretThreadRuntime(parentThreadID)
	if err != nil {
		t.Fatalf("bind thread runtime: %v", err)
	}
	turnHost, err := runtimeCaps.Turn(context.Background(), newStaticTestFloretAgent(t, fakeResponse))
	if err != nil {
		t.Fatalf("NewHost: %v", err)
	}
	subagentHost, err := runtimeCaps.SubAgent(context.Background(), newStaticTestFloretAgent(t, fakeResponse))
	if err != nil {
		t.Fatalf("NewSubagentHost: %v", err)
	}
	return &testFloretHost{floretTurnHost: turnHost, floretSubagentHost: subagentHost}
}

func seedTestFloretSubagentTree(t *testing.T, ctx context.Context, svc *Service, parentThreadID string, requestSeed string, mission ...string) (string, string) {
	t.Helper()
	delegatedMission := "work"
	if len(mission) > 0 {
		delegatedMission = mission[0]
	}
	storePath, err := floretThreadStorePath(svc.stateDir)
	if err != nil {
		t.Fatalf("floretThreadStorePath: %v", err)
	}
	runtimeCaps, err := svc.bindFloretThreadRuntime(parentThreadID)
	if err != nil {
		t.Fatalf("bind thread runtime: %v", err)
	}
	turnHost, err := runtimeCaps.Turn(ctx, newStaticTestFloretAgent(t, "parent done"))
	if err != nil {
		t.Fatalf("open parent turn host: %v", err)
	}
	subagentHost, err := runtimeCaps.SubAgent(ctx, newStaticTestFloretAgent(t, "child done"))
	if err != nil {
		t.Fatalf("open parent SubAgent host: %v", err)
	}
	host := &testFloretHost{floretTurnHost: turnHost, floretSubagentHost: subagentHost}
	parentResult, err := host.Run(ctx, flruntime.StartTurnCommand{
		LogicalRequestID: identity.LogicalRequestID("fixture_parent_request_" + requestSeed),
		UserMessage:      flruntime.TurnInput{Text: "spawn fixture child"},
	})
	if err != nil {
		t.Fatalf("complete parent fixture turn: %v", err)
	}
	spawned, err := host.SpawnSubAgent(ctx, flruntime.SpawnSubAgentCommand{
		LogicalRequestID: identity.LogicalRequestID("test-publication-" + parentThreadID + "-" + requestSeed),
		ParentTurnID:     parentResult.TurnID,
		TaskName:         "child",
		Input:            flruntime.TurnInput{Text: delegatedMission},
		ForkMode:         flruntime.SubAgentForkNone,
	})
	if err != nil {
		t.Fatalf("SpawnSubAgent: %v", err)
	}
	childThreadID := string(spawned.ThreadID)
	if waited, err := host.WaitSubAgents(ctx, flruntime.WaitSubAgentsCommand{
		ChildThreadIDs: []identity.ThreadID{identity.ThreadID(childThreadID)},
		Timeout:        2 * time.Second,
	}); err != nil || waited.TimedOut {
		t.Fatalf("WaitSubAgents=%#v err=%v", waited, err)
	}
	return storePath, childThreadID
}

func TestServiceGetFlowerSubagentDetailUsesPublishedTypedOriginForMissionVisibility(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	const delegatedMission = "internal delegated mission sentinel 7f1a6c"
	_, childThreadID := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, "typed_origin_visibility", delegatedMission)

	readHost, err := svc.openFloretSubagentReadHost(ctx, parent.ThreadID)
	if err != nil {
		t.Fatalf("open SubAgent read host: %v", err)
	}
	turns, err := listAllFloretThreadTurns(ctx, childThreadTurnsReader{
		host:          readHost,
		childThreadID: identity.ThreadID(childThreadID),
	}, childThreadID)
	if err != nil {
		t.Fatalf("ListThreadTurns: %v", err)
	}
	if len(turns) != 1 || turns[0].UserInput != delegatedMission ||
		turns[0].UserMessageOrigin != flruntime.ThreadUserMessageOriginDelegatedMission ||
		strings.TrimSpace(turns[0].UserEntryID) == "" {
		t.Fatalf("published typed child turn=%#v", turns)
	}

	detail, err := svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, childThreadID, 0, 200)
	if err != nil {
		t.Fatalf("GetFlowerSubagentDetail: %v", err)
	}
	wire, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal detail: %v", err)
	}
	if strings.Contains(string(wire), delegatedMission) {
		t.Fatalf("delegated mission leaked into Redeven detail payload: %s", wire)
	}
	if !strings.Contains(string(wire), "child done") {
		t.Fatalf("canonical assistant result missing from Redeven detail payload: %s", wire)
	}
}

func TestSubagentProductRequestIdentitiesAreStableAndScoped(t *testing.T) {
	publicationA, err := subagentPublicationID("parent", "turn", "tool")
	if err != nil {
		t.Fatal(err)
	}
	publicationB, err := subagentPublicationID("parent", "turn", "tool")
	if err != nil {
		t.Fatal(err)
	}
	if publicationA == "" || publicationA != publicationB {
		t.Fatalf("publication identity is not deterministic: %q vs %q", publicationA, publicationB)
	}
	inputA, err := subagentInputRequestID("parent", "floret-allocated-child", "input-tool")
	if err != nil {
		t.Fatal(err)
	}
	inputB, err := subagentInputRequestID("parent", "floret-allocated-child", "input-tool")
	if err != nil {
		t.Fatal(err)
	}
	if inputA == "" || inputA != inputB {
		t.Fatalf("input identity is not deterministic: %q vs %q", inputA, inputB)
	}
}

func assertLegacyFloretSubagentStoreNotCreated(t *testing.T, svc *Service) {
	t.Helper()
	path := filepath.Join(svc.stateDir, "ai", "floret_subagents.sqlite")
	if _, err := os.Stat(path); err == nil {
		t.Fatalf("legacy Floret subagent store was created at %s", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat legacy Floret subagent store: %v", err)
	}
}

func TestServiceCloseReleasesThreadSubagentRuntimes(t *testing.T) {
	t.Parallel()

	host := &recordingFloretHost{}
	runtime := &floretSubagentRuntime{host: host}
	svc := &Service{
		realtimeWriters:              map[*rpc.Server]*aiSinkWriter{},
		realtimeSummaryByEndpoint:    map[string]map[*rpc.Server]struct{}{},
		realtimeSummaryEndpointBySRV: map[*rpc.Server]string{},
		realtimeByThread:             map[string]map[*rpc.Server]struct{}{},
		realtimeThreadBySRV:          map[*rpc.Server]string{},
		flowerLiveByThread:           map[string]*flowerLiveThreadStream{},
		runs:                         map[string]*run{},
		activeRunByTh:                map[string]string{},
		subagentRuntimes:             map[string]*floretSubagentRuntime{"env:thread": runtime},
	}

	if err := svc.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if len(svc.subagentRuntimes) != 0 {
		t.Fatalf("subagent runtime cache not cleared: %#v", svc.subagentRuntimes)
	}
}

func TestSubagentHostConfigKeyTracksRuntimeInputs(t *testing.T) {
	t.Parallel()

	providerKey := "provider-key-1"
	webSearchKey := "web-key-1"
	cfg := &config.AIConfig{
		CurrentModelID: "compat/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "compat",
			Type:    "openai_compatible",
			BaseURL: "https://example.invalid/v1",
			WebSearch: &config.AIProviderWebSearch{
				Mode: config.AIProviderWebSearchModeBrave,
			},
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	svc, err := NewService(Options{
		Logger:       slog.Default(),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Config:       cfg,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "compat" {
				return providerKey, true, nil
			}
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	r := newRun(runOptions{
		Log:              slog.Default(),
		StateDir:         t.TempDir(),
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env", "parent"),
		AIConfig:         cfg,
		ResolveProviderKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "compat" {
				return providerKey, true, nil
			}
			return "", false, nil
		},
		ResolveWebSearchKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == websearch.ProviderBrave {
				return webSearchKey, true, nil
			}
			return "", false, nil
		},
		ThreadID:   "parent",
		EndpointID: "env",
	})
	r.currentModelID = "compat/gpt-5-mini"

	baseKey, err := r.subagentHostConfigKey(context.Background(), resolvedSubagentRunModel{})
	if err != nil {
		t.Fatalf("subagentHostConfigKey base: %v", err)
	}
	assertSubagentHostKeyChanges := func(name string, mutate func(), restore func()) {
		t.Helper()
		mutate()
		nextKey, err := r.subagentHostConfigKey(context.Background(), resolvedSubagentRunModel{})
		if err != nil {
			t.Fatalf("%s subagentHostConfigKey: %v", name, err)
		}
		if nextKey == baseKey {
			t.Fatalf("%s did not change subagent host config key", name)
		}
		restore()
		restored, err := r.subagentHostConfigKey(context.Background(), resolvedSubagentRunModel{})
		if err != nil {
			t.Fatalf("%s restored subagentHostConfigKey: %v", name, err)
		}
		if restored != baseKey {
			t.Fatalf("%s restore key=%q, want base %q", name, restored, baseKey)
		}
	}

	assertSubagentHostKeyChanges("provider api key", func() {
		providerKey = "provider-key-2"
	}, func() {
		providerKey = "provider-key-1"
	})
	assertSubagentHostKeyChanges("web search key", func() {
		webSearchKey = "web-key-2"
	}, func() {
		webSearchKey = "web-key-1"
	})
	assertSubagentHostKeyChanges("permission type", func() {
		r.permissionType = FlowerPermissionFullAccess
	}, func() {
		r.permissionType = FlowerPermissionApprovalRequired
	})
	assertSubagentHostKeyChanges("web search mode", func() {
		cfg.Providers[0].WebSearch.Mode = config.AIProviderWebSearchModeDisabled
	}, func() {
		cfg.Providers[0].WebSearch.Mode = config.AIProviderWebSearchModeBrave
	})
	assertSubagentHostKeyChanges("model context capability", func() {
		cfg.Providers[0].Models[0].ContextWindow = 1_000_000
	}, func() {
		cfg.Providers[0].Models[0].ContextWindow = 0
	})
	assertSubagentHostKeyChanges("wire model capability", func() {
		cfg.Providers[0].Models[0].WireModelName = "provider/gpt-5-mini"
	}, func() {
		cfg.Providers[0].Models[0].WireModelName = ""
	})
}

func TestFloretSubagentsSpawnPersistsAndLabelsDistinctChildRunID(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(t.TempDir() + "/threads.sqlite")
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	cfg := &config.AIConfig{
		CurrentModelID: "compat/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "compat",
			Type:    "openai_compatible",
			BaseURL: "https://example.invalid/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	svc := &Service{
		threadsDB:          store,
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		persistOpTO:        time.Second,
	}
	parent := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "subagent_spawn_identity")
	bindPermissionPolicyRunsToService(t, svc, parent)
	parent.cfg = cfg
	parent.currentModelID = "compat/gpt-5-mini"
	parent.resolveProviderKey = func(providerID string) (string, bool, error) {
		return "provider-key", strings.TrimSpace(providerID) == "compat", nil
	}
	freezePermissionPolicyTestSnapshot(t, parent)
	authorizationSnapshot := parent.currentPermissionSnapshot()
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: parent.threadID, EndpointID: parent.endpointID,
		PermissionType: config.AIPermissionApprovalRequired, WorkingDir: t.TempDir(),
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	host := &recordingFloretHost{parentThreadID: identity.ThreadID(parent.threadID)}
	runtime := newFloretSubagentRuntimeWithExecutionOwner(parent, svc.bindSubagentExecutionForParent)
	runtime.host = host
	surfaceProvider := runtime.dynamicSubagentToolSurfaceProvider(newFloretToolRuntimeState(newTodoRuntimeState()))
	host.afterSpawn = func(req flruntime.SpawnSubAgentCommand, snapshot flruntime.SubAgentSnapshot) error {
		_, err := surfaceProvider(context.Background(), flruntime.ToolSurfaceRequest{
			RunID: identity.RunID("run_child_spawn_identity"), ThreadID: snapshot.ThreadID, TurnID: "turn_child_spawn_identity", Labels: req.Labels,
		})
		return err
	}
	spawnToolCallID := "tool_subagents_spawn_identity"
	parent.setPermissionType(FlowerPermissionFullAccess)
	freezePermissionPolicyTestSnapshot(t, parent)
	spawnCtx := contextWithToolAuthorizationSnapshot(context.Background(), authorizationSnapshot)
	spawnResult, err := runtime.spawn(spawnCtx, spawnToolCallID, map[string]any{
		"agent_type":       "worker",
		"task_name":        "Identity Check",
		"task_description": "Check child approval identity.",
		"message":          "check child approval identity",
	})
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	if got := strings.TrimSpace(anyToString(spawnResult["task_name"])); got != "Identity Check" {
		t.Fatalf("spawn result task_name=%q, want canonical human-facing name", got)
	}
	spawnItems := subagentItemsFromAny(spawnResult["items"])
	if len(spawnItems) != 1 || strings.TrimSpace(anyToString(spawnItems[0]["task_name"])) != "Identity Check" {
		t.Fatalf("spawn result items=%#v, want canonical task_name", spawnItems)
	}

	host.mu.Lock()
	if len(host.spawnRequests) != 1 {
		t.Fatalf("spawn request count=%d, want 1", len(host.spawnRequests))
	}
	spawnReq := host.spawnRequests[0]
	host.mu.Unlock()
	if got := strings.TrimSpace(spawnReq.TaskName); got != "Identity Check" {
		t.Fatalf("spawn TaskName=%q, want canonical human-facing name", got)
	}
	if got := strings.TrimSpace(spawnReq.Labels.Host["subagent_parent_permission"]); got != "" {
		t.Fatalf("spawn labels retained deprecated parent permission copy %q", got)
	}

	childThreadID := strings.TrimSpace(anyToString(spawnResult["thread_id"]))
	finalized, ok, err := store.GetChildPermissionSnapshotBySpawnToolCall(context.Background(), parent.endpointID, spawnToolCallID)
	if err != nil {
		t.Fatalf("GetChildPermissionSnapshotBySpawnToolCall: %v", err)
	}
	if !ok {
		t.Fatalf("missing finalized child permission snapshot for %s", spawnToolCallID)
	}
	childRunID := strings.TrimSpace(finalized.ChildRunID)
	if childThreadID == "" || childRunID == "" {
		t.Fatalf("spawn labels missing child identity: thread=%q labels=%#v", childThreadID, spawnReq.Labels)
	}
	if childRunID == childThreadID || childRunID == parent.id {
		t.Fatalf("spawn child_run_id=%q must be distinct from child thread %q and parent run %q", childRunID, childThreadID, parent.id)
	}
	if spawnReq.Labels.Host[subagentToolHostContextChildThreadIDKey] != "" || spawnReq.Labels.Host[subagentToolHostContextChildRunIDKey] != "" {
		t.Fatalf("spawn request preallocated canonical child identity: %#v", spawnReq.Labels.Host)
	}

	rec, ok, err := store.GetFinalizedChildPermissionSnapshot(context.Background(), parent.endpointID, childThreadID, childRunID)
	if err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshot: %v", err)
	}
	if !ok || rec.ChildRunID != childRunID {
		t.Fatalf("child snapshot record=%#v ok=%v, want child_run_id %q", rec, ok, childRunID)
	}
	if rec.SpawnToolCallID != spawnToolCallID {
		t.Fatalf("spawn_tool_call_id=%q, want real tool call id %q", rec.SpawnToolCallID, spawnToolCallID)
	}
	if rec.ParentSnapshotID != authorizationSnapshot.SnapshotID {
		t.Fatalf("parent_snapshot_id=%q, want dispatch snapshot %q", rec.ParentSnapshotID, authorizationSnapshot.SnapshotID)
	}

	if _, err := runtime.sendInput(context.Background(), "call_test_send_input", map[string]any{
		"target":  childThreadID,
		"message": "continue with the same approval identity",
	}); err != nil {
		t.Fatalf("sendInput: %v", err)
	}
	host.mu.Lock()
	if len(host.sendInputRequests) != 1 {
		t.Fatalf("send input request count=%d, want 1", len(host.sendInputRequests))
	}
	sendReq := host.sendInputRequests[0]
	host.mu.Unlock()
	if got := strings.TrimSpace(sendReq.Labels.Host[subagentToolHostContextChildRunIDKey]); got != childRunID {
		t.Fatalf("send_input child_run_id=%q, want persisted %q", got, childRunID)
	}
	host.mu.Lock()
	host.sendInputResult = &flruntime.SubAgentSnapshot{ThreadID: identity.ThreadID(childThreadID), ParentThreadID: "other_parent"}
	host.mu.Unlock()
	if _, err := runtime.sendInput(context.Background(), "call_test_send_input_mismatch", map[string]any{
		"target": childThreadID, "message": "reject mismatched authority",
	}); err == nil || !strings.Contains(err.Error(), "result identity mismatch") {
		t.Fatalf("sendInput identity error=%v, want strict mismatch", err)
	}
	host.mu.Lock()
	host.sendInputResult = nil
	host.closeResult = &flruntime.SubAgentSnapshot{ThreadID: "other_child", ParentThreadID: identity.ThreadID(parent.threadID)}
	host.mu.Unlock()
	if _, err := runtime.close(context.Background(), "call_test_close_mismatch", map[string]any{"target": childThreadID}); err == nil || !strings.Contains(err.Error(), "result identity mismatch") {
		t.Fatalf("close identity error=%v, want strict mismatch", err)
	}
}

func TestSubagentSpawnFailurePreservesUnboundRecoveryIntent(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(t.TempDir() + "/threads.sqlite")
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{
		threadsDB:          store,
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		persistOpTO:        time.Second,
	}
	parent := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "subagent_spawn_failure")
	bindPermissionPolicyRunsToService(t, svc, parent)
	parent.cfg = &config.AIConfig{
		CurrentModelID: "compat/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "compat",
			Type:    "openai_compatible",
			BaseURL: "https://example.invalid/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	parent.currentModelID = "compat/gpt-5-mini"
	parent.resolveProviderKey = func(providerID string) (string, bool, error) {
		return "provider-key", strings.TrimSpace(providerID) == "compat", nil
	}
	freezePermissionPolicyTestSnapshot(t, parent)

	host := &recordingFloretHost{spawnErr: errors.New("host spawn failed")}
	runtime := &floretSubagentRuntime{parent: parent, host: host}
	spawnToolCallID := "tool_subagents_spawn_failure"
	spawnCtx := contextWithToolAuthorizationSnapshot(context.Background(), parent.currentPermissionSnapshot())
	if _, err := runtime.spawn(spawnCtx, spawnToolCallID, map[string]any{
		"agent_type":       "worker",
		"task_name":        "failure check",
		"task_description": "Fail before child starts.",
		"message":          "fail before child starts",
	}); err == nil {
		t.Fatalf("spawn succeeded, want host error")
	}

	host.mu.Lock()
	if len(host.spawnRequests) != 1 {
		t.Fatalf("spawn request count=%d, want 1", len(host.spawnRequests))
	}
	request := host.spawnRequests[0]
	host.mu.Unlock()
	if request.Labels.Host[subagentToolHostContextChildThreadIDKey] != "" || request.Labels.Host[subagentToolHostContextChildRunIDKey] != "" {
		t.Fatalf("failed spawn request preallocated canonical child identity: %#v", request.Labels.Host)
	}
	_, ok, err := store.GetChildPermissionSnapshotBySpawnToolCall(context.Background(), parent.endpointID, spawnToolCallID)
	if err != nil {
		t.Fatalf("GetChildPermissionSnapshotBySpawnToolCall: %v", err)
	}
	if ok {
		t.Fatalf("failed spawn preallocated child permission identity for %s", spawnToolCallID)
	}
	publication, ok, err := store.GetSubAgentPublication(context.Background(), strings.TrimSpace(string(request.LogicalRequestID)))
	if err != nil {
		t.Fatalf("GetSubAgentPublication: %v", err)
	}
	if !ok || publication.State != threadstore.SubAgentPublicationPending || publication.ChildThreadID != "" || publication.ChildRunID != "" || publication.ChildSnapshotID != "" ||
		publication.RequestJSON == "" || publication.SessionMetaJSON == "" || publication.ModelID == "" {
		t.Fatalf("recoverable publication=%#v ok=%v", publication, ok)
	}
	pending, err := store.ListPendingSubAgentPublications(context.Background(), 10)
	if err != nil || len(pending) != 1 || pending[0].PublicationID != publication.PublicationID {
		t.Fatalf("pending publications=%#v err=%v", pending, err)
	}
}

func TestReleasedSubagentRuntimeCannotRecreateHost(t *testing.T) {
	t.Parallel()

	host := &recordingFloretHost{}
	runtime := &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:        slog.Default(),
			ThreadID:   "parent",
			EndpointID: "env",
		}),
		host:    host,
		hostKey: "test-generation",
	}

	runtime.release()
	if runtime.currentHost() != nil {
		t.Fatalf("released runtime still exposes a host")
	}
	if _, err := runtime.ensureHost(context.Background()); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("ensureHost after release err=%v, want closed runtime error", err)
	}
	runtime.attachParentRun(newRun(runOptions{Log: slog.Default(), ThreadID: "parent-2", EndpointID: "env"}))
	if _, err := runtime.ensureHost(context.Background()); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("ensureHost after attachParentRun err=%v, want closed runtime error", err)
	}
}

func TestReleasedSubagentRuntimeDropsQueuedTimelineRefresh(t *testing.T) {
	t.Parallel()

	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:       identity.ThreadID("child"),
			TaskName:       "child",
			ParentThreadID: identity.ThreadID("parent"),
			Status:         flruntime.SubAgentStatusCompleted,
			UpdatedAt:      time.Now(),
			CreatedAt:      time.Now().Add(-time.Second),
		}},
	}
	parent := newRun(runOptions{
		Log:        slog.Default(),
		ThreadID:   "parent",
		EndpointID: "env",
		StateDir:   t.TempDir(),
	})
	runtime := &floretSubagentRuntime{
		parent:  parent,
		host:    host,
		hostKey: "test-generation",
	}

	runtime.scheduleParentSubagentsPatch("child")
	runtime.release()
	time.Sleep(250 * time.Millisecond)

	if got := host.listSubagentCount.Load(); got != 0 {
		t.Fatalf("released runtime delayed refresh listed subagents %d times; want 0", got)
	}
	runtime.mu.Lock()
	queued := len(runtime.subagentsPatchQueued)
	runtime.mu.Unlock()
	if queued != 0 {
		t.Fatalf("timeline queue length=%d, want 0", queued)
	}
}

func TestDeleteThreadClosesRuntimeWithoutChildThreadstoreProjection(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	stopTestServiceMaintenance(t, svc)
	meta := testSendTurnMeta()
	ctx := context.Background()

	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	childID := "child"
	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:       identity.ThreadID(childID),
			TaskName:       "child",
			ParentThreadID: identity.ThreadID(parent.ThreadID),
			HostProfileRef: subagentAgentTypeWorker,
			Status:         flruntime.SubAgentStatusRunning,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
			CanClose:       true,
		}},
	}
	maintenanceHost := &recordingFloretHost{}
	key := runThreadKey(meta.EndpointID, parent.ThreadID)
	svc.mu.Lock()
	bindRecordingThreadDelete(svc, parent.ThreadID, maintenanceHost)
	svc.subagentRuntimes[key] = &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:        slog.Default(),
			ThreadID:   parent.ThreadID,
			EndpointID: meta.EndpointID,
		}),
		host:    host,
		hostKey: "test-generation",
	}
	svc.mu.Unlock()

	if _, err := svc.DeleteThread(ctx, meta, parent.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread(parent): %v", err)
	}
	if got := host.closeSubagentCount.Load(); got != 0 {
		t.Fatalf("cached runtime CloseSubAgent count=%d, want 0", got)
	}
	if got := host.deleteThreadCount.Load(); got != 0 {
		t.Fatalf("cached runtime DeleteThread count=%d, want 0", got)
	}
	if got := maintenanceHost.closeSubagentCount.Load(); got != 0 {
		t.Fatalf("maintenance CloseSubAgent count=%d, want 0", got)
	}
	if got := maintenanceHost.deleteThreadCount.Load(); got != 1 {
		t.Fatalf("maintenance DeleteThread count=%d, want 1", got)
	}
	maintenanceHost.mu.Lock()
	deleteThreadIDs := append([]identity.ThreadID(nil), maintenanceHost.deleteThreadIDs...)
	maintenanceHost.mu.Unlock()
	if len(deleteThreadIDs) != 1 || deleteThreadIDs[0] != identity.ThreadID(parent.ThreadID) {
		t.Fatalf("DeleteThread ids=%v, want [%s]", deleteThreadIDs, parent.ThreadID)
	}
	childAfterDelete, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetThread child after delete: %v", err)
	}
	if childAfterDelete != nil {
		t.Fatalf("child threadstore row exists: %#v", childAfterDelete)
	}
	childMetaAfterDelete, err := svc.threadsDB.GetFlowerThreadRouting(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetFlowerThreadRouting child after delete: %v", err)
	}
	if childMetaAfterDelete != nil {
		t.Fatalf("child thread metadata exists: %#v", childMetaAfterDelete)
	}
	svc.mu.Lock()
	_, exists := svc.subagentRuntimes[key]
	svc.mu.Unlock()
	if exists {
		t.Fatalf("parent runtime cache entry still exists")
	}
}

func TestCloseThreadSubagentsUsesActiveFloretOwner(t *testing.T) {
	t.Parallel()

	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:       "child",
			ParentThreadID: "parent",
			TaskName:       "child",
			Status:         flruntime.SubAgentStatusRunning,
			CanClose:       true,
			CanSendInput:   true,
			CanInterrupt:   true,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		}},
	}
	svc := &Service{
		subagentRuntimes: map[string]*floretSubagentRuntime{
			runThreadKey("env", "parent"): {
				parent: newRun(runOptions{
					Log:        slog.Default(),
					ThreadID:   "parent",
					EndpointID: "env",
				}),
				host:    host,
				hostKey: "test-generation",
			},
		},
	}

	if err := svc.closeThreadSubagents(context.Background(), "env", "parent", time.Second); err != nil {
		t.Fatalf("closeThreadSubagents: %v", err)
	}

	if got := host.closeSubagentCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgent count=%d, want 1", got)
	}
}

func TestRunTerminalFailureClosesSubagentsThroughFloretRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parentView, err := svc.CreateThread(ctx, meta, "parent failure", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:        "child_running",
			ParentThreadID:  identity.ThreadID(parentView.ThreadID),
			ParentTurnID:    "msg_parent_failed",
			TaskName:        "running child",
			TaskDescription: "finish delegated work",
			HostProfileRef:  subagentAgentTypeWorker,
			Status:          flruntime.SubAgentStatusRunning,
			CanClose:        true,
			CanSendInput:    true,
			CanInterrupt:    true,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}},
	}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parentView.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parentView.ThreadID, host)
	svc.mu.Unlock()
	parent := newRunWithProductStoreForTest(t, runOptions{
		Log:              slog.Default(),
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, parentView.ThreadID),
		ThreadID:         parentView.ThreadID,
		EndpointID:       meta.EndpointID,
		MessageID:        "msg_parent_failed",
	}, svc.threadsDB)
	runtime := &floretSubagentRuntime{
		parent:  parent,
		host:    host,
		hostKey: "test-generation",
	}
	parent.subagentRuntime = runtime
	svc.mu.Lock()
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parentView.ThreadID)] = runtime
	svc.mu.Unlock()

	if reason := parent.floretParentTerminalSubagentCloseReason(context.Background(), flruntime.TurnResult{Status: flruntime.TurnStatusFailed}, errors.New("provider failed")); reason != "parent_failed" {
		t.Fatalf("close reason=%q, want parent_failed", reason)
	}
	if err := parent.closeParentTerminalSubagents(context.Background(), "parent_failed"); err != nil {
		t.Fatalf("closeParentTerminalSubagents: %v", err)
	}
	if got := host.closeSubagentCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgent count=%d, want 1", got)
	}
	host.mu.Lock()
	requests := append([]flruntime.CloseSubAgentCommand(nil), host.closeSubagentReqs...)
	snapshots := append([]flruntime.SubAgentSnapshot(nil), host.snapshots...)
	host.mu.Unlock()
	if len(requests) != 1 || host.parentThreadID != identity.ThreadID(parentView.ThreadID) || requests[0].Reason != "parent_failed" {
		t.Fatalf("CloseSubAgent requests=%#v, want parent_failed for parent thread", requests)
	}
	if len(snapshots) != 1 || snapshots[0].Status != flruntime.SubAgentStatusClosed || !snapshots[0].Closed || snapshots[0].CanClose {
		t.Fatalf("subagent snapshots after close=%#v", snapshots)
	}
	resp, err := svc.ListFlowerThreadLiveEvents(context.Background(), meta, parentView.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var payload FlowerLiveThreadPatchedPayload
	for _, event := range resp.Events {
		if event.Kind != FlowerLiveThreadPatched {
			continue
		}
		if decodeFlowerPayload(event.Payload, &payload) && len(payload.Patch.Subagents) > 0 {
			break
		}
	}
	if len(payload.Patch.Subagents) != 1 || payload.Patch.Subagents[0].Status != subagentStatusCanceled || payload.Patch.Subagents[0].CanClose {
		t.Fatalf("live subagents=%#v, want terminal canceled patch", payload.Patch.Subagents)
	}
}

func TestDeleteThreadDeletesFloretTreeWithoutCachedRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	storePath, childID := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, "without_cached_runtime")

	if _, err := svc.DeleteThread(ctx, meta, parent.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread(parent): %v", err)
	}
	assertLegacyFloretSubagentStoreNotCreated(t, svc)

	source, err := prepareFloretStorage(ctx, storePath, nil)
	if err != nil {
		t.Fatal(err)
	}
	reopenedStore, err := flruntime.Open(ctx, flruntime.Options{Storage: source})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopenedStore.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown reopened store: %v", err)
		}
	})
	bootstrap := testFloretBootstrap(t, reopenedStore)
	parentRead, err := bootstrap.newThreadRead(ctx, identity.ThreadID(parent.ThreadID))
	if err == nil {
		_, err = parentRead.ReadThread(ctx)
	}
	if !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("read deleted parent err=%v, want %v", err, flruntime.ErrThreadDeleted)
	}
	childRead, err := bootstrap.newThreadRead(ctx, identity.ThreadID(childID))
	if err == nil {
		_, err = childRead.ReadThread(ctx)
	}
	if !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("read deleted child err=%v, want %v", err, flruntime.ErrThreadDeleted)
	}
}

func TestCancelThreadRejectsUnownedSubagentLifecycleWithoutCachedRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	storePath, childID := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, "cancel_without_cached_runtime")

	if err := svc.CancelThread(meta, parent.ThreadID); err == nil || !strings.Contains(err.Error(), "active SubAgent lifecycle owner is unavailable") {
		t.Fatalf("CancelThread(parent) error=%v, want explicit missing lifecycle owner", err)
	}
	assertLegacyFloretSubagentStoreNotCreated(t, svc)

	reopenedHost, reopenedStore := openTestFloretHost(t, storePath, parent.ThreadID, "unused")
	t.Cleanup(func() {
		if err := reopenedStore.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown reopened store: %v", err)
		}
	})
	snapshot, err := reopenedHost.ReadSubAgentDetail(ctx, identity.ThreadID(childID), flruntime.ThreadDetailRequest{})
	if err != nil {
		t.Fatalf("ReadSubAgentDetail child: %v", err)
	}
	if snapshot.Snapshot.Status != flruntime.SubAgentStatusCompleted || snapshot.Snapshot.Closed {
		t.Fatalf("child snapshot after cancel=%#v, want completed history retained", snapshot.Snapshot)
	}
	if _, err := reopenedHost.ReadThread(ctx); err != nil {
		t.Fatalf("ReadThread parent after cancel: %v", err)
	}
	if _, err := reopenedStore.Thread(ctx, identity.ThreadID(childID)); err == nil || !errors.Is(err, flruntime.ErrSubAgentParentRequired) {
		t.Fatalf("root ReadThread child error=%v, want exact root authority rejection", err)
	}
}

func TestServiceGetFlowerSubagentDetailUsesCanonicalMessagesAndSanitizedDiagnostics(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	now := time.Now()
	finalPreview := "complete report http://arxiv.org/abs/2607.02..."
	finalContent := "complete report " + strings.Repeat("evidence section ", 80) + "http://arxiv.org/abs/2607.02514v1"
	host := &recordingFloretHost{
		turnPage: flruntime.ThreadTurnsPage{
			ThreadID:       identity.ThreadID("child-detail"),
			ThroughOrdinal: 7,
			Turns: []flruntime.ThreadTurnSnapshot{{
				TurnID:            identity.TurnID("child-turn"),
				RunID:             identity.RunID("child-run"),
				Ordinal:           1,
				StartedAt:         now.Add(-50 * time.Second),
				UpdatedAt:         now.Add(-5 * time.Second),
				UserEntryID:       "child-user-entry",
				UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission,
				UserInput:         "delegate mission",
				Status:            flruntime.TurnStatusCompleted,
				ThroughOrdinal:    7,
				Projection: flruntime.ThreadTurnProjection{
					ThreadID:       identity.ThreadID("child-detail"),
					TurnID:         identity.TurnID("child-turn"),
					RunID:          identity.RunID("child-run"),
					Status:         flruntime.TurnStatusCompleted,
					ThroughOrdinal: 7,
					Segments: []flruntime.ThreadTurnProjectionSegment{{
						Kind: flruntime.ThreadTurnProjectionSegmentAssistantText,
						Text: finalContent,
					}},
				},
			}},
		},
		detail: flruntime.SubAgentDetail{
			Snapshot: flruntime.SubAgentSnapshot{
				ThreadID:       identity.ThreadID("child-detail"),
				TaskName:       "Inspect tool flow",
				ParentThreadID: identity.ThreadID(parent.ThreadID),
				ParentTurnID:   identity.TurnID("parent-turn"),
				HostProfileRef: subagentAgentTypeReviewer,
				Status:         flruntime.SubAgentStatusRunning,
				LastMessage:    "Reading tool evidence",
				CreatedAt:      now.Add(-time.Minute),
				UpdatedAt:      now,
				CanSendInput:   true,
				CanInterrupt:   true,
				CanClose:       true,
			},
			Events: []flruntime.ThreadDetailEvent{
				{
					ID:        "child-user-entry",
					Ordinal:   1,
					ThreadID:  identity.ThreadID("child-detail"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventUserMessage,
					CreatedAt: now.Add(-50 * time.Second),
					Message:   &flruntime.ThreadDetailMessage{Role: "user", Preview: "delegate mission"},
					Metadata:  map[string]string{"raw_omitted": "true"},
				},
				{
					ID:        "event-tool-call",
					Ordinal:   2,
					ThreadID:  identity.ThreadID("child-detail"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventToolCall,
					CreatedAt: now.Add(-40 * time.Second),
					ToolCall:  &flruntime.ThreadDetailToolCall{ID: "call-1", Name: "terminal.exec", ArgsPreview: "ls", ArgsHash: "hash-args"},
				},
				{
					ID:        "event-tool-result",
					Ordinal:   3,
					ThreadID:  identity.ThreadID("child-detail"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventToolResult,
					CreatedAt: now.Add(-30 * time.Second),
					ToolResult: &flruntime.ThreadDetailToolResult{
						CallID:        "call-1",
						ToolName:      "terminal.exec",
						Status:        string(observation.ActivityStatusSuccess),
						Preview:       "total 4",
						Truncated:     true,
						OriginalBytes: 2000,
						VisibleBytes:  80,
						ContentSHA256: "hash-content",
						FullOutput: &flruntime.ArtifactRef{
							ID:        "raw-full-output",
							SafeLabel: "full-output.txt",
							Kind:      "tool_output",
							MIME:      "text/plain",
							SizeBytes: 2000,
							SHA256:    "raw-full-output-sha",
						},
					},
					ActivityTimeline: &observation.ActivityTimeline{
						SchemaVersion: 1,
						RunID:         "child-run",
						ThreadID:      "child-detail",
						TurnID:        "child-turn",
						TraceID:       "child-run",
						Summary: observation.ActivitySummary{
							Status:         observation.ActivityStatusSuccess,
							Severity:       observation.ActivitySeverityNormal,
							TotalItems:     1,
							Counts:         observation.ActivityCounts{Success: 1},
							DurationMS:     10,
							NeedsAttention: false,
						},
						Items: []observation.ActivityItem{{
							ItemID:           "call-1",
							ToolID:           "call-1",
							ToolName:         "terminal.exec",
							Kind:             observation.ActivityKindTool,
							Status:           observation.ActivityStatusSuccess,
							Severity:         observation.ActivitySeverityNormal,
							RequiresApproval: false,
							Presentation: &fltools.ActivityPresentation{
								Label:       "Run command",
								Description: "Command completed",
								Renderer:    fltools.ActivityRendererTerminal,
								Payload:     fltools.TerminalActivityPayload{Output: "total 4"},
							},
						}},
					},
				},
				{
					ID:        "event-tool-activity",
					Ordinal:   4,
					ThreadID:  identity.ThreadID("child-detail"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventToolActivity,
					Type:      string(observation.EventTypeToolActivityUpdated),
					CreatedAt: now.Add(-35 * time.Second),
					ToolCall:  &flruntime.ThreadDetailToolCall{ID: "call-1", Name: "terminal.exec", ArgsHash: "hash-args"},
					ActivityTimeline: &observation.ActivityTimeline{
						SchemaVersion: 1,
						RunID:         "child-run",
						ThreadID:      "child-detail",
						TurnID:        "child-turn",
						TraceID:       "child-run",
						Summary: observation.ActivitySummary{
							Status:     observation.ActivityStatusRunning,
							Severity:   observation.ActivitySeverityNormal,
							TotalItems: 1,
							Counts:     observation.ActivityCounts{Running: 1},
						},
						Items: []observation.ActivityItem{{
							ItemID:       "tool:call-1",
							ToolID:       "call-1",
							ToolName:     "terminal.exec",
							Kind:         observation.ActivityKindTool,
							Status:       observation.ActivityStatusRunning,
							Severity:     observation.ActivitySeverityNormal,
							Presentation: &fltools.ActivityPresentation{Label: "Run command", Renderer: fltools.ActivityRendererTerminal},
						}},
					},
				},
				{
					ID:        "event-approval",
					Ordinal:   5,
					ThreadID:  identity.ThreadID("child-detail"),
					Kind:      flruntime.ThreadDetailEventApproval,
					CreatedAt: now.Add(-20 * time.Second),
					Approval:  &flruntime.ThreadDetailApproval{State: "denied", ToolName: "terminal.exec", ArgsHash: "hash-args", Reason: "readonly policy"},
					ActivityTimeline: &observation.ActivityTimeline{
						SchemaVersion: 1,
						RunID:         "child-run",
						ThreadID:      "child-detail",
						TurnID:        "child-turn",
						TraceID:       "child-run",
						Summary: observation.ActivitySummary{
							Status:         observation.ActivityStatusError,
							Severity:       observation.ActivitySeverityError,
							TotalItems:     1,
							Counts:         observation.ActivityCounts{Approval: 1},
							NeedsAttention: true,
						},
						Items: []observation.ActivityItem{{
							ItemID:           "tool:call-1",
							ToolID:           "call-1",
							ToolName:         "terminal.exec",
							Kind:             observation.ActivityKindTool,
							Status:           observation.ActivityStatusError,
							Severity:         observation.ActivitySeverityError,
							NeedsAttention:   true,
							RequiresApproval: true,
							ApprovalState:    "rejected",
							Presentation:     &fltools.ActivityPresentation{Label: "terminal.exec", Description: "readonly policy", Renderer: fltools.ActivityRendererTerminal},
						}},
					},
				},
				{
					ID:        "event-error",
					Ordinal:   6,
					ThreadID:  identity.ThreadID("child-detail"),
					Kind:      flruntime.ThreadDetailEventError,
					CreatedAt: now.Add(-10 * time.Second),
					Error:     "tool blocked",
				},
				{
					ID:        "event-final-assistant",
					Ordinal:   7,
					ThreadID:  identity.ThreadID("child-detail"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventAssistantMessage,
					CreatedAt: now.Add(-5 * time.Second),
					Message: &flruntime.ThreadDetailMessage{
						Role:    "assistant",
						Preview: finalPreview,
					},
				},
			},
			ActivityTimeline: observation.ActivityTimeline{
				SchemaVersion: 1,
				RunID:         "child-run",
				ThreadID:      "child-detail",
				TurnID:        "child-turn",
				TraceID:       "child-run",
				Summary: observation.ActivitySummary{
					Status:         observation.ActivityStatusSuccess,
					Severity:       observation.ActivitySeverityNormal,
					TotalItems:     1,
					Counts:         observation.ActivityCounts{Success: 1},
					DurationMS:     10,
					NeedsAttention: false,
				},
				Items: []observation.ActivityItem{{
					ItemID:           "tool:call-1",
					ToolID:           "call-1",
					ToolName:         "terminal.exec",
					Kind:             observation.ActivityKindTool,
					Status:           observation.ActivityStatusSuccess,
					Severity:         observation.ActivitySeverityNormal,
					RequiresApproval: false,
					Presentation: &fltools.ActivityPresentation{
						Label:       "Run command",
						Description: "Command completed",
						Renderer:    fltools.ActivityRendererTerminal,
						Payload:     fltools.TerminalActivityPayload{Output: "total 4"},
					},
				}},
			},
			Context:      flruntime.ThreadContextSnapshot{ThreadID: identity.ThreadID("child-detail")},
			NextOrdinal:  7,
			HasMore:      true,
			RetainedFrom: 1,
			GeneratedAt:  now,
		},
	}
	key := runThreadKey(meta.EndpointID, parent.ThreadID)
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.subagentRuntimes[key] = &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:        slog.Default(),
			ThreadID:   parent.ThreadID,
			EndpointID: meta.EndpointID,
		}),
		host: host,
	}
	svc.mu.Unlock()

	detail, err := svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, "child-detail", 7, 333)
	if err != nil {
		t.Fatalf("GetFlowerSubagentDetail: %v", err)
	}
	childRecord, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, "child-detail")
	if err != nil {
		t.Fatalf("GetThread child detail: %v", err)
	}
	if childRecord != nil {
		t.Fatalf("detail lookup created child threadstore row: %#v", childRecord)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadRouting(ctx, meta.EndpointID, "child-detail")
	if err != nil {
		t.Fatalf("GetFlowerThreadRouting child detail: %v", err)
	}
	if childMeta != nil {
		t.Fatalf("detail lookup created child thread metadata: %#v", childMeta)
	}
	host.mu.Lock()
	threadIDs := append([]identity.ThreadID(nil), host.detailThreadIDs...)
	requests := append([]flruntime.ThreadDetailRequest(nil), host.detailRequests...)
	host.mu.Unlock()
	if len(requests) != 1 {
		t.Fatalf("detail request count=%d, want 1", len(requests))
	}
	req := requests[0]
	if host.parentThreadID != identity.ThreadID(parent.ThreadID) || len(threadIDs) != 1 || threadIDs[0] != identity.ThreadID("child-detail") {
		t.Fatalf("unexpected detail request identity: %#v", req)
	}
	if req.AfterOrdinal != 7 || req.Limit != 333 {
		t.Fatalf("unexpected detail pagination: %#v", req)
	}
	if req.IncludeRaw {
		t.Fatalf("Flower UI detail must not request raw child transcript messages")
	}
	if detail == nil || detail.Summary.ThreadID != "child-detail" || detail.Summary.ParentThreadID != parent.ThreadID {
		t.Fatalf("unexpected detail summary: %#v", detail)
	}
	if len(detail.Timeline) != 6 {
		t.Fatalf("timeline rows=%d, want 6 after hiding the delegated mission event: %#v", len(detail.Timeline), detail.Timeline)
	}
	for _, index := range []int{0, 1, 2, 3} {
		rowJSON, err := json.Marshal(detail.Timeline[index])
		if err != nil {
			t.Fatalf("marshal row %d: %v", index, err)
		}
		if strings.Contains(string(rowJSON), `"activity"`) {
			t.Fatalf("timeline row %d should not expose per-event activity: %s", index, string(rowJSON))
		}
	}
	if detail.Timeline[0].ToolCall == nil || detail.Timeline[0].ToolCall.Name != "terminal.exec" || detail.Timeline[0].ToolCall.ArgsHash == "" {
		t.Fatalf("tool call row not projected: %#v", detail.Timeline[0])
	}
	if detail.Timeline[1].ToolResult == nil || detail.Timeline[1].ToolResult.Preview != "total 4" || !detail.Timeline[1].ToolResult.Truncated {
		t.Fatalf("tool result row not projected: %#v", detail.Timeline[1])
	}
	if detail.Timeline[2].ToolCall == nil || detail.Timeline[2].Kind != "tool_activity" {
		t.Fatalf("tool activity row not projected as journal fact: %#v", detail.Timeline[2])
	}
	if detail.Activity == nil || len(detail.Activity.Items) != 1 {
		t.Fatalf("canonical subagent activity not projected: %#v", detail)
	}
	resultActivity := detail.Activity.Items[0]
	resultPayload := activityPayloadMap(resultActivity.Presentation.Payload)
	if resultActivity.Presentation == nil || resultActivity.Presentation.Renderer != fltools.ActivityRendererTerminal || resultPayload["output"] != "total 4" {
		t.Fatalf("tool result activity does not use canonical terminal presentation: %#v", resultActivity)
	}
	if resultActivity.Status != observation.ActivityStatusSuccess {
		t.Fatalf("canonical activity did not settle stale running row: %#v", resultActivity)
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal detail: %v", err)
	}
	if strings.Contains(string(encoded), "raw-full-output") || strings.Contains(string(encoded), "full_output") {
		t.Fatalf("detail leaked full output artifact reference: %s", string(encoded))
	}
	if detail.Timeline[3].Approval == nil || detail.Timeline[3].Approval.State != "denied" {
		t.Fatalf("approval row not projected: %#v", detail.Timeline[3])
	}
	if detail.Timeline[4].Error != "tool blocked" {
		t.Fatalf("error row not projected: %#v", detail.Timeline[4])
	}
	if detail.Timeline[5].Message == nil || detail.Timeline[5].Message.Text != finalPreview || detail.Timeline[5].Message.Preview != finalPreview {
		t.Fatalf("assistant diagnostic should expose only the bounded preview: %#v", detail.Timeline[5])
	}
	if len(detail.Messages) != 1 || detail.Messages[0].Role != "assistant" || detail.Messages[0].Content != finalContent {
		t.Fatalf("canonical assistant message missing full content: %#v", detail.Messages)
	}
	if strings.Contains(detail.Timeline[5].Message.Preview, "2607.02514v1") {
		t.Fatalf("assistant preview should remain bounded: %#v", detail.Timeline[5].Message)
	}
	if !detail.HasMore || detail.NextOrdinal != 7 || detail.RetainedFrom != 1 {
		t.Fatalf("pagination metadata not projected: %#v", detail)
	}
}

func TestVisibleSubagentDetailEventsFailsClosedForUnknownUserEntry(t *testing.T) {
	events := []flruntime.ThreadDetailEvent{{
		ID:   "unknown-entry",
		Kind: flruntime.ThreadDetailEventUserMessage,
	}}
	turns := []flruntime.ThreadTurnSnapshot{{
		TurnID:            "turn-known",
		UserEntryID:       "known-entry",
		UserMessageOrigin: flruntime.ThreadUserMessageOriginUser,
	}}
	events[0].ThreadID = "child"
	events[0].TurnID = "turn-known"
	_, err := visibleSubagentDetailEvents(events, turns, "child")
	if err == nil || !strings.Contains(err.Error(), "unknown canonical user entry") {
		t.Fatalf("visibleSubagentDetailEvents error=%v, want unknown canonical user entry", err)
	}
}

func TestVisibleSubagentDetailEventsUsesTypedOriginsForExactVisibility(t *testing.T) {
	turns := []flruntime.ThreadTurnSnapshot{
		{TurnID: "turn-mission", UserEntryID: "entry-mission", UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission},
		{TurnID: "turn-user", UserEntryID: "entry-user", UserMessageOrigin: flruntime.ThreadUserMessageOriginUser},
		{TurnID: "turn-input", UserEntryID: "entry-input", UserMessageOrigin: flruntime.ThreadUserMessageOriginSubAgentInput},
		{TurnID: "turn-pending", UserEntryID: "entry-pending", UserMessageOrigin: flruntime.ThreadUserMessageOriginPendingToolCompletion},
		{TurnID: "turn-retry", RetrySource: &flruntime.ThreadTurnRetrySource{TurnID: "turn-user"}},
	}
	events := []flruntime.ThreadDetailEvent{
		{ID: "entry-mission", Kind: flruntime.ThreadDetailEventUserMessage},
		{ID: "entry-user", Kind: flruntime.ThreadDetailEventUserMessage},
		{ID: "entry-input", Kind: flruntime.ThreadDetailEventUserMessage},
		{ID: "entry-pending", Kind: flruntime.ThreadDetailEventUserMessage},
		{ID: "assistant-event", Kind: flruntime.ThreadDetailEventAssistantMessage},
	}
	for index := range events {
		events[index].ThreadID = "child"
	}
	events[0].TurnID = "turn-mission"
	events[1].TurnID = "turn-user"
	events[2].TurnID = "turn-input"
	events[3].TurnID = "turn-pending"
	visible, err := visibleSubagentDetailEvents(events, turns, "child")
	if err != nil {
		t.Fatalf("visibleSubagentDetailEvents: %v", err)
	}
	if len(visible) != 4 {
		t.Fatalf("visible events=%#v, want ordinary user, subagent input, pending completion, and assistant", visible)
	}
	for index, wantID := range []string{"entry-user", "entry-input", "entry-pending", "assistant-event"} {
		if visible[index].ID != wantID {
			t.Fatalf("visible event %d id=%q, want %q", index, visible[index].ID, wantID)
		}
	}
}

func TestVisibleSubagentDetailEventsRejectsKnownEntryWithWrongTurnOrThread(t *testing.T) {
	turns := []flruntime.ThreadTurnSnapshot{{TurnID: "turn-known", UserEntryID: "entry-known", UserMessageOrigin: flruntime.ThreadUserMessageOriginUser}}
	for name, event := range map[string]flruntime.ThreadDetailEvent{
		"wrong thread": {ID: "entry-known", ThreadID: "other", TurnID: "turn-known", Kind: flruntime.ThreadDetailEventUserMessage},
		"wrong turn":   {ID: "entry-known", ThreadID: "child", TurnID: "other", Kind: flruntime.ThreadDetailEventUserMessage},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := visibleSubagentDetailEvents([]flruntime.ThreadDetailEvent{event}, turns, "child")
			if err == nil || !strings.Contains(err.Error(), "canonical user entry identity") {
				t.Fatalf("error=%v, want canonical user entry identity rejection", err)
			}
		})
	}
}

func TestSubagentDetailRetryDecorationUsesVisibleSourceAnchor(t *testing.T) {
	turns := []flruntime.ThreadTurnSnapshot{
		{TurnID: "turn-source", Ordinal: 1, UserEntryID: "entry-mission", UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission},
		{TurnID: "turn-retry", Ordinal: 2, RetrySource: &flruntime.ThreadTurnRetrySource{TurnID: "turn-source"}},
	}
	decorations := []FlowerTimelineDecoration{{
		DecorationID:          "turn-projection-unavailable:turn-retry",
		Kind:                  FlowerTimelineDecorationTurnProjectionUnavailable,
		Anchor:                FlowerTimelineAnchor{TargetKind: "message", MessageID: "entry-mission", Edge: "after"},
		ProjectionUnavailable: &FlowerTurnProjectionUnavailable{TurnID: "turn-retry", RunID: "run-retry", ExpectedMessageID: "turn-retry", Reason: FlowerTurnProjectionUnavailableNotRenderable},
	}}
	messages := []FlowerTimelineMessage{{MessageID: "turn-source", TurnID: "turn-source", Role: "assistant", TurnOrdinal: 1}}
	remapped, err := remapSubagentDetailProjectionDecorationAnchors(decorations, turns, messages)
	if err != nil {
		t.Fatalf("remapSubagentDetailProjectionDecorationAnchors: %v", err)
	}
	if remapped[0].Anchor.MessageID != "turn-source" {
		t.Fatalf("retry decoration anchor=%q, want visible source assistant", remapped[0].Anchor.MessageID)
	}
}

func TestServiceGetFlowerSubagentDetailFailsClosedWhenDetailAdvancesPastTypedTurns(t *testing.T) {
	t.Parallel()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	host := &recordingFloretHost{
		turnPage: flruntime.ThreadTurnsPage{
			ThreadID:       "child-toctou",
			ThroughOrdinal: 1,
			Turns: []flruntime.ThreadTurnSnapshot{{
				TurnID: "turn-mission", RunID: "run-mission", Ordinal: 1,
				UserEntryID: "entry-mission", UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission,
				ThroughOrdinal: 1,
			}},
		},
		detail: flruntime.SubAgentDetail{
			Snapshot: flruntime.SubAgentSnapshot{ThreadID: "child-toctou", ParentThreadID: identity.ThreadID(parent.ThreadID)},
			Context:  flruntime.ThreadContextSnapshot{ThreadID: "child-toctou"},
			Events: []flruntime.ThreadDetailEvent{{
				ID: "entry-admitted-after-turn-read", ThreadID: "child-toctou", TurnID: "turn-new",
				Kind: flruntime.ThreadDetailEventUserMessage,
			}},
		},
	}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.mu.Unlock()
	_, err = svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, "child-toctou", 0, 50)
	if err == nil || !strings.Contains(err.Error(), "unknown canonical user entry") {
		t.Fatalf("GetFlowerSubagentDetail error=%v, want fail-closed TOCTOU rejection", err)
	}
}

func TestServiceGetFlowerSubagentDetailRereadsTypedTurnsAfterConcurrentAdmission(t *testing.T) {
	t.Parallel()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	now := time.UnixMilli(30_000)
	baseTurn := flruntime.ThreadTurnSnapshot{
		TurnID: "turn-mission", RunID: "run-mission", Ordinal: 1, ThroughOrdinal: 1,
		StartedAt: now, UpdatedAt: now,
		UserEntryID: "entry-mission", UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission,
		UserInput:  "delegated mission",
		Status:     flruntime.TurnStatusCompleted,
		Projection: flruntime.ThreadTurnProjection{ThreadID: "child-reread", TurnID: "turn-mission", RunID: "run-mission", Status: flruntime.TurnStatusCompleted, ThroughOrdinal: 1, Segments: []flruntime.ThreadTurnProjectionSegment{{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "done"}}},
	}
	newTurn := flruntime.ThreadTurnSnapshot{
		TurnID: "turn-new", RunID: "run-new", Ordinal: 2, ThroughOrdinal: 2,
		StartedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second),
		UserEntryID: "entry-new", UserMessageOrigin: flruntime.ThreadUserMessageOriginUser,
		UserInput: "new input", Status: flruntime.TurnStatusRunning,
		Projection: flruntime.ThreadTurnProjection{ThreadID: "child-reread", TurnID: "turn-new", RunID: "run-new", Status: flruntime.TurnStatusRunning, ThroughOrdinal: 2},
	}
	host := &recordingFloretHost{
		turnPages: []flruntime.ThreadTurnsPage{{ThreadID: "child-reread", ThroughOrdinal: 1, Turns: []flruntime.ThreadTurnSnapshot{baseTurn}}, {ThreadID: "child-reread", ThroughOrdinal: 2, Turns: []flruntime.ThreadTurnSnapshot{baseTurn, newTurn}}},
		detail: flruntime.SubAgentDetail{
			Snapshot:    flruntime.SubAgentSnapshot{ThreadID: "child-reread", ParentThreadID: identity.ThreadID(parent.ThreadID), CreatedAt: now, UpdatedAt: now.Add(time.Second)},
			Context:     flruntime.ThreadContextSnapshot{ThreadID: "child-reread"},
			Events:      []flruntime.ThreadDetailEvent{{ID: "entry-new", ThreadID: "child-reread", TurnID: "turn-new", Kind: flruntime.ThreadDetailEventUserMessage, CreatedAt: now.Add(time.Second)}},
			GeneratedAt: now.Add(time.Second),
		},
	}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.mu.Unlock()
	if _, err := svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, "child-reread", 0, 50); err != nil {
		t.Fatalf("GetFlowerSubagentDetail after bounded reread: %v", err)
	}
	host.mu.Lock()
	calls := len(host.turnRequests)
	host.mu.Unlock()
	if calls != 2 {
		t.Fatalf("typed turn reads=%d, want bounded reread after one snapshot mismatch", calls)
	}
}

func TestServiceGetFlowerSubagentDetailProjectsCanonicalContextFacts(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	now := time.UnixMilli(20_000)
	host := &recordingFloretHost{
		turnPage: flruntime.ThreadTurnsPage{
			ThreadID:       identity.ThreadID("child-context"),
			ThroughOrdinal: 2,
			Turns: []flruntime.ThreadTurnSnapshot{{
				TurnID:            identity.TurnID("child-turn"),
				RunID:             identity.RunID("child-run"),
				Ordinal:           1,
				StartedAt:         now.Add(-50 * time.Second),
				UpdatedAt:         now,
				UserEntryID:       "child-context-user",
				UserMessageOrigin: flruntime.ThreadUserMessageOriginDelegatedMission,
				UserInput:         "inspect context",
				Status:            flruntime.TurnStatusCompleted,
				ThroughOrdinal:    2,
				Projection: flruntime.ThreadTurnProjection{
					ThreadID:       identity.ThreadID("child-context"),
					TurnID:         identity.TurnID("child-turn"),
					RunID:          identity.RunID("child-run"),
					Status:         flruntime.TurnStatusCompleted,
					ThroughOrdinal: 2,
					Segments: []flruntime.ThreadTurnProjectionSegment{{
						Kind: flruntime.ThreadTurnProjectionSegmentAssistantText,
						Text: "I am about to compact context.",
					}},
				},
			}},
		},
		detail: flruntime.SubAgentDetail{
			Snapshot: flruntime.SubAgentSnapshot{
				ThreadID:       identity.ThreadID("child-context"),
				TaskName:       "Inspect context",
				ParentThreadID: identity.ThreadID(parent.ThreadID),
				ParentTurnID:   identity.TurnID("parent-turn"),
				HostProfileRef: subagentAgentTypeReviewer,
				Status:         flruntime.SubAgentStatusCompleted,
				CreatedAt:      now.Add(-time.Minute),
				UpdatedAt:      now,
			},
			Events: []flruntime.ThreadDetailEvent{
				{
					ID:        "message-1",
					Ordinal:   1,
					ThreadID:  identity.ThreadID("child-context"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventAssistantMessage,
					CreatedAt: now.Add(-40 * time.Second),
					Message:   &flruntime.ThreadDetailMessage{Role: "assistant", Preview: "I am about to compact context."},
				},
				{
					ID:        "compaction-1",
					Ordinal:   2,
					ThreadID:  identity.ThreadID("child-context"),
					TurnID:    identity.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventCompaction,
					CreatedAt: now.Add(-30 * time.Second),
					Compaction: &flruntime.ThreadDetailCompaction{
						OperationID:         "compact-child-1",
						RequestID:           "request-compact-child-1",
						Source:              "context_manager",
						Phase:               "complete",
						Trigger:             "pressure",
						Reason:              "near limit",
						TokensBefore:        900,
						TokensAfterEstimate: 350,
					},
				},
			},
			Context: flruntime.ThreadContextSnapshot{
				ThreadID: identity.ThreadID("child-context"),
				Provider: "openai",
				Model:    "gpt-5-mini",
				Policy:   flconfig.ContextPolicy{ContextWindowTokens: 1000},
				Usage: &observation.ContextStatus{
					RunID:    "child-run",
					ThreadID: "child-context",
					TurnID:   "child-turn",
					Step:     2,
					Phase:    observation.ContextPhaseProjectedRequest,
					Provider: "openai",
					Model:    "gpt-5-mini",
					ContextPressure: flconfig.ContextPressure{
						ProjectedInputTokens: 600,
						ContextWindowTokens:  1000,
						ThresholdTokens:      850,
						RequestSafeLimit:     800,
						OutputHeadroomTokens: 200,
						Source:               flconfig.PressureSourceFullRequestEstimate,
					},
					UsedRatio:      0.6,
					ThresholdRatio: 0.85,
					Status:         observation.ContextStatusStable,
					ObservedAt:     now.Add(-35 * time.Second),
				},
				Compactions: []observation.CompactionEvent{{
					RunID:               "child-run",
					ThreadID:            "child-context",
					TurnID:              "child-turn",
					Step:                2,
					OperationID:         "compact-child-1",
					RequestID:           "request-compact-child-1",
					Phase:               observation.CompactionPhaseComplete,
					Status:              observation.CompactionStatusCompacted,
					Trigger:             "pressure",
					Reason:              "near limit",
					Source:              "context_manager",
					TokensBefore:        900,
					TokensAfterEstimate: 350,
					ObservedAt:          now.Add(-30 * time.Second),
				}},
				UpdatedAt: now,
			},
			GeneratedAt: now,
		},
	}
	key := runThreadKey(meta.EndpointID, parent.ThreadID)
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.subagentRuntimes[key] = &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:        slog.Default(),
			ThreadID:   parent.ThreadID,
			EndpointID: meta.EndpointID,
		}),
		host: host,
	}
	svc.mu.Unlock()

	detail, err := svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, "child-context", 0, 50)
	if err != nil {
		t.Fatalf("GetFlowerSubagentDetail: %v", err)
	}
	if detail.ContextUsage == nil {
		t.Fatalf("missing context usage: %#v", detail)
	}
	if detail.ContextUsage.ContextWindowTokens != 1000 || detail.ContextUsage.RequestSafeLimitTokens != 800 || detail.ContextUsage.PressureStatus != "stable" {
		t.Fatalf("unexpected context usage: %#v", detail.ContextUsage)
	}
	if len(detail.ContextCompactions) != 1 {
		t.Fatalf("context compactions=%#v, want one", detail.ContextCompactions)
	}
	compaction := detail.ContextCompactions[0]
	if compaction.OperationID != "compact-child-1" || compaction.Status != "compacted" || compaction.TokensAfterEstimate != 350 {
		t.Fatalf("unexpected context compaction: %#v", compaction)
	}
	if len(detail.TimelineDecorations) != 1 {
		t.Fatalf("timeline decorations=%#v, want one", detail.TimelineDecorations)
	}
	decoration := detail.TimelineDecorations[0]
	if decoration.Compaction.OperationID != "compact-child-1" || decoration.Anchor.MessageID != "child-turn" || decoration.Anchor.Edge != "after" {
		t.Fatalf("unexpected timeline decoration: %#v", decoration)
	}
	if detail.ModelIOStatus != nil {
		t.Fatalf("subagent detail must not synthesize model_io_status: %#v", detail.ModelIOStatus)
	}
}

func TestFlowerSubagentCompactionAnchorsRejectMetadataIdentityAlias(t *testing.T) {
	t.Parallel()

	_, err := flowerSubagentDetailCompactionAnchors(flruntime.SubAgentDetail{
		Snapshot: flruntime.SubAgentSnapshot{ThreadID: "child-context"},
		Events: []flruntime.ThreadDetailEvent{{
			ThreadID:   "child-context",
			TurnID:     "child-turn",
			Kind:       flruntime.ThreadDetailEventCompaction,
			Compaction: &flruntime.ThreadDetailCompaction{Phase: "complete"},
			Metadata:   map[string]string{"context_operation_id": "legacy-operation"},
		}},
	}, nil)
	if err == nil {
		t.Fatal("subagent compaction metadata identity alias was accepted")
	}
}

func TestServiceGetFlowerSubagentDetailUsesParentScopedReadHostWithoutCachedRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	_, childID := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, "detail_without_cached_runtime")

	svc.mu.Lock()
	if len(svc.subagentRuntimes) != 0 {
		t.Fatalf("test setup unexpectedly cached subagent runtimes: %#v", svc.subagentRuntimes)
	}
	svc.mu.Unlock()

	detail, err := svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, childID, 0, 50)
	if err != nil {
		t.Fatalf("GetFlowerSubagentDetail: %v", err)
	}
	if detail == nil || detail.Summary.ThreadID != childID || detail.Summary.ParentThreadID != parent.ThreadID {
		t.Fatalf("unexpected detail summary: %#v", detail)
	}
	if detail.Summary.ContextMode != subagentContextModeMissionOnly {
		t.Fatalf("context mode=%q, want mission_only from Floret fork mode", detail.Summary.ContextMode)
	}
	if len(detail.Timeline) == 0 {
		t.Fatalf("detail timeline is empty: %#v", detail)
	}
	childRecord, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetThread child detail: %v", err)
	}
	if childRecord != nil {
		t.Fatalf("detail lookup created child threadstore row: %#v", childRecord)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadRouting(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetFlowerThreadRouting child detail: %v", err)
	}
	if childMeta != nil {
		t.Fatalf("detail lookup created child thread metadata: %#v", childMeta)
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal detail: %v", err)
	}
	if strings.Contains(string(encoded), `"args_json"`) || strings.Contains(string(encoded), `"full_output"`) {
		t.Fatalf("maintenance detail leaked raw fields: %s", string(encoded))
	}
}

func TestServiceGetFlowerSubagentDetailRejectsWrongParentBeforeRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	otherParent, err := svc.CreateThread(ctx, meta, "other parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread other parent: %v", err)
	}
	child, err := svc.CreateThread(ctx, meta, "child", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread child: %v", err)
	}
	host := &recordingFloretHost{turnErr: flruntime.ErrSubAgentNotFound}
	key := runThreadKey(meta.EndpointID, otherParent.ThreadID)
	svc.mu.Lock()
	bindRecordingThreadRead(svc, otherParent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, otherParent.ThreadID, host)
	svc.subagentRuntimes[key] = &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:        slog.Default(),
			ThreadID:   otherParent.ThreadID,
			EndpointID: meta.EndpointID,
		}),
		host: host,
	}
	svc.mu.Unlock()

	_, err = svc.GetFlowerSubagentDetail(ctx, meta, otherParent.ThreadID, child.ThreadID, 0, 200)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetFlowerSubagentDetail err=%v, want sql.ErrNoRows", err)
	}
	host.mu.Lock()
	turnRequests := len(host.turnRequests)
	detailRequests := len(host.detailRequests)
	host.mu.Unlock()
	if turnRequests != 1 || detailRequests != 0 {
		t.Fatalf("typed turn calls=%d detail calls=%d, want 1 and 0", turnRequests, detailRequests)
	}
}

func TestServiceListFlowerSubagentsRejectsFloretIdentityMismatch(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	host := &recordingFloretHost{snapshots: []flruntime.SubAgentSnapshot{{
		ThreadID:       "child",
		ParentThreadID: "wrong-parent",
	}}}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parent.ThreadID)] = &floretSubagentRuntime{host: host}
	svc.mu.Unlock()

	_, err = svc.ListFlowerSubagents(ctx, meta, parent.ThreadID)
	if err == nil || !strings.Contains(err.Error(), "invalid Floret subagent list contract") {
		t.Fatalf("ListFlowerSubagents err=%v, want explicit contract error", err)
	}
}

func TestServiceGetFlowerSubagentDetailRejectsFloretIdentityMismatch(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	host := &recordingFloretHost{detail: flruntime.SubAgentDetail{
		Snapshot: flruntime.SubAgentSnapshot{
			ThreadID:       "wrong-child",
			ParentThreadID: identity.ThreadID(parent.ThreadID),
		},
		Context: flruntime.ThreadContextSnapshot{ThreadID: "wrong-child"},
	}}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parent.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parent.ThreadID, host)
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parent.ThreadID)] = &floretSubagentRuntime{host: host}
	svc.mu.Unlock()

	_, err = svc.GetFlowerSubagentDetail(ctx, meta, parent.ThreadID, "child", 0, 50)
	if err == nil || errors.Is(err, sql.ErrNoRows) || !strings.Contains(err.Error(), "invalid Floret subagent detail contract") {
		t.Fatalf("GetFlowerSubagentDetail err=%v, want explicit contract error", err)
	}
}

func TestSubagentEventSinkDoesNotPersistChildToolLifecycle(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	parentView, err := svc.CreateThread(ctx, meta, "parent running projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	parent := newRunWithProductStoreForTest(t, runOptions{
		Log:              svc.log,
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, parentView.ThreadID),
		EndpointID:       meta.EndpointID,
		ThreadID:         parentView.ThreadID,
		RunID:            "parent-running-projection",
		MessageID:        "parent-turn-running-projection",
		PersistOpTimeout: time.Second,
	}, svc.threadsDB)
	runtime := &floretSubagentRuntime{parent: parent}
	event := flruntime.Event{
		Type:     observation.EventTypeStepStart,
		RunID:    "child-run-running-projection",
		ThreadID: "child-thread-running-projection",
		TurnID:   "child-turn-running-projection",
		Projection: &flruntime.ThreadTurnProjection{
			ThreadID:       "child-thread-running-projection",
			TurnID:         "child-turn-running-projection",
			RunID:          "child-run-running-projection",
			Status:         flruntime.TurnStatusRunning,
			ThroughOrdinal: 1,
		},
	}
	if err := event.Validate(); err != nil {
		t.Fatalf("test event is invalid: %v", err)
	}
	floretSubagentEventSink{runtime: runtime}.EmitEvent(event)

}

func TestSubagentChildEventPublishesParentSubagentsPatch(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	parentView, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}

	now := time.Now()
	childID := "child_completed"
	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:        identity.ThreadID(childID),
			TaskName:        "review ui",
			TaskDescription: "Review the Flower tool detail UI and report concise fixes.",
			ParentThreadID:  identity.ThreadID(parentView.ThreadID),
			ParentTurnID:    identity.TurnID("parent-turn"),
			LatestTurnID:    identity.TurnID("child-turn"),
			HostProfileRef:  subagentAgentTypeReviewer,
			Status:          flruntime.SubAgentStatusCompleted,
			LastMessage:     "review complete",
			CreatedAt:       now.Add(-2 * time.Second),
			UpdatedAt:       now,
			Closed:          true,
		}},
	}
	parent := newRun(runOptions{
		Log:              slog.Default(),
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, parentView.ThreadID),
		ThreadID:         parentView.ThreadID,
		RunID:            "parent-run",
		MessageID:        "parent-turn",
		EndpointID:       meta.EndpointID,
		AgentHomeDir:     t.TempDir(),
	})
	runtime := &floretSubagentRuntime{
		parent: parent,
		host:   host,
	}
	svc.mu.Lock()
	bindRecordingThreadRead(svc, parentView.ThreadID, host)
	bindRecordingSubagentReadHost(svc, parentView.ThreadID, host)
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parentView.ThreadID)] = runtime
	svc.mu.Unlock()

	floretSubagentEventSink{runtime: runtime}.EmitEvent(flruntime.Event{
		Type:     "run_end",
		ThreadID: identity.ThreadID(childID),
		TurnID:   identity.TurnID("child-turn"),
	})

	deadline := time.Now().Add(2 * time.Second)
	var payload FlowerLiveThreadPatchedPayload
	for time.Now().Before(deadline) {
		resp, err := svc.ListFlowerThreadLiveEvents(ctx, meta, parentView.ThreadID, 0, 50)
		if err != nil {
			t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
		}
		for i := range resp.Events {
			if resp.Events[i].Kind != FlowerLiveThreadPatched {
				continue
			}
			var candidate FlowerLiveThreadPatchedPayload
			if !decodeFlowerPayload(resp.Events[i].Payload, &candidate) || len(candidate.Patch.Subagents) == 0 {
				continue
			}
			payload = candidate
			break
		}
		if len(payload.Patch.Subagents) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(payload.Patch.Subagents) != 1 {
		t.Fatalf("parent subagents patch=%#v, want one child", payload.Patch.Subagents)
	}
	if got := strings.TrimSpace(payload.Patch.ThreadID); got != parentView.ThreadID {
		t.Fatalf("thread patch id=%q, want %q", got, parentView.ThreadID)
	}
	item := payload.Patch.Subagents[0]
	if item.ThreadID != childID {
		t.Fatalf("subagent identity=%#v, want child %q", item, childID)
	}
	if item.ParentThreadID != parentView.ThreadID {
		t.Fatalf("parent_thread_id=%q, want %q", item.ParentThreadID, parentView.ThreadID)
	}
	if item.TaskName != "review ui" || item.TaskDescription == "" {
		t.Fatalf("subagent task fields=%#v", item)
	}
	if item.Status != subagentStatusCompleted {
		t.Fatalf("subagent status=%q, want %q", item.Status, subagentStatusCompleted)
	}
	if item.CreatedAtUnixMs <= 0 || item.UpdatedAtUnixMs <= 0 {
		t.Fatalf("subagent timestamps missing: %#v", item)
	}
}
