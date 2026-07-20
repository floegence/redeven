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

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/websearch"
)

type recordingSubagentRuntime struct {
	releaseCount atomic.Int32
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
	parent := newTerminalProcessTestRun(workspace, svc, store, endpointID, parentThreadID, parentRunID, parentTurnID)
	parent.permissionSnapshot = PermissionSnapshot{SnapshotID: "parent_snapshot_cleanup", PermissionType: FlowerPermissionFullAccess}

	completedChildThreadID := "child_thread_completed"
	completedChildRunID := "run_child_completed"
	completedChildTurnID := "turn_child_completed"
	completedFloretRunID := "floret_run_completed"
	completedFloretTurnID := "floret_turn_completed"
	runningChildThreadID := "child_thread_running"
	runningChildRunID := "run_child_running"
	runningChildTurnID := "turn_child_running"
	if err := parent.insertChildPermissionSnapshot(completedChildThreadID, completedChildRunID, "tool_spawn_completed", PermissionSnapshot{SnapshotID: "child_snapshot_completed", PermissionType: FlowerPermissionFullAccess}); err != nil {
		t.Fatalf("insert completed child snapshot: %v", err)
	}
	if err := parent.insertChildPermissionSnapshot(runningChildThreadID, runningChildRunID, "tool_spawn_running", PermissionSnapshot{SnapshotID: "child_snapshot_running", PermissionType: FlowerPermissionFullAccess}); err != nil {
		t.Fatalf("insert running child snapshot: %v", err)
	}
	upsertTerminalProcessTestRun(t, store, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID)
	upsertTerminalProcessTestRun(t, store, endpointID, runningChildThreadID, runningChildRunID, runningChildTurnID)

	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{
			{ParentThreadID: flruntime.ThreadID(parentThreadID), ThreadID: flruntime.ThreadID(completedChildThreadID), Status: flruntime.SubAgentStatusCompleted, LatestTurnID: flruntime.TurnID(completedFloretTurnID)},
			{ParentThreadID: flruntime.ThreadID(parentThreadID), ThreadID: flruntime.ThreadID(runningChildThreadID), Status: flruntime.SubAgentStatusRunning, LatestTurnID: flruntime.TurnID(runningChildTurnID)},
		},
		settleResult: terminalProcessTestSettlementResult(terminalProcessTestProjection(completedFloretRunID, completedChildThreadID, completedFloretTurnID, "tool_completed")),
	}
	completedChildRun := newTerminalProcessTestRun(workspace, svc, store, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID)
	completedChildRun.settlementThreadID = completedChildThreadID
	completedChildRun.settlementRunID = completedFloretRunID
	completedChildRun.settlementTurnID = completedFloretTurnID
	completedChildRun.setActiveFloretHost(host)
	svc.runs = map[string]*run{completedChildRunID: completedChildRun}

	runtime := newFloretSubagentRuntime(parent)
	runtime.host = host
	completedProc := startPendingTerminalProcessForTestWithSettlement(t, manager, host, workspace, endpointID, completedChildThreadID, completedChildRunID, completedChildTurnID, completedFloretRunID, completedFloretTurnID, "tool_completed")
	runningProc := startPendingTerminalProcessForTest(t, manager, host, workspace, endpointID, runningChildThreadID, runningChildRunID, runningChildTurnID, "tool_running")

	if err := runtime.cleanupTerminalProcessesForTerminalSubagents(context.Background()); err != nil {
		t.Fatalf("cleanupTerminalProcessesForTerminalSubagents: %v", err)
	}

	host.mu.Lock()
	settleRequests := append([]flruntime.PendingToolSettlementRequest(nil), host.settleRequests...)
	host.mu.Unlock()
	if len(settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want 1", len(settleRequests))
	}
	if settleRequests[0].Target.ThreadID != flruntime.ThreadID(completedChildThreadID) ||
		settleRequests[0].Target.RunID != flruntime.RunID(completedFloretRunID) ||
		settleRequests[0].Target.TurnID != flruntime.TurnID(completedFloretTurnID) ||
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
	mu                  sync.Mutex
	closeSubagentCount  atomic.Int32
	closeSubagentsCount atomic.Int32
	deleteThreadCount   atomic.Int32
	listSubagentCount   atomic.Int32
	spawnErr            error
	snapshots           []flruntime.SubAgentSnapshot
	threads             map[flruntime.ThreadID]flruntime.ThreadSnapshot
	detail              flruntime.SubAgentDetail
	detailErr           error
	detailRequests      []flruntime.ReadSubAgentDetailRequest
	spawnRequests       []flruntime.SpawnSubAgentRequest
	sendInputRequests   []flruntime.SendSubAgentInputRequest
	settleRequests      []flruntime.PendingToolSettlementRequest
	settleResult        flruntime.PendingToolSettlementResult
	settleErr           error
	readProjection      flruntime.ThreadTurnProjection
	readProjectionErr   error
	readProjectionReqs  []flruntime.ReadTurnProjectionRequest
	deleteThreadIDs     []flruntime.ThreadID
	closeSubagentsReqs  []flruntime.CloseSubAgentsRequest
	pendingApprovals    []flruntime.PendingApproval
}

