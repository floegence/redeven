package ai

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/websearch"
)

type recordingSubagentRuntime struct {
	releaseCount atomic.Int32
}

func (r *recordingSubagentRuntime) manage(context.Context, map[string]any) (map[string]any, error) {
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
	snapshots          []flruntime.SubAgentSnapshot
	threads            map[flruntime.ThreadID]flruntime.ThreadSnapshot
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

func (h *recordingFloretHost) SpawnSubAgent(context.Context, flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) SendSubAgentInput(context.Context, flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error) {
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *recordingFloretHost) WaitSubAgents(context.Context, flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error) {
	return flruntime.WaitSubAgentsResult{}, nil
}

func (h *recordingFloretHost) ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	h.listSubagentCount.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (h *recordingFloretHost) CloseSubAgent(context.Context, flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	h.closeSubagentCount.Add(1)
	return flruntime.SubAgentSnapshot{}, nil
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
	assertSubagentHostKeyChanges("approval policy", func() {
		cfg.ExecutionPolicy = &config.AIExecutionPolicy{RequireUserApproval: true}
	}, func() {
		cfg.ExecutionPolicy = nil
	})
	assertSubagentHostKeyChanges("dangerous command policy", func() {
		cfg.ExecutionPolicy = &config.AIExecutionPolicy{BlockDangerousCommands: true}
	}, func() {
		cfg.ExecutionPolicy = nil
	})
	assertSubagentHostKeyChanges("web search mode", func() {
		cfg.Providers[0].WebSearch.Mode = config.AIProviderWebSearchModeDisabled
	}, func() {
		cfg.Providers[0].WebSearch.Mode = config.AIProviderWebSearchModeBrave
	})
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
		{name: "set_mode", call: func() error { return svc.SetThreadExecutionMode(ctx, meta, child.ThreadID, "plan") }},
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
	if err != nil {
		t.Fatalf("GetThread child: %v", err)
	}
	if view == nil || strings.TrimSpace(view.ParentThreadID) != parent.ThreadID || strings.TrimSpace(view.OwnerKind) != flowerSubagentProjectionOwnerKind {
		t.Fatalf("child thread metadata view not projected: %#v", view)
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
