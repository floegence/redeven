package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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
	mu                 sync.Mutex
	closeCount         atomic.Int32
	closeSubagentCount atomic.Int32
	listSubagentCount  atomic.Int32
	spawnErr           error
	snapshots          []flruntime.SubAgentSnapshot
	threads            map[flruntime.ThreadID]flruntime.ThreadSnapshot
	detail             flruntime.SubAgentDetail
	detailErr          error
	detailRequests     []flruntime.ReadSubAgentDetailRequest
	spawnRequests      []flruntime.SpawnSubAgentRequest
	sendInputRequests  []flruntime.SendSubAgentInputRequest
}

func (h *recordingFloretHost) StartThread(context.Context, flruntime.StartThreadRequest) (flruntime.ThreadSnapshot, error) {
	return flruntime.ThreadSnapshot{}, nil
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

func (h *recordingFloretHost) DeleteThread(context.Context, flruntime.ThreadID) error {
	return nil
}

func (h *recordingFloretHost) Close() error {
	h.closeCount.Add(1)
	return nil
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

func TestReleasedSubagentRuntimeDropsQueuedProjectionSync(t *testing.T) {
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

	runtime.scheduleProjectedSubagentSync("child")
	runtime.release()
	time.Sleep(250 * time.Millisecond)

	if got := host.listSubagentCount.Load(); got != 0 {
		t.Fatalf("released runtime delayed sync listed subagents %d times; want 0", got)
	}
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("host closeCount=%d, want 1", got)
	}
	runtime.mu.Lock()
	queued := len(runtime.syncQueued)
	runtime.mu.Unlock()
	if queued != 0 {
		t.Fatalf("sync queue length=%d, want 0", queued)
	}
}

func TestDeleteThreadClosesRuntimeAndDeletesChildProjections(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	child, err := svc.CreateThread(ctx, meta, "child", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread child: %v", err)
	}
	if err := svc.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:     meta.EndpointID,
		ThreadID:       child.ThreadID,
		OwnerKind:      flowerSubagentProjectionOwnerKind,
		OwnerID:        flowerSubagentProjectionOwnerID,
		ParentThreadID: parent.ThreadID,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata child: %v", err)
	}
	host := &recordingFloretHost{
		snapshots: []flruntime.SubAgentSnapshot{{
			ThreadID:       flruntime.ThreadID(child.ThreadID),
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
	if got := host.closeSubagentCount.Load(); got != 1 {
		t.Fatalf("CloseSubAgent count=%d, want 1", got)
	}
	if got := host.closeCount.Load(); got != 1 {
		t.Fatalf("runtime host close count=%d, want 1", got)
	}
	childAfterDelete, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, child.ThreadID)
	if err != nil {
		t.Fatalf("GetThread child after delete: %v", err)
	}
	if childAfterDelete != nil {
		t.Fatalf("child projection thread still exists")
	}
	childMetaAfterDelete, err := svc.threadsDB.GetFlowerThreadMetadata(ctx, meta.EndpointID, child.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child after delete: %v", err)
	}
	if childMetaAfterDelete != nil {
		t.Fatalf("child projection metadata still exists: %#v", childMetaAfterDelete)
	}
	svc.mu.Lock()
	_, exists := svc.subagentRuntimes[key]
	svc.mu.Unlock()
	if exists {
		t.Fatalf("parent runtime cache entry still exists")
	}
}

func TestSubagentProjectionRejectsThreadMutations(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	child, err := svc.CreateThread(ctx, meta, "child", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread child: %v", err)
	}
	if err := svc.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:     meta.EndpointID,
		ThreadID:       child.ThreadID,
		OwnerKind:      flowerSubagentProjectionOwnerKind,
		OwnerID:        flowerSubagentProjectionOwnerID,
		ParentThreadID: parent.ThreadID,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata child: %v", err)
	}

	cases := []struct {
		name string
		call func() error
	}{
		{name: "rename", call: func() error { return svc.RenameThread(ctx, meta, child.ThreadID, "renamed") }},
		{name: "set_model", call: func() error { return svc.SetThreadModel(ctx, meta, child.ThreadID, "openai/gpt-4o-mini") }},
		{name: "set_permission", call: func() error {
			return svc.SetThreadPermissionType(ctx, meta, child.ThreadID, config.AIPermissionReadonly)
		}},
		{name: "pin", call: func() error {
			_, err := svc.SetThreadPinned(ctx, meta, child.ThreadID, true)
			return err
		}},
		{name: "cancel", call: func() error { return svc.CancelThread(meta, child.ThreadID) }},
		{name: "delete", call: func() error { return svc.DeleteThread(ctx, meta, child.ThreadID, true) }},
	}
	for _, tc := range cases {
		if err := tc.call(); !errors.Is(err, ErrReadOnlyThread) {
			t.Fatalf("%s err=%v, want %v", tc.name, err, ErrReadOnlyThread)
		}
	}
	if _, err := svc.ForkThread(ctx, meta, child.ThreadID, "fork"); !errors.Is(err, ErrReadOnlyThread) {
		t.Fatalf("ForkThread err=%v, want %v", err, ErrReadOnlyThread)
	}
	if _, err := svc.StopThread(ctx, meta, child.ThreadID); !errors.Is(err, ErrReadOnlyThread) {
		t.Fatalf("StopThread err=%v, want %v", err, ErrReadOnlyThread)
	}

	view, err := svc.GetThread(ctx, meta, child.ThreadID)
	if !errors.Is(err, sql.ErrNoRows) || view != nil {
		t.Fatalf("GetThread child view=%#v err=%v, want hidden projection", view, err)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadMetadata(ctx, meta.EndpointID, child.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child: %v", err)
	}
	if !isExpectedFlowerSubagentProjection(childMeta, parent.ThreadID, child.ThreadID) {
		t.Fatalf("child thread metadata not projected: %#v", childMeta)
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
	if err := svc.threadsDB.UpsertProjectedThread(ctx, threadstore.Thread{
		EndpointID:      meta.EndpointID,
		ThreadID:        "child-detail",
		Title:           "Inspect tool flow",
		ModelID:         "openai/gpt-5-mini",
		PermissionType:  config.AIPermissionApprovalRequired,
		RunStatus:       string(RunStateRunning),
		CreatedAtUnixMs: now.Add(-time.Minute).UnixMilli(),
		UpdatedAtUnixMs: now.UnixMilli(),
	}); err != nil {
		t.Fatalf("UpsertProjectedThread child detail: %v", err)
	}
	if err := svc.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:     meta.EndpointID,
		ThreadID:       "child-detail",
		OwnerKind:      flowerSubagentProjectionOwnerKind,
		OwnerID:        flowerSubagentProjectionOwnerID,
		ParentThreadID: parent.ThreadID,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata child detail: %v", err)
	}
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
				},
				{
					ID:        "event-approval",
					Ordinal:   4,
					ThreadID:  flruntime.ThreadID("child-detail"),
					Kind:      flruntime.SubAgentDetailEventApproval,
					CreatedAt: now.Add(-20 * time.Second),
					Approval:  &flruntime.SubAgentDetailApproval{State: "denied", ToolName: "terminal.exec", ArgsHash: "hash-args", Reason: "readonly policy"},
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
	parent, err := svc.CreateThread(ctx, meta, "parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	otherParent, err := svc.CreateThread(ctx, meta, "other parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread other parent: %v", err)
	}
	child, err := svc.CreateThread(ctx, meta, "child", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread child: %v", err)
	}
	if err := svc.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:     meta.EndpointID,
		ThreadID:       child.ThreadID,
		OwnerKind:      flowerSubagentProjectionOwnerKind,
		OwnerID:        flowerSubagentProjectionOwnerID,
		ParentThreadID: parent.ThreadID,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata child: %v", err)
	}
	host := &recordingFloretHost{}
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
	if requests != 0 {
		t.Fatalf("detail host was called for wrong parent: %d", requests)
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
		threads: map[flruntime.ThreadID]flruntime.ThreadSnapshot{
			flruntime.ThreadID(childID): {
				ID:    flruntime.ThreadID(childID),
				Title: "review ui",
				Messages: []flruntime.ThreadMessage{{
					Role:      "assistant",
					Content:   "review complete",
					TurnID:    flruntime.TurnID("child-turn"),
					CreatedAt: now,
				}},
				CreatedAt: now.Add(-2 * time.Second),
				UpdatedAt: now,
			},
		},
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