func (h *recordingFloretHost) StartThread(context.Context, flruntime.StartThreadRequest) (flruntime.ThreadSnapshot, error) {
	return flruntime.ThreadSnapshot{}, nil
}

func (h *recordingFloretHost) EnsureThread(_ context.Context, req flruntime.EnsureThreadRequest) (flruntime.ThreadSummary, error) {
	now := time.Now()
	return flruntime.ThreadSummary{
		ID:               req.ThreadID,
		CreatedAt:        now,
		UpdatedAt:        now,
		CanAppendMessage: true,
	}, nil
}

func (h *recordingFloretHost) ReadThreadAgentTodos(_ context.Context, threadID flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: threadID}, nil
}

func (h *recordingFloretHost) UpdateThreadAgentTodos(_ context.Context, req flruntime.UpdateThreadAgentTodosRequest) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: req.ThreadID, Version: req.ExpectedVersion + 1, Items: req.Items}, nil
}

func (h *recordingFloretHost) ForkThread(context.Context, flruntime.ForkThreadRequest) (flruntime.ForkThreadResult, error) {
	return flruntime.ForkThreadResult{}, nil
}

func (h *recordingFloretHost) ReadThread(_ context.Context, id flruntime.ThreadID) (flruntime.ThreadSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.threads != nil {
		if snapshot, ok := h.threads[id]; ok {
			return snapshot, nil
		}
	}
	return flruntime.ThreadSnapshot{}, nil
}

func (h *recordingFloretHost) ListThreadTurns(_ context.Context, _ flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return flruntime.ThreadTurnsPage{}, nil
}

func (h *recordingFloretHost) RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *recordingFloretHost) ListThreadDetailEvents(context.Context, flruntime.ListThreadDetailEventsRequest) (flruntime.ThreadDetailEvents, error) {
	return flruntime.ThreadDetailEvents{}, nil
}

func (h *recordingFloretHost) ListPendingApprovals(_ context.Context, req flruntime.ListPendingApprovalsRequest) (flruntime.PendingApprovals, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return flruntime.PendingApprovals{
		ThreadID:    req.ThreadID,
		Approvals:   append([]flruntime.PendingApproval(nil), h.pendingApprovals...),
		GeneratedAt: time.Now(),
	}, nil
}

func (h *recordingFloretHost) ReadTurnProjection(_ context.Context, req flruntime.ReadTurnProjectionRequest) (flruntime.ThreadTurnProjection, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.readProjectionReqs = append(h.readProjectionReqs, req)
	if h.readProjectionErr != nil {
		return flruntime.ThreadTurnProjection{}, h.readProjectionErr
	}
	if h.readProjection.RunID != "" || h.readProjection.ThreadID != "" || h.readProjection.TurnID != "" || len(h.readProjection.Segments) > 0 {
		return h.readProjection, nil
	}
	return flruntime.ThreadTurnProjection{}, flruntime.ErrTurnNotFound
}

func (h *recordingFloretHost) CompactThread(context.Context, flruntime.CompactThreadRequest) (flruntime.CompactThreadResult, error) {
	return flruntime.CompactThreadResult{}, nil
}

