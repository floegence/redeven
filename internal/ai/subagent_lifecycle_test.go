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

type recordingFloretHost struct {
	mu                  sync.Mutex
	closeCount          atomic.Int32
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
	deleteThreadIDs     []flruntime.ThreadID
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

func (h *recordingFloretHost) RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *recordingFloretHost) ListThreadDetailEvents(context.Context, flruntime.ListThreadDetailEventsRequest) (flruntime.ThreadDetailEvents, error) {
	return flruntime.ThreadDetailEvents{}, nil
}

func (h *recordingFloretHost) ListPendingApprovals(context.Context, flruntime.ListPendingApprovalsRequest) (flruntime.PendingApprovals, error) {
	return flruntime.PendingApprovals{}, nil
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

func (h *recordingFloretHost) SpawnSubAgent(_ context.Context, req flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.spawnRequests = append(h.spawnRequests, req)
	if h.spawnErr != nil {
		return flruntime.SubAgentSnapshot{}, h.spawnErr
	}
	now := time.Now()
	snapshot := flruntime.SubAgentSnapshot{
		ThreadID:       req.ThreadID,
		ParentThreadID: req.ParentThreadID,
		TaskName:       req.TaskName,
		HostProfileRef: req.HostProfileRef,
		ForkMode:       req.ForkMode,
		Status:         flruntime.SubAgentStatusRunning,
		CreatedAt:      now,
		UpdatedAt:      now,
		CanSendInput:   true,
		CanInterrupt:   true,
		CanClose:       true,
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
				"subagent_id":      threadID,
				"thread_id":        threadID,
				"host_profile_ref": strings.TrimSpace(snapshot.HostProfileRef),
				"task_name":        strings.TrimSpace(snapshot.TaskName),
				"title":            firstNonEmptyString(strings.TrimSpace(snapshot.TaskName), threadID),
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

func (h *recordingFloretHost) CloseSubAgents(context.Context, flruntime.CloseSubAgentsRequest) (flruntime.CloseSubAgentsResult, error) {
	h.closeSubagentsCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
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

func (h *recordingFloretHost) ListSubAgentDetailEvents(context.Context, flruntime.ListSubAgentDetailEventsRequest) (flruntime.SubAgentDetailEvents, error) {
	return flruntime.SubAgentDetailEvents{}, nil
}

func (h *recordingFloretHost) DeleteThread(_ context.Context, id flruntime.ThreadID) error {
	h.deleteThreadCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deleteThreadIDs = append(h.deleteThreadIDs, id)
	return nil
}

func (h *recordingFloretHost) Close() error {
	h.closeCount.Add(1)
	return nil
}

func openTestFloretHost(t *testing.T, storePath string, fakeResponse string) flruntime.Host {
	t.Helper()
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		t.Fatalf("OpenSQLiteStore: %v", err)
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
		_ = store.Close()
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
	host := openTestFloretHost(t, storePath, "child done")
	if _, err := host.StartThread(ctx, flruntime.StartThreadRequest{ThreadID: flruntime.ThreadID(parentThreadID)}); err != nil {
		_ = host.Close()
		t.Fatalf("StartThread: %v", err)
	}
	if _, err := host.SpawnSubAgent(ctx, flruntime.SpawnSubAgentRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ThreadID:       flruntime.ThreadID(childThreadID),
		TaskName:       "child",
		Message:        "work",
		ForkMode:       flruntime.SubAgentForkFullPath,
	}); err != nil {
		_ = host.Close()
		t.Fatalf("SpawnSubAgent: %v", err)
	}
	if waited, err := host.WaitSubAgents(ctx, flruntime.WaitSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ChildThreadIDs: []flruntime.ThreadID{flruntime.ThreadID(childThreadID)},
		Timeout:        2 * time.Second,
	}); err != nil || waited.TimedOut {
		_ = host.Close()
		t.Fatalf("WaitSubAgents=%#v err=%v", waited, err)
	}
	if err := host.Close(); err != nil {
		t.Fatalf("Close seed host: %v", err)
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
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("host closeCount=%d, want 1", got)
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
	r := newRun(runOptions{
		Log:      slog.Default(),
		StateDir: t.TempDir(),
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

	baseKey, err := r.subagentHostConfigKey()
	if err != nil {
		t.Fatalf("subagentHostConfigKey base: %v", err)
	}
	assertSubagentHostKeyChanges := func(name string, mutate func(), restore func()) {
		t.Helper()
		mutate()
		nextKey, err := r.subagentHostConfigKey()
		if err != nil {
			t.Fatalf("%s subagentHostConfigKey: %v", name, err)
		}
		if nextKey == baseKey {
			t.Fatalf("%s did not change subagent host config key", name)
		}
		restore()
		restored, err := r.subagentHostConfigKey()
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

	host := &recordingFloretHost{}
	runtime := &floretSubagentRuntime{parent: parent, host: host}
	spawnToolCallID := "tool_subagents_spawn_identity"
	if _, err := runtime.spawn(context.Background(), spawnToolCallID, map[string]any{
		"agent_type": "worker",
		"task_name":  "identity check",
		"message":    "check child approval identity",
	}); err != nil {
		t.Fatalf("spawn: %v", err)
	}

	host.mu.Lock()
	if len(host.spawnRequests) != 1 {
		t.Fatalf("spawn request count=%d, want 1", len(host.spawnRequests))
	}
	spawnReq := host.spawnRequests[0]
	host.mu.Unlock()

	childThreadID := strings.TrimSpace(string(spawnReq.ThreadID))
	childRunID := strings.TrimSpace(spawnReq.Labels.Host[subagentToolHostContextChildRunIDKey])
	if childThreadID == "" || childRunID == "" {
		t.Fatalf("spawn labels missing child identity: thread=%q labels=%#v", childThreadID, spawnReq.Labels)
	}
	if childRunID == childThreadID || childRunID == parent.id {
		t.Fatalf("spawn child_run_id=%q must be distinct from child thread %q and parent run %q", childRunID, childThreadID, parent.id)
	}
	if spawnReq.Labels.Host[subagentToolHostContextChildThreadIDKey] != childThreadID ||
		spawnReq.Labels.Host[subagentToolHostContextSubagentIDKey] != childThreadID {
		t.Fatalf("spawn labels=%#v, want child thread and subagent id", spawnReq.Labels.Host)
	}

	rec, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(context.Background(), parent.endpointID, childThreadID)
	if err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshotByThread: %v", err)
	}
	if !ok || rec.ChildRunID != childRunID {
		t.Fatalf("child snapshot record=%#v ok=%v, want child_run_id %q", rec, ok, childRunID)
	}
	if rec.SpawnToolCallID != spawnToolCallID {
		t.Fatalf("spawn_tool_call_id=%q, want real tool call id %q", rec.SpawnToolCallID, spawnToolCallID)
	}

	if _, err := runtime.sendInput(context.Background(), map[string]any{
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
		"agent_type": "worker",
		"task_name":  "failure check",
		"message":    "fail before child starts",
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
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("release host closeCount=%d, want 1", got)
	}
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

	runtime.scheduleParentSubagentTimelineRefresh("child")
	runtime.release()
	time.Sleep(250 * time.Millisecond)

	if got := host.listSubagentCount.Load(); got != 0 {
		t.Fatalf("released runtime delayed refresh listed subagents %d times; want 0", got)
	}
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("host closeCount=%d, want 1", got)
	}
	runtime.mu.Lock()
	queued := len(runtime.timelineQueued)
	runtime.mu.Unlock()
	if queued != 0 {
		t.Fatalf("timeline queue length=%d, want 0", queued)
	}
}

func TestDeleteThreadClosesRuntimeWithoutChildThreadstoreProjection(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
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
	key := runThreadKey(meta.EndpointID, parent.ThreadID)
	svc.mu.Lock()
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

	if err := svc.DeleteThread(ctx, meta, parent.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread(parent): %v", err)
	}
	if got := host.closeSubagentsCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgents count=%d, want 1", got)
	}
	if got := host.closeSubagentCount.Load(); got != 0 {
		t.Fatalf("CloseSubAgent count=%d, want 0", got)
	}
	if got := host.deleteThreadCount.Load(); got != 1 {
		t.Fatalf("DeleteThread count=%d, want 1", got)
	}
	host.mu.Lock()
	deleteThreadIDs := append([]flruntime.ThreadID(nil), host.deleteThreadIDs...)
	host.mu.Unlock()
	if len(deleteThreadIDs) != 1 || deleteThreadIDs[0] != flruntime.ThreadID(parent.ThreadID) {
		t.Fatalf("DeleteThread ids=%v, want [%s]", deleteThreadIDs, parent.ThreadID)
	}
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("runtime host close count=%d, want 1", got)
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

	if err := svc.DeleteThread(ctx, meta, parent.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread(parent): %v", err)
	}
	assertLegacyFloretSubagentStoreNotCreated(t, svc)

	reopenedHost := openTestFloretHost(t, storePath, "unused")
	defer reopenedHost.Close()
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

	reopenedHost := openTestFloretHost(t, storePath, "unused")
	defer reopenedHost.Close()
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

func TestServiceGetFlowerSubagentDetailUsesParentScopedRuntimeWithoutRaw(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	now := time.Now()
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
			Events: []flruntime.SubAgentDetailEvent{
				{
					ID:        "event-user",
					Ordinal:   1,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.SubAgentDetailEventUserMessage,
					CreatedAt: now.Add(-50 * time.Second),
					Message:   &flruntime.SubAgentDetailMessage{Role: "user", Preview: "delegate mission"},
					Metadata:  map[string]string{"raw_omitted": "true"},
				},
				{
					ID:        "event-tool-call",
					Ordinal:   2,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.SubAgentDetailEventToolCall,
					CreatedAt: now.Add(-40 * time.Second),
					ToolCall:  &flruntime.SubAgentDetailToolCall{ID: "call-1", Name: "terminal.exec", ArgsPreview: "ls", ArgsHash: "hash-args"},
				},
				{
					ID:        "event-tool-result",
					Ordinal:   3,
					ThreadID:  flruntime.ThreadID("child-detail"),
					TurnID:    flruntime.TurnID("child-turn"),
					Kind:      flruntime.SubAgentDetailEventToolResult,
					CreatedAt: now.Add(-30 * time.Second),
					ToolResult: &flruntime.SubAgentDetailToolResult{
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
								"stdout":      "total 4",
								"content_ref": "hash-content",
							},
						}},
					},
				},
				{
					ID:        "event-approval",
					Ordinal:   4,
					ThreadID:  flruntime.ThreadID("child-detail"),
					Kind:      flruntime.SubAgentDetailEventApproval,
					CreatedAt: now.Add(-20 * time.Second),
					Approval:  &flruntime.SubAgentDetailApproval{State: "denied", ToolName: "terminal.exec", ArgsHash: "hash-args", Reason: "readonly policy"},
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
							ItemID:           "approval-1",
							ToolID:           "call-1",
							ToolName:         "terminal.exec",
							Kind:             observation.ActivityKindApproval,
							Status:           observation.ActivityStatusError,
							Severity:         observation.ActivitySeverityError,
							NeedsAttention:   true,
							RequiresApproval: true,
							ApprovalState:    "denied",
							Label:            "terminal.exec",
							Description:      "readonly policy",
						}},
					},
				},
				{
					ID:        "event-error",
					Ordinal:   5,
					ThreadID:  flruntime.ThreadID("child-detail"),
					Kind:      flruntime.SubAgentDetailEventError,
					CreatedAt: now.Add(-10 * time.Second),
					Error:     "tool blocked",
				},
			},
			NextOrdinal:  6,
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
	if req.IncludeRaw {
		t.Fatalf("Flower UI detail must not request raw child transcript/tool payloads by default")
	}
	if detail == nil || detail.Summary.ThreadID != "child-detail" || detail.Summary.ParentThreadID != parent.ThreadID {
		t.Fatalf("unexpected detail summary: %#v", detail)
	}
	if len(detail.Timeline) != 5 {
		t.Fatalf("timeline rows=%d, want 5: %#v", len(detail.Timeline), detail.Timeline)
	}
	if detail.Timeline[1].ToolCall == nil || detail.Timeline[1].ToolCall.Name != "terminal.exec" || detail.Timeline[1].ToolCall.ArgsHash == "" {
		t.Fatalf("tool call row not projected: %#v", detail.Timeline[1])
	}
	if detail.Timeline[1].Activity != nil {
		t.Fatalf("paired tool call should not duplicate result activity: %#v", detail.Timeline[1].Activity)
	}
	if detail.Timeline[2].ToolResult == nil || detail.Timeline[2].ToolResult.Preview != "total 4" || !detail.Timeline[2].ToolResult.Truncated {
		t.Fatalf("tool result row not projected: %#v", detail.Timeline[2])
	}
	if detail.Timeline[2].Activity == nil || len(detail.Timeline[2].Activity.Items) != 1 {
		t.Fatalf("tool result activity not projected: %#v", detail.Timeline[2])
	}
	resultActivity := detail.Timeline[2].Activity.Items[0]
	if resultActivity.Renderer != observation.ActivityRendererTerminal || resultActivity.Payload["stdout"] != "total 4" || resultActivity.Payload["content_ref"] != "hash-content" {
		t.Fatalf("tool result activity does not use canonical terminal presentation: %#v", resultActivity)
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
	if detail.Timeline[3].Activity == nil || len(detail.Timeline[3].Activity.Items) != 1 || detail.Timeline[3].Activity.Items[0].Kind != observation.ActivityKindApproval {
		t.Fatalf("approval activity not projected through canonical activity block: %#v", detail.Timeline[3])
	}
	if detail.Timeline[4].Error != "tool blocked" {
		t.Fatalf("error row not projected: %#v", detail.Timeline[4])
	}
	if !detail.HasMore || detail.NextOrdinal != 6 || detail.RetainedFrom != 1 {
		t.Fatalf("pagination metadata not projected: %#v", detail)
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
	host := &recordingFloretHost{detailErr: errors.New("subagent not found")}
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

func TestSubagentChildEventRefreshesParentTimeline(t *testing.T) {
	t.Parallel()

	now := time.Now()
	childID := "child_completed"
	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:       flruntime.ThreadID(childID),
			TaskName:       "review ui",
			ParentThreadID: flruntime.ThreadID("parent-thread"),
			ParentTurnID:   flruntime.TurnID("parent-turn"),
			LatestTurnID:   flruntime.TurnID("child-turn"),
			HostProfileRef: subagentAgentTypeReviewer,
			Status:         flruntime.SubAgentStatusCompleted,
			LastMessage:    "review complete",
			CreatedAt:      now.Add(-2 * time.Second),
			UpdatedAt:      now,
			Closed:         true,
		}},
	}
	var (
		eventsMu sync.Mutex
		events   []any
	)
	parent := newRun(runOptions{
		Log:          slog.Default(),
		ThreadID:     "parent-thread",
		RunID:        "parent-run",
		MessageID:    "parent-turn",
		EndpointID:   "env",
		AgentHomeDir: t.TempDir(),
	})
	parent.onStreamEvent = func(ev any) {
		eventsMu.Lock()
		events = append(events, ev)
		eventsMu.Unlock()
	}
	runtime := &floretSubagentRuntime{
		parent: parent,
		host:   host,
	}

	floretSubagentEventSink{runtime: runtime}.EmitEvent(flruntime.Event{
		Type:     "run_end",
		ThreadID: flruntime.ThreadID(childID),
		TurnID:   flruntime.TurnID("child-turn"),
	})

	deadline := time.Now().Add(2 * time.Second)
	var block ActivityTimelineBlock
	for time.Now().Before(deadline) {
		eventsMu.Lock()
		for _, ev := range events {
			set, ok := ev.(streamEventBlockSet)
			if !ok {
				continue
			}
			if candidate, ok := set.Block.(ActivityTimelineBlock); ok {
				block = candidate
			}
		}
		eventsMu.Unlock()
		if len(block.Items) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(block.Items) == 0 {
		t.Fatalf("parent subagent timeline was not refreshed; events=%#v", events)
	}
	if got := strings.TrimSpace(block.Items[0].ToolName); got != "subagents" {
		t.Fatalf("timeline tool name=%q, want subagents", got)
	}
	payload := block.Items[0].Payload
	if got := strings.TrimSpace(anyToString(payload["thread_id"])); got != childID {
		t.Fatalf("payload thread_id=%q, want %q; payload=%#v", got, childID, payload)
	}
	if got := strings.TrimSpace(anyToString(payload["status"])); got != subagentStatusCompleted {
		t.Fatalf("payload status=%q, want %q; payload=%#v", got, subagentStatusCompleted, payload)
	}
	if got := strings.TrimSpace(anyToString(payload["last_message"])); got != "review complete" {
		t.Fatalf("payload last_message=%q, want review complete; payload=%#v", got, payload)
	}
}