func (h *recordingFloretHost) RetryTurn(context.Context, flruntime.RetryTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *recordingFloretHost) CompletePendingTool(context.Context, flruntime.PendingToolCompletionRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *recordingFloretHost) SettlePendingTool(_ context.Context, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
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

func (h *recordingFloretHost) SpawnSubAgent(_ context.Context, req flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.spawnRequests = append(h.spawnRequests, req)
	if h.spawnErr != nil {
		return flruntime.SubAgentSnapshot{}, h.spawnErr
	}
	now := time.Now()
	snapshot := flruntime.SubAgentSnapshot{
		ThreadID:        req.ThreadID,
		ParentThreadID:  req.ParentThreadID,
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
	return snapshot, nil
}

func (h *recordingFloretHost) SendSubAgentInput(_ context.Context, req flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sendInputRequests = append(h.sendInputRequests, req)
	for _, snapshot := range h.snapshots {
		if snapshot.ThreadID == req.ChildThreadID {
			snapshot.UpdatedAt = time.Now()
			return snapshot, nil
		}
	}
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) WaitSubAgents(_ context.Context, req flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	targets := map[flruntime.ThreadID]struct{}{}
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

func (h *recordingFloretHost) ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	h.listSubagentCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (h *recordingFloretHost) ListSubAgentActivityTimeline(_ context.Context, req flruntime.ListSubAgentActivityTimelineRequest) (flruntime.SubAgentActivityTimelineResult, error) {
	h.mu.Lock()
	snapshots := append([]flruntime.SubAgentSnapshot(nil), h.snapshots...)
	h.mu.Unlock()
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         req.Meta.RunID,
		ThreadID:      req.Meta.ThreadID,
		TurnID:        req.Meta.TurnID,
		TraceID:       req.Meta.TraceID,
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: len(snapshots),
		},
		Items: make([]observation.ActivityItem, 0, len(snapshots)),
	}
	for _, snapshot := range snapshots {
		threadID := strings.TrimSpace(string(snapshot.ThreadID))
		if threadID == "" {
			continue
		}
		timeline.Items = append(timeline.Items, observation.ActivityItem{
			ItemID:           "subagents:" + threadID,
			ToolID:           "subagents",
			ToolName:         "subagents",
			Kind:             observation.ActivityKindControl,
			Status:           observation.ActivityStatusRunning,
			Severity:         observation.ActivitySeverityNormal,
			RequiresApproval: false,
			Label:            firstNonEmptyString(strings.TrimSpace(snapshot.TaskName), threadID),
			Payload: map[string]any{
				"thread_id":        threadID,
				"host_profile_ref": strings.TrimSpace(snapshot.HostProfileRef),
				"task_name":        strings.TrimSpace(snapshot.TaskName),
				"task_description": strings.TrimSpace(snapshot.TaskDescription),
				"status":           strings.TrimSpace(string(snapshot.Status)),
				"last_message":     strings.TrimSpace(snapshot.LastMessage),
				"parent_thread_id": strings.TrimSpace(string(snapshot.ParentThreadID)),
				"parent_turn_id":   strings.TrimSpace(string(snapshot.ParentTurnID)),
				"latest_turn_id":   strings.TrimSpace(string(snapshot.LatestTurnID)),
			},
		})
	}
	timeline.Summary.TotalItems = len(timeline.Items)
	generatedAt := time.Now()
	return flruntime.SubAgentActivityTimelineResult{Timeline: timeline, GeneratedAt: generatedAt}, nil
}

func (h *recordingFloretHost) CloseSubAgent(_ context.Context, req flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	h.closeSubagentCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, snapshot := range h.snapshots {
		if snapshot.ThreadID != req.ChildThreadID {
			continue
		}
		snapshot.Status = flruntime.SubAgentStatusCancelled
		snapshot.CanClose = false
		snapshot.UpdatedAt = time.Now()
		h.snapshots[index] = snapshot
		return snapshot, nil
	}
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) CloseSubAgents(_ context.Context, req flruntime.CloseSubAgentsRequest) (flruntime.CloseSubAgentsResult, error) {
	h.closeSubagentsCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closeSubagentsReqs = append(h.closeSubagentsReqs, req)
	result := flruntime.CloseSubAgentsResult{Snapshots: make([]flruntime.SubAgentSnapshot, 0, len(h.snapshots))}
	for index, snapshot := range h.snapshots {
		if snapshot.Closed || !snapshot.CanClose {
			result.Snapshots = append(result.Snapshots, snapshot)
			continue
		}
		switch snapshot.Status {
		case flruntime.SubAgentStatusCompleted, flruntime.SubAgentStatusFailed, flruntime.SubAgentStatusCancelled, flruntime.SubAgentStatusClosed:
			result.Snapshots = append(result.Snapshots, snapshot)
			continue
		}
		snapshot.Status = flruntime.SubAgentStatusClosed
		snapshot.Closed = true
		snapshot.CanClose = false
		snapshot.CanSendInput = false
		snapshot.CanInterrupt = false
		snapshot.UpdatedAt = time.Now()
		h.snapshots[index] = snapshot
		result.Snapshots = append(result.Snapshots, snapshot)
		result.Closed++
	}
	return result, nil
}

func (h *recordingFloretHost) ReadSubAgentDetail(_ context.Context, req flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.detailRequests = append(h.detailRequests, req)
	if h.detailErr != nil {
		return flruntime.SubAgentDetail{}, h.detailErr
	}
	return h.detail, nil
}

func (h *recordingFloretHost) ListSubAgentDetailEvents(context.Context, flruntime.ListSubAgentDetailEventsRequest) (flruntime.ThreadDetailEvents, error) {
	return flruntime.ThreadDetailEvents{}, nil
}

func (h *recordingFloretHost) DeleteThread(_ context.Context, id flruntime.ThreadID) error {
	h.deleteThreadCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deleteThreadIDs = append(h.deleteThreadIDs, id)
	return nil
}

func openTestFloretHost(t *testing.T, storePath string, fakeResponse string) (*flruntime.Host, *flruntime.Store) {
	t.Helper()
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		t.Fatalf("OpenSQLiteStore: %v", err)
	}
	host := newTestFloretHost(t, store, fakeResponse)
	return host, store
}

func newTestFloretHost(t *testing.T, store *flruntime.Store, fakeResponse string) *flruntime.Host {
	t.Helper()
	if store == nil {
		t.Fatal("Floret store is required")
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config: flconfig.Config{
			Provider:     flconfig.ProviderFake,
			Model:        "fake-model",
			FakeResponse: fakeResponse,
		},
		Store: store,
	})
	if err != nil {
		t.Fatalf("NewHost: %v", err)
	}
	return host
}

func seedTestFloretSubagentTree(t *testing.T, ctx context.Context, svc *Service, parentThreadID string, childThreadID string) string {
	t.Helper()
	storePath, err := floretThreadStorePath(svc.stateDir)
	if err != nil {
		t.Fatalf("floretThreadStorePath: %v", err)
	}
	host := newTestFloretHost(t, svc.floretStore, "child done")
	if _, err := host.EnsureThread(ctx, flruntime.EnsureThreadRequest{ThreadID: flruntime.ThreadID(parentThreadID)}); err != nil {
		t.Fatalf("StartThread: %v", err)
	}
	if _, err := host.SpawnSubAgent(ctx, flruntime.SpawnSubAgentRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ThreadID:       flruntime.ThreadID(childThreadID),
		TaskName:       "child",
		Message:        "work",
		ForkMode:       flruntime.SubAgentForkFullPath,
	}); err != nil {
		t.Fatalf("SpawnSubAgent: %v", err)
	}
	if waited, err := host.WaitSubAgents(ctx, flruntime.WaitSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ChildThreadIDs: []flruntime.ThreadID{flruntime.ThreadID(childThreadID)},
		Timeout:        2 * time.Second,
	}); err != nil || waited.TimedOut {
		t.Fatalf("WaitSubAgents=%#v err=%v", waited, err)
	}
	return storePath
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
		Log:      slog.Default(),
		StateDir: t.TempDir(),
		Service:  svc,
		AIConfig: cfg,
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
		delegatedApprovals: map[string]*delegatedApprovalHandle{},
		persistOpTO:        time.Second,
	}
	parent := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "subagent_spawn_identity")
	parent.service = svc
	parent.threadsDB = store
	parent.cfg = cfg
	parent.currentModelID = "compat/gpt-5-mini"
	parent.resolveProviderKey = func(providerID string) (string, bool, error) {
		return "provider-key", strings.TrimSpace(providerID) == "compat", nil
	}
	freezePermissionPolicyTestSnapshot(t, parent)
	if err := store.CreateThread(context.Background(), threadstore.ThreadSettings{
		ThreadID:   parent.threadID,
		EndpointID: parent.endpointID,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	host := &recordingFloretHost{}
	runtime := &floretSubagentRuntime{parent: parent, host: host}
	spawnToolCallID := "tool_subagents_spawn_identity"
	spawnResult, err := runtime.spawn(context.Background(), spawnToolCallID, map[string]any{
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

	childThreadID := strings.TrimSpace(string(spawnReq.ThreadID))
	childRunID := strings.TrimSpace(spawnReq.Labels.Host[subagentToolHostContextChildRunIDKey])
	if childThreadID == "" || childRunID == "" {
		t.Fatalf("spawn labels missing child identity: thread=%q labels=%#v", childThreadID, spawnReq.Labels)
	}
	if childRunID == childThreadID || childRunID == parent.id {
		t.Fatalf("spawn child_run_id=%q must be distinct from child thread %q and parent run %q", childRunID, childThreadID, parent.id)
	}
	if spawnReq.Labels.Host[subagentToolHostContextChildThreadIDKey] != childThreadID {
		t.Fatalf("spawn labels=%#v, want child thread and subagent id", spawnReq.Labels.Host)
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
}

func TestSubagentSpawnFailureLeavesNoFinalizedChildPermissionSnapshot(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(t.TempDir() + "/threads.sqlite")
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{
		threadsDB:          store,
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		delegatedApprovals: map[string]*delegatedApprovalHandle{},
		persistOpTO:        time.Second,
	}
	parent := newPermissionPolicyTestRun(t, t.TempDir(), FlowerPermissionApprovalRequired, "subagent_spawn_failure")
	parent.service = svc
	parent.threadsDB = store
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
	if _, err := runtime.spawn(context.Background(), spawnToolCallID, map[string]any{
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
	childThreadID := strings.TrimSpace(string(host.spawnRequests[0].ThreadID))
	host.mu.Unlock()
	if childThreadID == "" {
		t.Fatalf("spawn request did not allocate child thread id")
	}
	if rec, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(context.Background(), parent.endpointID, childThreadID); err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshotByThread: %v", err)
	} else if ok {
		t.Fatalf("unexpected finalized child permission snapshot after host failure: %#v", rec)
	}
	provisional, ok, err := store.GetChildPermissionSnapshotBySpawnToolCall(context.Background(), parent.endpointID, spawnToolCallID)
	if err != nil {
		t.Fatalf("GetChildPermissionSnapshotBySpawnToolCall: %v", err)
	}
	if !ok {
		t.Fatalf("missing provisional child permission snapshot for %s", spawnToolCallID)
	}
	if provisional.State != "provisional" {
		t.Fatalf("child snapshot state=%q, want provisional", provisional.State)
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
			ThreadID:       flruntime.ThreadID("child"),
			TaskName:       "child",
			ParentThreadID: flruntime.ThreadID("parent"),
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
			ThreadID:       flruntime.ThreadID(childID),
			TaskName:       "child",
			ParentThreadID: flruntime.ThreadID(parent.ThreadID),
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
	svc.openDeleteMaintenanceHost = func() (ThreadMaintenanceHost, error) { return maintenanceHost, nil }
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
	if got := host.closeSubagentsCount.Load(); got != 0 {
		t.Fatalf("cached runtime CloseSubAgents count=%d, want 0", got)
	}
	if got := host.closeSubagentCount.Load(); got != 0 {
		t.Fatalf("CloseSubAgent count=%d, want 0", got)
	}
	if got := host.deleteThreadCount.Load(); got != 0 {
		t.Fatalf("cached runtime DeleteThread count=%d, want 0", got)
	}
	if got := maintenanceHost.closeSubagentsCount.Load(); got != 0 {
		t.Fatalf("maintenance CloseSubAgents count=%d, want 0", got)
	}
	if got := maintenanceHost.deleteThreadCount.Load(); got != 1 {
		t.Fatalf("maintenance DeleteThread count=%d, want 1", got)
	}
	maintenanceHost.mu.Lock()
	deleteThreadIDs := append([]flruntime.ThreadID(nil), maintenanceHost.deleteThreadIDs...)
	maintenanceHost.mu.Unlock()
	if len(deleteThreadIDs) != 1 || deleteThreadIDs[0] != flruntime.ThreadID(parent.ThreadID) {
		t.Fatalf("DeleteThread ids=%v, want [%s]", deleteThreadIDs, parent.ThreadID)
	}
	childAfterDelete, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetThread child after delete: %v", err)
	}
	if childAfterDelete != nil {
		t.Fatalf("child threadstore row exists: %#v", childAfterDelete)
	}
	childMetaAfterDelete, err := svc.threadsDB.GetFlowerThreadMetadata(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child after delete: %v", err)
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

func TestCloseThreadSubagentsUsesFloretBatchClose(t *testing.T) {
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

	svc.closeThreadSubagents(context.Background(), "env", "parent", time.Second)

	if got := host.closeSubagentsCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgents count=%d, want 1", got)
	}
	if got := host.closeSubagentCount.Load(); got != 0 {
		t.Fatalf("CloseSubAgent count=%d, want 0", got)
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
			ParentThreadID:  flruntime.ThreadID(parentView.ThreadID),
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
	parent := newRun(runOptions{
		Log:        slog.Default(),
		Service:    svc,
		ThreadID:   parentView.ThreadID,
		EndpointID: meta.EndpointID,
		MessageID:  "msg_parent_failed",
	})
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
	if err := parent.closeParentTerminalSubagents(context.Background(), nil, "parent_failed"); err != nil {
		t.Fatalf("closeParentTerminalSubagents: %v", err)
	}
	if got := host.closeSubagentsCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgents count=%d, want 1", got)
	}
	host.mu.Lock()
	requests := append([]flruntime.CloseSubAgentsRequest(nil), host.closeSubagentsReqs...)
	snapshots := append([]flruntime.SubAgentSnapshot(nil), host.snapshots...)
	host.mu.Unlock()
	if len(requests) != 1 || requests[0].ParentThreadID != flruntime.ThreadID(parentView.ThreadID) || requests[0].Reason != "parent_failed" {
		t.Fatalf("CloseSubAgents requests=%#v, want parent_failed for parent thread", requests)
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
	childID := "floret_child_without_cached_runtime"
	storePath := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, childID)

	if _, err := svc.DeleteThread(ctx, meta, parent.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread(parent): %v", err)
	}
	assertLegacyFloretSubagentStoreNotCreated(t, svc)

	reopenedHost, reopenedStore := openTestFloretHost(t, storePath, "unused")
	defer reopenedStore.Close()
	if _, err := reopenedHost.ReadThread(ctx, flruntime.ThreadID(parent.ThreadID)); !isFloretThreadNotFoundError(err) {
		t.Fatalf("ReadThread parent err=%v, want not found", err)
	}
	if _, err := reopenedHost.ReadThread(ctx, flruntime.ThreadID(childID)); !isFloretThreadNotFoundError(err) {
		t.Fatalf("ReadThread child err=%v, want not found", err)
	}
}

func TestCancelThreadClosesFloretSubagentsWithoutCachedRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	childID := "floret_child_cancel_without_cached_runtime"
	storePath := seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, childID)

	if err := svc.CancelThread(meta, parent.ThreadID); err != nil {
		t.Fatalf("CancelThread(parent): %v", err)
	}
	assertLegacyFloretSubagentStoreNotCreated(t, svc)

	reopenedHost, reopenedStore := openTestFloretHost(t, storePath, "unused")
	defer reopenedStore.Close()
	snapshot, err := reopenedHost.ReadSubAgentDetail(ctx, flruntime.ReadSubAgentDetailRequest{
		ParentThreadID: flruntime.ThreadID(parent.ThreadID),
		ChildThreadID:  flruntime.ThreadID(childID),
	})
	if err != nil {
		t.Fatalf("ReadSubAgentDetail child: %v", err)
	}
	if snapshot.Snapshot.Status != flruntime.SubAgentStatusCompleted || snapshot.Snapshot.Closed {
		t.Fatalf("child snapshot after cancel=%#v, want completed history retained", snapshot.Snapshot)
	}
	if _, err := reopenedHost.ReadThread(ctx, flruntime.ThreadID(parent.ThreadID)); err != nil {
		t.Fatalf("ReadThread parent after cancel: %v", err)
	}
	if _, err := reopenedHost.ReadThread(ctx, flruntime.ThreadID(childID)); err != nil {
		t.Fatalf("ReadThread child after cancel: %v", err)
	}
}

func TestServiceGetFlowerSubagentDetailRequestsRawMessageContent(t *testing.T) {
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
		detail: flruntime.SubAgentDetail{
			Snapshot: flruntime.SubAgentSnapshot{
				ThreadID:       flruntime.ThreadID("child-detail"),
				TaskName:       "Inspect tool flow",
				ParentThreadID: flruntime.ThreadID(parent.ThreadID),
				ParentTurnID:   flruntime.TurnID("parent-turn"),
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
					ID:        "event-user",
					Ordinal:   1,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventUserMessage,
					CreatedAt: now.Add(-50 * time.Second),
					Message:   &flruntime.ThreadDetailMessage{Role: "user", Preview: "delegate mission"},
					Metadata:  map[string]string{"raw_omitted": "true"},
				},
				{
					ID:        "event-tool-call",
					Ordinal:   2,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventToolCall,
					CreatedAt: now.Add(-40 * time.Second),
					ToolCall:  &flruntime.ThreadDetailToolCall{ID: "call-1", Name: "terminal.exec", ArgsPreview: "ls", ArgsHash: "hash-args"},
				},
				{
					ID:        "event-tool-result",
					Ordinal:   3,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
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
							URL:       "/artifacts/raw-full-output",
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
							Label:            "Run command",
							Description:      "Command completed",
							Renderer:         observation.ActivityRendererTerminal,
							Payload: map[string]any{
								"output":      "total 4",
								"content_ref": "hash-content",
							},
						}},
					},
				},
				{
					ID:        "event-tool-activity",
					Ordinal:   4,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
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
							ItemID:   "tool:call-1",
							ToolID:   "call-1",
							ToolName: "terminal.exec",
							Kind:     observation.ActivityKindTool,
							Status:   observation.ActivityStatusRunning,
							Severity: observation.ActivitySeverityNormal,
							Label:    "Run command",
							Renderer: observation.ActivityRendererTerminal,
						}},
					},
				},
				{
					ID:        "event-approval",
					Ordinal:   5,
					ThreadID:  flruntime.ThreadID("child-detail"),
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
							Label:            "terminal.exec",
							Description:      "readonly policy",
						}},
					},
				},
				{
					ID:        "event-error",
					Ordinal:   6,
					ThreadID:  flruntime.ThreadID("child-detail"),
					Kind:      flruntime.ThreadDetailEventError,
					CreatedAt: now.Add(-10 * time.Second),
					Error:     "tool blocked",
				},
				{
					ID:        "event-final-assistant",
					Ordinal:   7,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventAssistantMessage,
					CreatedAt: now.Add(-5 * time.Second),
					Message: &flruntime.ThreadDetailMessage{
						Role:    "assistant",
						Preview: finalPreview,
						Content: finalContent,
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
					Label:            "Run command",
					Description:      "Command completed",
					Renderer:         observation.ActivityRendererTerminal,
					Payload: map[string]any{
						"output":      "total 4",
						"content_ref": "hash-content",
					},
				}},
			},
			Context:      flruntime.ThreadContextSnapshot{ThreadID: flruntime.ThreadID("child-detail")},
			NextOrdinal:  7,
			HasMore:      true,
			RetainedFrom: 1,
			GeneratedAt:  now,
		},
	}
	key := runThreadKey(meta.EndpointID, parent.ThreadID)
	svc.mu.Lock()
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
	childRecord, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, "child-detail")
	if err != nil {
		t.Fatalf("GetThread child detail: %v", err)
	}
	if childRecord != nil {
		t.Fatalf("detail lookup created child threadstore row: %#v", childRecord)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadMetadata(ctx, meta.EndpointID, "child-detail")
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child detail: %v", err)
	}
	if childMeta != nil {
		t.Fatalf("detail lookup created child thread metadata: %#v", childMeta)
	}
	host.mu.Lock()
	requests := append([]flruntime.ReadSubAgentDetailRequest(nil), host.detailRequests...)
	host.mu.Unlock()
	if len(requests) != 1 {
		t.Fatalf("detail request count=%d, want 1", len(requests))
	}
	req := requests[0]
	if req.ParentThreadID != flruntime.ThreadID(parent.ThreadID) || req.ChildThreadID != flruntime.ThreadID("child-detail") {
		t.Fatalf("unexpected detail request identity: %#v", req)
	}
	if req.AfterOrdinal != 7 || req.Limit != 333 {
		t.Fatalf("unexpected detail pagination: %#v", req)
	}
	if !req.IncludeRaw {
		t.Fatalf("Flower UI detail must request raw child transcript messages for full display output")
	}
	if detail == nil || detail.Summary.ThreadID != "child-detail" || detail.Summary.ParentThreadID != parent.ThreadID {
		t.Fatalf("unexpected detail summary: %#v", detail)
	}
	if len(detail.Timeline) != 7 {
		t.Fatalf("timeline rows=%d, want 7: %#v", len(detail.Timeline), detail.Timeline)
	}
	for _, index := range []int{1, 2, 3, 4} {
		rowJSON, err := json.Marshal(detail.Timeline[index])
		if err != nil {
			t.Fatalf("marshal row %d: %v", index, err)
		}
		if strings.Contains(string(rowJSON), `"activity"`) {
			t.Fatalf("timeline row %d should not expose per-event activity: %s", index, string(rowJSON))
		}
	}
	if detail.Timeline[1].ToolCall == nil || detail.Timeline[1].ToolCall.Name != "terminal.exec" || detail.Timeline[1].ToolCall.ArgsHash == "" {
		t.Fatalf("tool call row not projected: %#v", detail.Timeline[1])
	}
	if detail.Timeline[2].ToolResult == nil || detail.Timeline[2].ToolResult.Preview != "total 4" || !detail.Timeline[2].ToolResult.Truncated {
		t.Fatalf("tool result row not projected: %#v", detail.Timeline[2])
	}
	if detail.Timeline[3].ToolCall == nil || detail.Timeline[3].Kind != "tool_activity" {
		t.Fatalf("tool activity row not projected as journal fact: %#v", detail.Timeline[3])
	}
	if detail.Activity == nil || len(detail.Activity.Items) != 1 {
		t.Fatalf("canonical subagent activity not projected: %#v", detail)
	}
	resultActivity := detail.Activity.Items[0]
	if resultActivity.Renderer != observation.ActivityRendererTerminal || resultActivity.Payload["output"] != "total 4" || resultActivity.Payload["content_ref"] != "hash-content" {
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
	if detail.Timeline[4].Approval == nil || detail.Timeline[4].Approval.State != "denied" {
		t.Fatalf("approval row not projected: %#v", detail.Timeline[4])
	}
	if detail.Timeline[5].Error != "tool blocked" {
		t.Fatalf("error row not projected: %#v", detail.Timeline[5])
	}
	if detail.Timeline[6].Message == nil || detail.Timeline[6].Message.Text != finalContent || detail.Timeline[6].Message.Preview != finalPreview {
		t.Fatalf("assistant detail should use raw content for text and bounded preview for preview: %#v", detail.Timeline[6])
	}
	if strings.Contains(detail.Timeline[6].Message.Preview, "2607.02514v1") {
		t.Fatalf("assistant preview should remain bounded: %#v", detail.Timeline[6].Message)
	}
	if detail.Timeline[6].Message.Text == detail.Summary.LastMessage {
		t.Fatalf("assistant detail text should come from Floret message content, not summary last_message: %#v", detail.Timeline[6].Message)
	}
	if !detail.HasMore || detail.NextOrdinal != 7 || detail.RetainedFrom != 1 {
		t.Fatalf("pagination metadata not projected: %#v", detail)
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
		detail: flruntime.SubAgentDetail{
			Snapshot: flruntime.SubAgentSnapshot{
				ThreadID:       flruntime.ThreadID("child-context"),
				TaskName:       "Inspect context",
				ParentThreadID: flruntime.ThreadID(parent.ThreadID),
				ParentTurnID:   flruntime.TurnID("parent-turn"),
				HostProfileRef: subagentAgentTypeReviewer,
				Status:         flruntime.SubAgentStatusCompleted,
				CreatedAt:      now.Add(-time.Minute),
				UpdatedAt:      now,
			},
			Events: []flruntime.ThreadDetailEvent{
				{
					ID:        "message-1",
					Ordinal:   1,
					ThreadID:  flruntime.ThreadID("child-context"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.ThreadDetailEventAssistantMessage,
					CreatedAt: now.Add(-40 * time.Second),
					Message:   &flruntime.ThreadDetailMessage{Role: "assistant", Preview: "I am about to compact context."},
				},
				{
					ID:        "compaction-1",
					Ordinal:   2,
					ThreadID:  flruntime.ThreadID("child-context"),
					TurnID:    flruntime.TurnID("child-turn"),
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
				ThreadID: flruntime.ThreadID("child-context"),
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
	if decoration.Compaction.OperationID != "compact-child-1" || decoration.Anchor.MessageID != "child-context:1:message" || decoration.Anchor.Edge != "after" {
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
	})
	if err == nil {
		t.Fatal("subagent compaction metadata identity alias was accepted")
	}
}

func TestServiceGetFlowerSubagentDetailUsesMaintenanceHostWithoutCachedRuntime(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	childID := "floret_child_detail_without_cached_runtime"
	seedTestFloretSubagentTree(t, ctx, svc, parent.ThreadID, childID)

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
	if detail.Summary.ContextMode != subagentContextModeFullHistory {
		t.Fatalf("context mode=%q, want full_history from Floret fork mode", detail.Summary.ContextMode)
	}
	if len(detail.Timeline) == 0 {
		t.Fatalf("detail timeline is empty: %#v", detail)
	}
	childRecord, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetThread child detail: %v", err)
	}
	if childRecord != nil {
		t.Fatalf("detail lookup created child threadstore row: %#v", childRecord)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadMetadata(ctx, meta.EndpointID, childID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child detail: %v", err)
	}
	if childMeta != nil {
		t.Fatalf("detail lookup created child thread metadata: %#v", childMeta)
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal detail: %v", err)
	}
	if strings.Contains(string(encoded), `"content"`) || strings.Contains(string(encoded), `"args_json"`) {
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
	host := &recordingFloretHost{detailErr: flruntime.ErrSubAgentNotFound}
	key := runThreadKey(meta.EndpointID, otherParent.ThreadID)
	svc.mu.Lock()
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
	requests := len(host.detailRequests)
	host.mu.Unlock()
	if requests != 1 {
		t.Fatalf("detail host calls=%d, want 1", requests)
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
	parent := newRun(runOptions{
		Log:              svc.log,
		Service:          svc,
		ThreadsDB:        svc.threadsDB,
		EndpointID:       meta.EndpointID,
		ThreadID:         parentView.ThreadID,
		RunID:            "parent-running-projection",
		MessageID:        "parent-turn-running-projection",
		PersistOpTimeout: time.Second,
	})
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
			ThreadID:        flruntime.ThreadID(childID),
			TaskName:        "review ui",
			TaskDescription: "Review the Flower tool detail UI and report concise fixes.",
			ParentThreadID:  flruntime.ThreadID(parentView.ThreadID),
			ParentTurnID:    flruntime.TurnID("parent-turn"),
			LatestTurnID:    flruntime.TurnID("child-turn"),
			HostProfileRef:  subagentAgentTypeReviewer,
			Status:          flruntime.SubAgentStatusCompleted,
			LastMessage:     "review complete",
			CreatedAt:       now.Add(-2 * time.Second),
			UpdatedAt:       now,
			Closed:          true,
		}},
	}
	parent := newRun(runOptions{
		Log:          slog.Default(),
		ThreadID:     parentView.ThreadID,
		RunID:        "parent-run",
		MessageID:    "parent-turn",
		EndpointID:   meta.EndpointID,
		AgentHomeDir: t.TempDir(),
		Service:      svc,
	})
	runtime := &floretSubagentRuntime{
		parent: parent,
		host:   host,
	}
	svc.mu.Lock()
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parentView.ThreadID)] = runtime
	svc.mu.Unlock()

	floretSubagentEventSink{runtime: runtime}.EmitEvent(flruntime.Event{
		Type:     "run_end",
		ThreadID: flruntime.ThreadID(childID),
		TurnID:   flruntime.TurnID("child-turn"),
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
