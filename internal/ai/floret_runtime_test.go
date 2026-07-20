package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func testFloretBootstrap(t *testing.T, store *flruntime.Store) *floretBootstrapResult {
	t.Helper()
	bootstrap, err := newFloretBootstrapResult(store)
	if err != nil {
		t.Fatalf("newFloretBootstrapResult: %v", err)
	}
	return bootstrap
}

func installTestFloretCapabilities(svc *Service, bootstrap *floretBootstrapResult) {
	if svc == nil || bootstrap == nil {
		return
	}
	svc.closeFloret = bootstrap.close
	svc.floretReads = &floretReadCapabilities{thread: bootstrap.newThreadRead, subagent: bootstrap.newSubagentRead}
	svc.floretRuntime = &floretRuntimeCapabilityIssuer{bind: bootstrap.bindThreadRuntime}
	svc.threadCreateFloret = &threadCreateFloretCoordinator{authority: bootstrap.threadCreate}
	svc.threadTitleFloret = &threadTitleFloretCoordinator{authority: bootstrap.threadTitle}
	svc.threadForkFloret = &threadForkFloretCoordinator{authority: bootstrap.threadFork}
	svc.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: bootstrap.threadDelete}
}

func createCanonicalFloretThreadForTest(t *testing.T, svc *Service, threadID string, createIntentID string) flruntime.ThreadSummary {
	t.Helper()
	if svc == nil || svc.threadCreateFloret == nil {
		t.Fatal("Floret test create authority is unavailable")
	}
	created, err := svc.threadCreateFloret.create(context.Background(), threadID, createIntentID)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	return created
}

func deleteCanonicalFloretThreadForTest(t *testing.T, svc *Service, threadID string) {
	t.Helper()
	if svc == nil || svc.threadDeleteFloret == nil {
		t.Fatal("Floret test delete authority is unavailable")
	}
	if err := svc.threadDeleteFloret.delete(context.Background(), threadID); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
}

type testFloretThreadDeleteAuthorityFunc func(context.Context, flruntime.ThreadID) error

func (f testFloretThreadDeleteAuthorityFunc) DeleteThread(ctx context.Context, threadID flruntime.ThreadID) error {
	return f(ctx, threadID)
}

type allowFloretEffectGateForTest struct{}

func (allowFloretEffectGateForTest) Dispatch(_ context.Context, req flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
	return effect(flruntime.EffectAuthorizationProof{
		EffectAttemptID: req.EffectAttemptID, RequestFingerprint: req.RequestFingerprint,
		ThreadID: req.ThreadID, TurnID: req.TurnID, RunID: req.RunID, ToolCallID: req.ToolCallID,
		LeaseOwnerID: req.LeaseOwnerID, LeaseGeneration: req.LeaseGeneration,
		PolicyRevision: "test-policy-v2", AuditReference: "test-audit:" + req.EffectAttemptID,
		AuditHash: floretEffectArgumentHash(req.RequestFingerprint), AuthorizedAt: time.Now(),
	})
}

func TestFloretRuntimeAdapterRejectsCrossAuthorityReads(t *testing.T) {
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	adapter := testFloretBootstrap(t, store)
	for _, threadID := range []string{"thread-a", "parent-a"} {
		create, err := adapter.newThreadCreate(flruntime.ThreadID(threadID), flruntime.CreateIntentID("create-"+threadID))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := create.CreateThread(context.Background(), flruntime.CreateThreadRequest{ThreadID: flruntime.ThreadID(threadID), CreateIntentID: flruntime.CreateIntentID("create-" + threadID)}); err != nil {
			t.Fatal(err)
		}
	}

	threadRuntime, err := adapter.bindThreadRuntime("thread-a")
	if err != nil {
		t.Fatal(err)
	}
	turnHost, err := threadRuntime.Turn(context.Background(), flruntime.TurnExecutionHostOptions{
		Config: flconfig.Config{Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "done"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := turnHost.ReadThreadAgentTodos(context.Background(), "thread-b"); err == nil || !strings.Contains(err.Error(), "authority mismatch") {
		t.Fatalf("cross-thread todo read error=%v, want authority mismatch", err)
	}

	parentRuntime, err := adapter.bindThreadRuntime("parent-a")
	if err != nil {
		t.Fatal(err)
	}
	subagentHost, err := parentRuntime.SubAgent(context.Background(), flruntime.SubAgentHostOptions{
		Config: flconfig.Config{Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "done"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := subagentHost.ListSubAgents(context.Background(), "parent-b"); err == nil || !strings.Contains(err.Error(), "bound to thread") {
		t.Fatalf("cross-parent read error=%v, want authority mismatch", err)
	}
}

func TestFloretTurnSettlementDoesNotFallbackAfterActiveAuthorityEnds(t *testing.T) {
	ctx := context.Background()
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	adapter := testFloretBootstrap(t, store)
	create, err := adapter.newThreadCreate("thread-settlement-owner", "create-thread-settlement-owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := create.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: "thread-settlement-owner", CreateIntentID: "create-thread-settlement-owner"}); err != nil {
		t.Fatal(err)
	}
	threadRuntime, err := adapter.bindThreadRuntime("thread-settlement-owner")
	if err != nil {
		t.Fatal(err)
	}
	host, err := threadRuntime.Turn(ctx, flruntime.TurnExecutionHostOptions{
		Config: flconfig.Config{Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "done"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: "thread-settlement-owner",
		TurnID:   "turn-settlement-owner",
		RunID:    "run-settlement-owner",
		Input:    flruntime.TurnInput{Text: "finish"},
	}); err != nil {
		t.Fatal(err)
	}
	_, err = host.SettlePendingTool(ctx, flruntime.PendingToolSettlementRequest{
		Target: flruntime.PendingToolSettlementTarget{
			ThreadID:   "thread-settlement-owner",
			TurnID:     "turn-settlement-owner",
			RunID:      "run-settlement-owner",
			ToolCallID: "tool-settlement-owner",
			ToolName:   "terminal.exec",
			Handle:     "process-settlement-owner",
		},
		Status:  flruntime.PendingToolSettlementCompleted,
		Summary: "done",
	})
	if !errors.Is(err, flruntime.ErrThreadNotActive) {
		t.Fatalf("settlement after active authority ended error=%v, want %v", err, flruntime.ErrThreadNotActive)
	}
}

type capturingTurnProvider struct {
	mu       sync.Mutex
	requests []ModelGatewayRequest
	result   ModelGatewayResult
}

type concurrentTerminalBatchProvider struct {
	mu    sync.Mutex
	calls int
	cwd   string
}

type terminalTerminationHostedProvider struct {
	mu         sync.Mutex
	calls      int
	manager    *terminalProcessManager
	endpointID string
	threadID   string
	runID      string
	processID  string
	toolCalls  []ToolCall
}

type failingTurnProvider struct{}

func isFloretThreadTitleRequest(req ModelGatewayRequest) bool {
	for _, message := range req.Messages {
		if message.Role != "system" {
			continue
		}
		for _, part := range message.Content {
			if strings.Contains(part.Text, "generate concise thread titles") {
				return true
			}
		}
	}
	return false
}

func newFloretRuntimeTestRun(t *testing.T, opts runOptions, providedStores ...*threadstore.Store) *run {
	t.Helper()
	var bootstrap *floretBootstrapResult
	if opts.FloretHostFactory == nil {
		store := flruntime.NewMemoryStore()
		t.Cleanup(func() { _ = store.Close() })
		var err error
		bootstrap, err = newFloretBootstrapResult(store)
		if err != nil {
			t.Fatalf("newFloretBootstrapResult: %v", err)
		}
	}
	if strings.TrimSpace(opts.EndpointID) == "" {
		opts.EndpointID = "env_floret_runtime_test"
	}
	if strings.TrimSpace(opts.ThreadID) == "" {
		opts.ThreadID = "thread_floret_runtime_test_" + strings.TrimSpace(opts.RunID)
	}
	if strings.TrimSpace(opts.RunID) == "" {
		opts.RunID = "run_floret_runtime_test_" + strings.TrimSpace(opts.ThreadID)
	}
	var productStore *threadstore.Store
	if len(providedStores) == 0 || providedStores[0] == nil {
		store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
		if err != nil {
			t.Fatalf("threadstore.Open: %v", err)
		}
		t.Cleanup(func() { _ = store.Close() })
		productStore = store
	} else {
		productStore = providedStores[0]
	}
	svc := &Service{
		threadsDB: productStore, persistOpTO: time.Second,
		terminalProcesses: newTerminalProcessManager(), flowerLiveByThread: make(map[string]*flowerLiveThreadStream),
		subagentRuntimes: make(map[string]*floretSubagentRuntime), delegatedApprovals: make(map[string]*delegatedApprovalHandle),
	}
	installTestFloretCapabilities(svc, bootstrap)
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	if bootstrap != nil {
		createCanonicalFloretThreadForTest(t, svc, opts.ThreadID, "test-create-"+opts.ThreadID)
	}
	if settings, err := productStore.GetThreadSettings(context.Background(), opts.EndpointID, opts.ThreadID); err != nil {
		t.Fatalf("GetThread: %v", err)
	} else if settings == nil {
		if err := productStore.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
			EndpointID: opts.EndpointID, ThreadID: opts.ThreadID, PermissionType: config.AIPermissionFullAccess,
		}); err != nil {
			t.Fatalf("CreateThread: %v", err)
		}
	}
	if opts.FloretHostFactory == nil {
		floretRuntime, err := svc.bindFloretThreadRuntime(opts.ThreadID)
		if err != nil {
			t.Fatalf("bind Floret runtime capability: %v", err)
		}
		opts.FloretHostFactory = floretRuntime.Turn
		if opts.FloretCompactionHostFactory == nil {
			opts.FloretCompactionHostFactory = floretRuntime.Compaction
		}
		if opts.FloretSubagentHostFactory == nil {
			opts.FloretSubagentHostFactory = floretRuntime.SubAgent
		}
	}
	if strings.TrimSpace(opts.HostCapabilities.authorityThreadID) == "" {
		opts.HostCapabilities = bindTestRunHostCapabilities(t, svc, opts.EndpointID, opts.ThreadID)
	}
	productCapabilities, err := bindRootRunProductCapabilities(productStore, opts.EndpointID, opts.ThreadID, opts.RunID)
	if err != nil {
		t.Fatalf("bindRootRunProductCapabilities: %v", err)
	}
	opts.ProductCapabilities = productCapabilities
	r := newRun(opts)
	runThreadStoresForTest.Store(r, productStore)
	t.Cleanup(func() { runThreadStoresForTest.Delete(r) })
	registerTestServiceForRun(t, r, svc)
	return r
}

var testRunServices sync.Map

func registerTestServiceForRun(t *testing.T, r *run, svc *Service) {
	t.Helper()
	if r == nil || svc == nil {
		t.Fatal("test run and service are required")
	}
	testRunServices.Store(r, svc)
	t.Cleanup(func() { testRunServices.Delete(r) })
}

func testServiceForRun(t *testing.T, r *run) *Service {
	t.Helper()
	if svc, ok := testRunServices.Load(r); ok {
		return svc.(*Service)
	}
	t.Fatal("test service is not registered for run")
	return nil
}

func bindTestRunHostCapabilities(t *testing.T, svc *Service, endpointID string, threadID string) runHostCapabilities {
	t.Helper()
	if svc == nil {
		t.Fatal("test service is required")
	}
	if svc.terminalProcesses == nil {
		svc.terminalProcesses = newTerminalProcessManager()
	}
	if svc.flowerLiveByThread == nil {
		svc.flowerLiveByThread = make(map[string]*flowerLiveThreadStream)
	}
	if svc.subagentRuntimes == nil {
		svc.subagentRuntimes = make(map[string]*floretSubagentRuntime)
	}
	if svc.delegatedApprovals == nil {
		svc.delegatedApprovals = make(map[string]*delegatedApprovalHandle)
	}
	if svc.threadMgr == nil {
		svc.threadMgr = newThreadManager(svc)
		t.Cleanup(svc.threadMgr.Close)
	}
	host, err := svc.bindRunHostCapabilities(endpointID, threadID)
	if err != nil {
		t.Fatalf("bind test run host capabilities: %v", err)
	}
	return host
}

func (failingTurnProvider) StreamTurn(context.Context, ModelGatewayRequest, func(StreamEvent)) (ModelGatewayResult, error) {
	return ModelGatewayResult{}, errors.New("primary engine failure")
}

func (p *concurrentTerminalBatchProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.calls++
	call := p.calls
	p.mu.Unlock()
	if call > 1 {
		toolResults := 0
		for _, message := range req.Messages {
			if message.Role == "tool" {
				toolResults++
			}
		}
		if toolResults < 2 {
			return ModelGatewayResult{}, fmt.Errorf("received %d tool results, want 2", toolResults)
		}
		return ModelGatewayResult{FinishReason: "stop", Text: "both commands overlapped"}, nil
	}
	command := func(own string, peer string) string {
		return fmt.Sprintf("touch %s; i=0; while [ ! -f %s ] && [ $i -lt 100 ]; do i=$((i+1)); sleep 0.02; done; test -f %s", own, peer, peer)
	}
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{
			{ID: "call_a", Name: "terminal.exec", Args: map[string]any{"command": command("a.started", "b.started"), "cwd": p.cwd, "yield_ms": 5000}},
			{ID: "call_b", Name: "terminal.exec", Args: map[string]any{"command": command("b.started", "a.started"), "cwd": p.cwd, "yield_ms": 5000}},
		},
	}, nil
}

func (p *terminalTerminationHostedProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	if isFloretThreadTitleRequest(req) {
		return ModelGatewayResult{FinishReason: "stop", Text: "Command termination"}, nil
	}
	p.mu.Lock()
	p.calls++
	call := p.calls
	p.mu.Unlock()

	switch call {
	case 1:
		toolCall := ToolCall{
			ID:   "tool_exec_pending",
			Name: "terminal.exec",
			Args: map[string]any{"command": "sleep 30", "yield_ms": 1},
		}
		p.recordToolCall(toolCall)
		return ModelGatewayResult{FinishReason: "tool_calls", ToolCalls: []ToolCall{toolCall}}, nil
	case 2:
		processes := p.manager.ProcessesForRun(p.endpointID, p.threadID, p.runID)
		if len(processes) != 1 {
			return ModelGatewayResult{}, fmt.Errorf("running terminal processes=%d, want 1", len(processes))
		}
		snapshot := processes[0].Snapshot()
		if snapshot.Status != terminalProcessStatusRunning || strings.TrimSpace(snapshot.ProcessID) == "" {
			return ModelGatewayResult{}, fmt.Errorf("pending terminal snapshot=%#v", snapshot)
		}
		p.mu.Lock()
		p.processID = snapshot.ProcessID
		p.mu.Unlock()
		toolCall := ToolCall{
			ID:   "tool_terminate_pending",
			Name: "terminal.terminate",
			Args: map[string]any{
				"process_id":  snapshot.ProcessID,
				"description": "Stop the sleeping test command",
			},
		}
		p.recordToolCall(toolCall)
		return ModelGatewayResult{FinishReason: "tool_calls", ToolCalls: []ToolCall{toolCall}}, nil
	case 3:
		messages, err := json.Marshal(req.Messages)
		if err != nil {
			return ModelGatewayResult{}, err
		}
		if strings.Contains(string(messages), "thread already has an active turn") {
			return ModelGatewayResult{}, errors.New("terminal termination exposed an active-turn settlement failure")
		}
		return ModelGatewayResult{FinishReason: "stop", Text: "The command was stopped."}, nil
	default:
		return ModelGatewayResult{}, fmt.Errorf("unexpected provider request %d", call)
	}
}

func (p *terminalTerminationHostedProvider) recordToolCall(call ToolCall) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.toolCalls = append(p.toolCalls, call)
}

func (p *terminalTerminationHostedProvider) snapshot() (int, string, []ToolCall) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls, p.processID, append([]ToolCall(nil), p.toolCalls...)
}

func TestRunFloretHostedTurnExecutesSameResponseTerminalCallsConcurrently(t *testing.T) {
	t.Parallel()
	workspace := t.TempDir()
	manager := newTerminalProcessManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	svc := &Service{terminalProcesses: manager}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		WorkingDir:       workspace,
		Shell:            "/bin/bash",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env_concurrent_terminal_batch", "thread_concurrent_terminal_batch"),
		AIConfig:         &config.AIConfig{},
		SessionMeta:      &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
		RunID:            "run_concurrent_terminal_batch",
		EndpointID:       "env_concurrent_terminal_batch",
		ThreadID:         "thread_concurrent_terminal_batch",
		MessageID:        "msg_concurrent_terminal_batch",
	})
	provider := &concurrentTerminalBatchProvider{cwd: workspace}
	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model:   "compat/gpt-5-mini",
		Input:   RunInput{Text: "run both independent checks"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "concurrency barrier", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	for _, name := range []string{"a.started", "b.started"} {
		if _, err := os.Stat(filepath.Join(workspace, name)); err != nil {
			t.Fatalf("missing barrier %s: %v", name, err)
		}
	}
}

func TestRunFloretHostedTurnTerminatesPendingCommandWithoutCompensation(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	t.Cleanup(func() { _ = store.Close() })
	floretStore := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = floretStore.Close() })
	const endpointID = "env_terminal_termination"
	const threadID = "thread_terminal_termination"
	const runID = "run_terminal_termination"
	const turnID = "turn_terminal_termination"
	upsertTerminalProcessTestRun(t, store, endpointID, threadID, runID, turnID)
	if err := store.UpdateThreadPermissionType(context.Background(), endpointID, threadID, config.AIPermissionFullAccess); err != nil {
		t.Fatalf("UpdateThreadPermissionType: %v", err)
	}

	manager := newTerminalProcessManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	svc := &Service{
		stateDir:          t.TempDir(),
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
		runs:              map[string]*run{},
		activeRunByTh:     map[string]string{runThreadKey(endpointID, threadID): runID},
	}
	installTestFloretCapabilities(svc, testFloretBootstrap(t, floretStore))
	createCanonicalFloretThreadForTest(t, svc, threadID, "test-create-"+threadID)
	threadRuntime, err := svc.bindFloretThreadRuntime(threadID)
	if err != nil {
		t.Fatal(err)
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir:          svc.stateDir,
		AgentHomeDir:      workspace,
		WorkingDir:        workspace,
		Shell:             "/bin/bash",
		HostCapabilities:  bindTestRunHostCapabilities(t, svc, endpointID, threadID),
		AIConfig:          &config.AIConfig{},
		FloretHostFactory: threadRuntime.Turn,
		PersistOpTimeout:  5 * time.Second,
		RunID:             runID,
		EndpointID:        endpointID,
		ThreadID:          threadID,
		MessageID:         turnID,
		SessionMeta: &session.Meta{
			EndpointID: endpointID,
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
	}, store)
	svc.runs[runID] = r
	provider := &terminalTerminationHostedProvider{
		manager:    manager,
		endpointID: endpointID,
		threadID:   threadID,
		runID:      runID,
	}

	err = r.runFloretHostedTurn(t.Context(), RunRequest{
		Model:   "compat/gpt-5-mini",
		Input:   RunInput{Text: "start a command and stop it"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "stop a pending command", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}

	requestCount, processID, toolCalls := provider.snapshot()
	if requestCount != 3 {
		t.Fatalf("provider requests=%d, want 3", requestCount)
	}
	if len(toolCalls) != 2 || toolCalls[0].Name != "terminal.exec" || toolCalls[1].Name != "terminal.terminate" {
		t.Fatalf("provider tool calls=%#v, want terminal.exec then terminal.terminate", toolCalls)
	}
	for _, call := range toolCalls {
		command := strings.TrimSpace(anyToString(call.Args["command"]))
		if call.Name == "pkill" || call.Name == "kill" || strings.HasPrefix(command, "pkill ") || strings.HasPrefix(command, "kill ") {
			t.Fatalf("provider emitted compensation tool call: %#v", call)
		}
	}

	var execItem observation.ActivityItem
	var terminateItem observation.ActivityItem
	for _, block := range r.assistantBlocks {
		if candidate, ok := block.(ActivityTimelineBlock); ok {
			for _, item := range candidate.Items {
				switch item.ToolID {
				case "tool_exec_pending":
					execItem = item
				case "tool_terminate_pending":
					terminateItem = item
				}
			}
		}
	}
	if execItem.ToolID == "" || terminateItem.ToolID == "" {
		t.Fatalf("assistant blocks missing terminal activity items: %#v", r.assistantBlocks)
	}
	if execItem.Status != observation.ActivityStatusCanceled || terminateItem.Status != observation.ActivityStatusSuccess {
		readHost, readErr := svc.openFloretThreadReadHost(context.Background(), threadID)
		var canonical flruntime.ThreadTurnProjection
		if readErr == nil {
			canonical, readErr = readHost.ReadTurnProjection(context.Background(), flruntime.ReadTurnProjectionRequest{
				ThreadID: flruntime.ThreadID(threadID), TurnID: flruntime.TurnID(turnID), RunID: flruntime.RunID(runID),
			})
		}
		canonicalItems := make([]string, 0)
		for _, segment := range canonical.Segments {
			if segment.ActivityTimeline == nil {
				continue
			}
			for _, item := range segment.ActivityTimeline.Items {
				canonicalItems = append(canonicalItems, item.ToolID+":"+string(item.Status))
			}
		}
		t.Fatalf("terminal activity mismatch: exec=%#v terminate=%#v canonical_items=%v read_error=%v", execItem, terminateItem, canonicalItems, readErr)
	}
	if terminateItem.Status != observation.ActivityStatusSuccess || terminateItem.Label != "Stop the sleeping test command" {
		t.Fatalf("terminal.terminate item=%#v, want successful descriptive result", terminateItem)
	}
	if terminateItem.Payload["process_id"] != processID || strings.TrimSpace(processID) == "" {
		t.Fatalf("terminal.terminate payload=%#v process_id=%q", terminateItem.Payload, processID)
	}
}

func TestRunFloretHostedTurnPreservesEngineErrorAsPrimaryFailure(t *testing.T) {
	t.Parallel()

	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		WorkingDir:   t.TempDir(),
		Shell:        "/bin/bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
		RunID:        "run_primary_engine_error",
		EndpointID:   "env_primary_engine_error",
		ThreadID:     "thread_primary_engine_error",
		MessageID:    "msg_primary_engine_error",
	})
	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model:   "compat/gpt-5-mini",
		Input:   RunInput{Text: "fail this turn"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "error priority", failingTurnProvider{})
	if err == nil || !strings.Contains(err.Error(), "primary engine failure") {
		t.Fatalf("runFloretHostedTurn error=%v, want primary engine failure", err)
	}
	if r.getRunErrorCode() != runErrorCodeFloretEngineFailed {
		t.Fatalf("run error code = %q, want %q", r.getRunErrorCode(), runErrorCodeFloretEngineFailed)
	}
}

func (p *capturingTurnProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	result := p.result
	p.mu.Unlock()
	if strings.TrimSpace(result.FinishReason) == "" {
		result.FinishReason = "stop"
	}
	if result.Text == "" {
		result.Text = "done"
	}
	return result, nil
}

func (p *capturingTurnProvider) firstRequest() ModelGatewayRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.requests) == 0 {
		return ModelGatewayRequest{}
	}
	return p.requests[0]
}

func (p *capturingTurnProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

type streamedEmptyTaskCompleteProvider struct{}

func (streamedEmptyTaskCompleteProvider) StreamTurn(_ context.Context, _ ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "OK, continuing works."})
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID:   "call_task_complete_empty",
			Name: "task_complete",
			Args: map[string]any{},
		}},
	}, nil
}

type permissionDowngradeToolCallProvider struct {
	store      *threadstore.Store
	endpointID string
	threadID   string
	mu         sync.Mutex
	calls      int
	requests   []ModelGatewayRequest
}

type permissionCorruptingToolCallProvider struct {
	store      *threadstore.Store
	endpointID string
	threadID   string
	command    string
	mu         sync.Mutex
	calls      int
}

func (p *permissionCorruptingToolCallProvider) StreamTurn(ctx context.Context, _ ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.calls++
	callIndex := p.calls
	p.mu.Unlock()
	if callIndex > 1 {
		return ModelGatewayResult{FinishReason: "stop", Text: "unexpected second request"}, nil
	}
	if err := p.store.UpdateThreadPermissionType(ctx, p.endpointID, p.threadID, "invalid_permission"); err != nil {
		return ModelGatewayResult{}, err
	}
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID: "call_terminal_invalid_refresh", Name: "terminal.exec",
			Args: map[string]any{"command": p.command},
		}},
	}, nil
}

func (p *permissionCorruptingToolCallProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p *permissionDowngradeToolCallProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.calls++
	callIndex := p.calls
	p.requests = append(p.requests, req)
	p.mu.Unlock()
	if callIndex > 1 {
		return ModelGatewayResult{FinishReason: "stop", Text: "stale tool was rejected"}, nil
	}
	if err := p.store.UpdateThreadPermissionType(ctx, p.endpointID, p.threadID, config.AIPermissionReadonly); err != nil {
		return ModelGatewayResult{}, err
	}
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID:   "call_terminal_after_downgrade",
			Name: "terminal.exec",
			Args: map[string]any{"command": "echo stale", "cwd": "/tmp"},
		}},
	}, nil
}

func (p *permissionDowngradeToolCallProvider) request(index int) ModelGatewayRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if index < 0 || index >= len(p.requests) {
		return ModelGatewayRequest{}
	}
	return p.requests[index]
}

type naturalCompactionProvider struct {
	mu       sync.Mutex
	requests []ModelGatewayRequest
}

func (p *naturalCompactionProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if isFloretThreadTitleRequest(req) {
		return ModelGatewayResult{FinishReason: "stop", Text: "Context compaction"}, nil
	}
	p.mu.Lock()
	p.requests = append(p.requests, req)
	callIndex := len(p.requests)
	p.mu.Unlock()

	if callIndex == 1 {
		return ModelGatewayResult{FinishReason: "stop", Text: strings.Repeat("older assistant context ", 20000)}, nil
	}
	if callIndex == 2 {
		return ModelGatewayResult{FinishReason: "stop", Text: "Older context checkpoint summary."}, nil
	}
	onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "continued after natural compact"})
	return ModelGatewayResult{FinishReason: "stop"}, nil
}

func (p *naturalCompactionProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

func (p *naturalCompactionProvider) requestSnapshot() []ModelGatewayRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]ModelGatewayRequest(nil), p.requests...)
}

func (p *naturalCompactionProvider) requestDescriptions() []string {
	requests := p.requestSnapshot()
	out := make([]string, 0, len(requests))
	for index, request := range requests {
		roles := make([]string, 0, len(request.Messages))
		previews := make([]string, 0, len(request.Messages))
		for _, message := range request.Messages {
			roles = append(roles, message.Role)
			for _, part := range message.Content {
				if strings.TrimSpace(part.Text) != "" {
					previews = append(previews, truncateRunes(strings.TrimSpace(part.Text), 80))
					break
				}
			}
		}
		out = append(out, fmt.Sprintf("%d roles=%v text=%q", index+1, roles, previews))
	}
	return out
}

func TestRunFloretHostedTurnCompletesEmptyTaskCompleteFromStreamedText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_empty_task_complete_streamed",
		ThreadID:  "thread_floret_empty_task_complete_streamed",
		MessageID: "msg_floret_empty_task_complete_streamed",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "finish with streamed text and task_complete"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "finish", streamedEmptyTaskCompleteProvider{})
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if got := r.getFinalizationReason(); got != "task_complete" {
		t.Fatalf("finalizationReason=%q, want task_complete", got)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "OK, continuing works." {
		t.Fatalf("assistantText=%q, want streamed final answer", assistantText)
	}
	if !hasFloretMarkdownContent(events, "OK, continuing works.") {
		t.Fatalf("events missing streamed markdown content: %#v", events)
	}
}

func TestRunFloretHostedTurnEmitsContextUsageFromPublishedHost(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	provider := &capturingTurnProvider{}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_context_usage_projection",
		ThreadID:  "thread_floret_context_usage_projection",
		MessageID: "msg_floret_context_usage_projection",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "verify the published Floret host emits context status"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 128000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "verify context usage", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if got := provider.requestCount(); got != 2 {
		t.Fatalf("provider request count=%d, want one hosted turn request and one Floret provider title request", got)
	}

	usages := contextUsagesFromStreamEvents(events)
	if len(usages) == 0 {
		t.Fatalf("events missing context usage: %#v", events)
	}
	first := usages[0]
	if first.RunID != r.id ||
		first.Phase != string(observation.ContextPhaseProjectedRequest) ||
		first.InputTokens <= 0 ||
		first.ContextWindowTokens <= 0 ||
		strings.TrimSpace(first.PressureStatus) == "" {
		t.Fatalf("context usage=%#v", first)
	}
}

func TestRunFloretHostedTurnKeepsInputAndOutputBudgetsIndependent(t *testing.T) {
	for _, tc := range []struct {
		name          string
		maxInput      int
		maxOutput     int
		usage         TurnUsage
		wantErr       string
		wantReqOutput int
	}{
		{name: "input only", maxInput: 10, usage: TurnUsage{InputTokens: 11, OutputTokens: 100}, wantErr: "input token budget exceeded"},
		{name: "output only", maxOutput: 25, usage: TurnUsage{InputTokens: 100, OutputTokens: 100}, wantReqOutput: 25},
		{name: "both", maxInput: 10, maxOutput: 25, usage: TurnUsage{InputTokens: 10, OutputTokens: 100}, wantReqOutput: 25},
		{name: "neither", usage: TurnUsage{InputTokens: 100, OutputTokens: 100}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := &capturingTurnProvider{result: ModelGatewayResult{FinishReason: "stop", Text: "done", Usage: tc.usage}}
			r := newFloretRuntimeTestRun(t, runOptions{
				Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
				StateDir:     t.TempDir(),
				AgentHomeDir: t.TempDir(),
				Shell:        "bash",
				AIConfig:     &config.AIConfig{},
				SessionMeta: &session.Meta{
					CanRead:    true,
					CanWrite:   true,
					CanExecute: true,
					CanAdmin:   true,
				},
				RunID:     "run_budget_" + strings.ReplaceAll(tc.name, " ", "_"),
				ThreadID:  "thread_budget_" + strings.ReplaceAll(tc.name, " ", "_"),
				MessageID: "msg_budget_" + strings.ReplaceAll(tc.name, " ", "_"),
			})
			err := r.runFloretHostedTurn(t.Context(), RunRequest{
				Model: "compat/gpt-5-mini",
				Input: RunInput{Text: "check independent budgets"},
				Options: RunOptions{
					PermissionType:  config.AIPermissionApprovalRequired,
					MaxInputTokens:  tc.maxInput,
					MaxOutputTokens: tc.maxOutput,
				},
				ModelCapability: contextmodel.ModelCapability{MaxContextTokens: 128000},
			}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "budgets", provider)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err=%v, want %q", err, tc.wantErr)
				}
			} else if err != nil {
				t.Fatalf("runFloretHostedTurn: %v", err)
			}
			req := provider.firstRequest()
			if req.Budgets.MaxOutputToken != tc.wantReqOutput {
				t.Fatalf("provider budgets=%#v, want output=%d", req.Budgets, tc.wantReqOutput)
			}
		})
	}
}

func TestRunFloretHostedTurnInjectsAskFlowerLinkedContext(t *testing.T) {
	t.Parallel()

	provider := &capturingTurnProvider{}
	uploadsDir := t.TempDir()
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		UploadsDir:   uploadsDir,
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_linked_context",
		ThreadID:  "thread_floret_linked_context",
		MessageID: "msg_floret_linked_context",
	})
	const uploadID = "upl_notes"
	const uploadBody = "linked notes"
	if err := os.WriteFile(filepath.Join(uploadsDir, uploadID+".data"), []byte(uploadBody), 0o600); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
	store := runThreadStoreForTest(t, r)
	if err := store.InsertUpload(context.Background(), threadstore.UploadRecord{
		UploadID:        uploadID,
		EndpointID:      r.endpointID,
		StorageRelPath:  uploadID + ".data",
		Name:            "notes.txt",
		MimeType:        "text/plain",
		SizeBytes:       int64(len(uploadBody)),
		State:           threadstore.UploadStateStaged,
		CreatedAtUnixMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	const commandID = "qt_floret_linked_context"
	if _, _, _, err := store.CreateFollowupWithUploadRefs(context.Background(), threadstore.QueuedTurn{
		QueueID:         commandID,
		EndpointID:      r.endpointID,
		ThreadID:        r.threadID,
		ChannelID:       "channel_floret_linked_context",
		Lane:            threadstore.FollowupLaneQueued,
		TurnID:          r.messageID,
		RunID:           r.id,
		TextContent:     "what is this process",
		AttachmentsJSON: `[{"name":"notes.txt","mime_type":"text/plain","url":"/_redeven_proxy/api/ai/uploads/upl_notes"}]`,
		CreatedAtUnixMs: time.Now().UnixMilli(),
	}, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("CreateFollowupWithUploadRefs: %v", err)
	}
	r.setPendingTurnCommand(commandID)

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{
			Text: "what is this process",
			Attachments: []RunAttachmentIn{{
				Name:     "notes.txt",
				MimeType: "text/plain",
				URL:      "/_redeven_proxy/api/ai/uploads/upl_notes",
			}},
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: "monitoring"},
				Context: []ContextActionContextItem{{
					Kind:         "process_snapshot",
					PID:          12264,
					Name:         "Codex (Service)",
					Username:     "tangjianyin",
					CPUPercent:   0.12,
					MemoryBytes:  575668224,
					Platform:     "darwin",
					CapturedAtMs: 1783677600000,
				}},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens:  128000,
			SupportsFileInput: true,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai",
		BaseURL: "https://api.openai.com/v1",
	}, "sk-test", "verify linked context", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	request := provider.firstRequest()
	requestText := modelGatewayRequestText(request)
	for _, want := range []string{"what is this process", "Host-provided supplemental context", "process_snapshot", "pid: 12264", "Codex (Service)"} {
		if !strings.Contains(requestText, want) {
			t.Fatalf("provider request missing %q:\n%s", want, requestText)
		}
	}
	foundFile := false
	for _, message := range request.Messages {
		for _, part := range message.Content {
			if part.Type == "file" && part.Text == "notes.txt" && part.MimeType == "text/plain" && strings.HasPrefix(part.FileURI, "data:text/plain;base64,") {
				foundFile = true
			}
		}
	}
	if !foundFile {
		t.Fatalf("provider request missing resolved file content part: %#v", request.Messages)
	}
	if strings.Contains(requestText, "attachment_metadata") || strings.Contains(requestText, "Attachment: notes.txt") {
		t.Fatalf("provider request retained attachment metadata fallback:\n%s", requestText)
	}
	if strings.Contains(requestText, "/_redeven_proxy/api/ai/uploads/") {
		t.Fatalf("provider request leaked upload URL:\n%s", requestText)
	}
}

func TestRunFloretHostedTurnRefreshesPermissionBeforeDispatch(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	const endpointID = "env_floret_dynamic_permission"
	const threadID = "thread_floret_dynamic_permission"
	const runID = "run_floret_dynamic_permission"
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		EndpointID:              endpointID,
		ThreadID:                threadID,
		PermissionType:          config.AIPermissionApprovalRequired,
		SettingsCreatedAtUnixMs: 1,
		SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			EndpointID: endpointID,
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     runID,
		ThreadID:  threadID,
		MessageID: "msg_floret_dynamic_permission",
	})
	r.endpointID = endpointID
	setRunThreadStoreForTest(t, r, store)

	provider := &permissionDowngradeToolCallProvider{
		store:      store,
		endpointID: endpointID,
		threadID:   threadID,
	}
	err = r.runFloretHostedTurn(ctx, RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "run stale terminal call"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "run stale terminal call", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}

	secondRequest := provider.request(1)
	var sawRejectedToolResult bool
	for _, message := range secondRequest.Messages {
		if message.Role != "tool" {
			continue
		}
		for _, part := range message.Content {
			if part.ToolCallID != "call_terminal_after_downgrade" {
				continue
			}
			if strings.Contains(part.Text, "unknown tool") || strings.Contains(part.Text, "permission") {
				sawRejectedToolResult = true
			}
		}
	}
	if !sawRejectedToolResult {
		t.Fatalf("second provider request missing rejected stale tool result: %#v", secondRequest.Messages)
	}
}

func TestRunFloretHostedTurnStopsBeforeToolHandlerWhenPermissionRefreshIsInvalid(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	workspace := t.TempDir()
	const endpointID = "env_invalid_permission_refresh"
	const threadID = "thread_invalid_permission_refresh"
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		EndpointID: endpointID, ThreadID: threadID, PermissionType: config.AIPermissionFullAccess,
		WorkingDir: workspace, SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		StateDir: t.TempDir(), AgentHomeDir: workspace, WorkingDir: workspace, Shell: "/bin/bash",
		AIConfig: &config.AIConfig{}, RunID: "run_invalid_permission_refresh",
		EndpointID: endpointID, ThreadID: threadID, MessageID: "turn_invalid_permission_refresh",
		SessionMeta: &session.Meta{EndpointID: endpointID, CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
	}, store)
	marker := filepath.Join(workspace, "handler_called")
	provider := &permissionCorruptingToolCallProvider{
		store: store, endpointID: endpointID, threadID: threadID,
		command: "touch " + marker,
	}
	err = r.runFloretHostedTurn(ctx, RunRequest{
		Model: "compat/gpt-5-mini", Input: RunInput{Text: "must fail before dispatch"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "must fail", provider)
	if err == nil || !strings.Contains(err.Error(), "invalid thread permission type") {
		t.Fatalf("runFloretHostedTurn error=%v, want invalid permission refresh", err)
	}
	if provider.requestCount() != 1 {
		t.Fatalf("provider requests=%d, want 1 before refresh failure", provider.requestCount())
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatalf("tool handler created marker, stat error=%v", statErr)
	}
}

func TestRunFloretHostedTurnStopsBeforeProviderWhenPermissionStoreQueryFails(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: "env_permission_query_fail", ThreadID: "thread_permission_query_fail",
		PermissionType: config.AIPermissionFullAccess, WorkingDir: t.TempDir(),
	}); err != nil {
		t.Fatal(err)
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), WorkingDir: t.TempDir(), Shell: "/bin/bash",
		AIConfig: &config.AIConfig{}, RunID: "run_permission_query_fail",
		EndpointID: "env_permission_query_fail", ThreadID: "thread_permission_query_fail", MessageID: "turn_permission_query_fail",
		SessionMeta: &session.Meta{EndpointID: "env_permission_query_fail", CanRead: true, CanWrite: true, CanExecute: true},
	}, store)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	provider := &capturingTurnProvider{}
	err = r.runFloretHostedTurn(context.Background(), RunRequest{
		Model: "compat/gpt-5-mini", Input: RunInput{Text: "must fail before provider"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "must fail", provider)
	if err == nil || !strings.Contains(err.Error(), "read current thread permission") {
		t.Fatalf("runFloretHostedTurn error=%v, want permission query failure", err)
	}
	if provider.requestCount() != 0 {
		t.Fatalf("provider requests=%d, want 0", provider.requestCount())
	}
}

func TestRunFloretHostedTurnStopsBeforeProviderWhenPermissionSnapshotPersistenceFails(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	workspace := t.TempDir()
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: "env_snapshot_persist_fail", ThreadID: "thread_snapshot_persist_fail",
		PermissionType: config.AIPermissionFullAccess, WorkingDir: workspace,
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`DROP TABLE ai_permission_snapshots`); err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		StateDir: t.TempDir(), AgentHomeDir: workspace, WorkingDir: workspace, Shell: "/bin/bash",
		AIConfig: &config.AIConfig{}, RunID: "run_snapshot_persist_fail",
		EndpointID: "env_snapshot_persist_fail", ThreadID: "thread_snapshot_persist_fail", MessageID: "turn_snapshot_persist_fail",
		SessionMeta: &session.Meta{EndpointID: "env_snapshot_persist_fail", CanRead: true, CanWrite: true, CanExecute: true},
	}, store)
	provider := &capturingTurnProvider{}
	err = r.runFloretHostedTurn(context.Background(), RunRequest{
		Model: "compat/gpt-5-mini", Input: RunInput{Text: "must fail before provider"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "must fail", provider)
	if err == nil || !strings.Contains(err.Error(), "persist permission snapshot") {
		t.Fatalf("runFloretHostedTurn error=%v, want snapshot persistence failure", err)
	}
	if provider.requestCount() != 0 {
		t.Fatalf("provider requests=%d, want 0", provider.requestCount())
	}
}

func TestRunFloretHostedTurnNaturalCompactionContinuesStreaming(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 16)
	provider := &naturalCompactionProvider{}
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	adapter := testFloretBootstrap(t, store)
	createHost, err := adapter.newThreadCreate("thread_floret_natural_compact_streaming", "test-create-thread_floret_natural_compact_streaming")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := createHost.CreateThread(context.Background(), flruntime.CreateThreadRequest{ThreadID: "thread_floret_natural_compact_streaming", CreateIntentID: "test-create-thread_floret_natural_compact_streaming"}); err != nil {
		t.Fatal(err)
	}
	threadRuntime, err := adapter.bindThreadRuntime("thread_floret_natural_compact_streaming")
	if err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateDir,
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:             "run_floret_natural_compact_streaming",
		ThreadID:          "thread_floret_natural_compact_streaming",
		MessageID:         "msg_floret_natural_compact_streaming",
		FloretHostFactory: threadRuntime.Turn,
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err = r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "seed old context"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 50000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "seed", provider)
	if err != nil {
		t.Fatalf("seed runFloretHostedTurn: %v", err)
	}

	events = events[:0]
	r = newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateDir,
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:             "run_floret_natural_compact_streaming_next",
		ThreadID:          "thread_floret_natural_compact_streaming",
		MessageID:         "msg_floret_natural_compact_streaming_next",
		FloretHostFactory: threadRuntime.Turn,
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err = r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "continue after compacting"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxInputTokens:  48000,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 50000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "continue", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if provider.requestCount() != 3 {
		t.Fatalf("provider request count=%d, want seed, compaction summary, and post-compaction requests: %v", provider.requestCount(), provider.requestDescriptions())
	}
	if got := r.getFinalizationReason(); got != "natural_stop" {
		t.Fatalf("finalizationReason=%q, want natural_stop", got)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "continued after natural compact" {
		t.Fatalf("assistantText=%q, want post-compaction streamed output; requests=%v", assistantText, provider.requestDescriptions())
	}
	if !hasFloretMarkdownContent(events, "continued after natural compact") {
		t.Fatalf("events missing post-compaction markdown content: %#v", events)
	}
	if got := compactStatusesFromStreamEvents(events); len(got) < 2 || got[0] != "compacting" || got[len(got)-1] != "compacted" {
		t.Fatalf("compaction statuses=%#v, want compacting -> compacted", got)
	}
}

func TestRunFloretHostedTurnManualCompactionNoopContinuesStreaming(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 16)
	provider := &capturingTurnProvider{}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_manual_noop_streaming",
		ThreadID:  "thread_floret_manual_noop_streaming",
		MessageID: "msg_floret_manual_noop_streaming",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.pendingManualCompaction = &flruntime.ManualCompactionRequest{
		RequestID:   "manual-noop-request",
		Source:      "slash_command",
		RequestedAt: time.UnixMilli(1_000),
	}
	r.contextCompactionAnchors = map[string]FlowerTimelineAnchor{
		"manual-noop-request": {
			TargetKind: "message",
			MessageID:  "msg_floret_manual_noop_streaming",
			Edge:       "after",
		},
	}

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "short turn with manual compact"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 256000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "manual noop", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if got := compactStatusesFromStreamEvents(events); len(got) == 0 || got[len(got)-1] != "noop" {
		t.Fatalf("compaction statuses=%#v, want terminal noop", got)
	}
	if r.activeManualCompactionID != "" {
		t.Fatalf("activeManualCompactionID=%q, want cleared after noop", r.activeManualCompactionID)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "done" {
		t.Fatalf("assistantText=%q, want provider response after noop", assistantText)
	}
}

func hasFloretMarkdownContent(events []any, content string) bool {
	for _, ev := range events {
		if blockDelta, ok := ev.(streamEventBlockDelta); ok && blockDelta.Delta == content {
			return true
		}
		if blockSet, ok := ev.(streamEventBlockSet); ok {
			if block, ok := blockSet.Block.(persistedMarkdownBlock); ok && block.Content == content {
				return true
			}
			if block, ok := blockSet.Block.(persistedTextBlock); ok && block.Content == content {
				return true
			}
		}
	}
	return false
}

func modelGatewayRequestText(req ModelGatewayRequest) string {
	var b strings.Builder
	for _, msg := range req.Messages {
		for _, part := range msg.Content {
			if text := strings.TrimSpace(part.Text); text != "" {
				if b.Len() > 0 {
					b.WriteString("\n\n")
				}
				b.WriteString(text)
			}
		}
	}
	return b.String()
}

func compactStatusesFromStreamEvents(events []any) []string {
	out := make([]string, 0, 2)
	for _, ev := range events {
		if compaction, ok := ev.(streamEventContextCompaction); ok {
			out = append(out, strings.TrimSpace(compaction.Compaction.Status))
		}
	}
	return out
}

func contextUsagesFromStreamEvents(events []any) []FlowerContextUsage {
	out := make([]FlowerContextUsage, 0, 2)
	for _, ev := range events {
		if usage, ok := ev.(streamEventContextUsage); ok {
			out = append(out, usage.Usage)
		}
	}
	return out
}

func TestRunFloretHostedTurnProjectsWebSearchToolThroughFloretGateway(t *testing.T) {
	t.Parallel()

	provider := &capturingTurnProvider{}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_web_search_tool",
		ThreadID:  "thread_floret_web_search_tool",
		MessageID: "msg_floret_web_search_tool",
	})
	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "search the web"},
		Options: RunOptions{
			PermissionType: config.AIPermissionReadonly,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
		WebSearch: &config.AIProviderWebSearch{
			Mode: config.AIProviderWebSearchModeBrave,
		},
	}, "sk-test", "search the web", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	req := provider.firstRequest()
	if !containsString(toolDefNames(req.Tools), "web.search") {
		t.Fatalf("provider tools=%v, want web.search", toolDefNames(req.Tools))
	}
	if req.WebSearchMode != providerWebSearchModeExternalBrave {
		t.Fatalf("WebSearchMode=%q, want %q", req.WebSearchMode, providerWebSearchModeExternalBrave)
	}
}

func toolDefNames(defs []ToolDef) []string {
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		if name := strings.TrimSpace(def.Name); name != "" {
			out = append(out, name)
		}
	}
	return out
}

func TestFloretEventSinkDoesNotProjectSanitizedProviderText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID:                 "msg_floret_event",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_delta", Message: "text"})
	sink.EmitEvent(flruntime.Event{Type: "provider_reasoning", Message: "thinking"})

	if len(r.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("provider event sink wrote assistant output: blocks=%#v events=%#v", r.assistantBlocks, events)
	}
}

func TestFloretEventSinkProjectsStreamObservationDeltas(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := &run{
		messageID:                 "msg_floret_stream",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderReasoning, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationReasoningDelta, Text: "thinking"}})
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderDelta, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "answer"}})

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want thinking and markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	thinking, ok := r.assistantBlocks[0].(*persistedThinkingBlock)
	if !ok || thinking.Content != "thinking" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want thinking", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	markdown, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || markdown.Content != "answer" {
		t.Fatalf("assistantBlocks[1]=%T %+v, want answer", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	if len(events) != 5 {
		t.Fatalf("stream events=%d, want model io plus block start/delta pairs: %#v", len(events), events)
	}
	if _, ok := events[0].(streamEventModelIOStatus); !ok {
		t.Fatalf("events[0]=%T, want model io status", events[0])
	}
}

func TestFloretEventSinkRejectsUnknownContractsBeforePresentation(t *testing.T) {
	t.Parallel()

	_, r, _, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{})
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		Type:   observation.EventType("unknown_event"),
		Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "must not render"},
	})
	sink.EmitEvent(flruntime.Event{
		Type: observation.EventTypeProviderUsage,
		ContextStatus: &observation.ContextStatus{
			Phase:  observation.ContextPhase("unknown_phase"),
			Status: observation.ContextStatusStable,
		},
	})
	sink.EmitEvent(flruntime.Event{
		Type:   observation.EventTypeProviderDelta,
		Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationType("unknown_stream"), Text: "must not render"},
	})
	sink.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeProviderDelta,
		ThreadID: flruntime.ThreadID(r.threadID),
		TurnID:   flruntime.TurnID(r.messageID),
		RunID:    flruntime.RunID(r.id),
		Stream:   &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "must not render"},
		Projection: &flruntime.ThreadTurnProjection{
			ThreadID:       flruntime.ThreadID(r.threadID),
			TurnID:         flruntime.TurnID(r.messageID),
			RunID:          flruntime.RunID(r.id),
			Status:         flruntime.TurnStatusCompleted,
			ThroughOrdinal: 1,
			Segments:       []flruntime.ThreadTurnProjectionSegment{{Kind: "unknown"}},
		},
	})
	if len(*events) != 0 || len(r.assistantBlocks) != 0 {
		t.Fatalf("rejected contracts changed presentation: events=%#v blocks=%#v", *events, r.assistantBlocks)
	}
}

func TestFloretEventSinkProjectsToolCallStreamObservationToModelIO(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		messageID:                 "msg_floret_tool_stream",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderToolCallDelta, Stream: &flruntime.StreamObservation{
		Type: flruntime.StreamObservationToolCallDelta,
		ToolCallStream: &flruntime.ModelToolCallStream{
			ID:   "call-1",
			Name: "read_file",
		},
		Attempt: 2,
	}})

	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no message block for tool call stream observation", r.assistantBlocks)
	}
	if len(events) != 1 {
		t.Fatalf("events=%#v, want one model io status event", events)
	}
	modelIO, ok := events[0].(streamEventModelIOStatus)
	if !ok {
		t.Fatalf("event=%T, want streamEventModelIOStatus", events[0])
	}
	if modelIO.Phase != string(FlowerModelIOPhaseStreaming) || modelIO.StepIndex != 2 {
		t.Fatalf("modelIO=%#v, want streaming step 2", modelIO)
	}
}

func TestFloretEventSinkProjectsContextObservations(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		id:            "run_context_projection",
		threadID:      "thread_context_projection",
		messageID:     "msg_context_projection",
		onStreamEvent: func(ev any) { events = append(events, ev) },
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeProviderUsage,
		RunID:    "run_context_projection",
		ThreadID: "thread_context_projection",
		TurnID:   "msg_context_projection",
		Step:     1,
		ContextStatus: &observation.ContextStatus{
			RunID:    "run_context_projection",
			ThreadID: "thread_context_projection",
			TurnID:   "msg_context_projection",
			Step:     1,
			Phase:    observation.ContextPhaseProjectedRequest,
			ContextPressure: flconfig.ContextPressure{
				ProjectedInputTokens: 600,
				ContextWindowTokens:  1000,
				ThresholdTokens:      900,
				RequestSafeLimit:     800,
				OutputHeadroomTokens: 200,
				Source:               flconfig.PressureSourceFullRequestEstimate,
			},
			UsedRatio:      0.6,
			ThresholdRatio: 0.9,
			Status:         observation.ContextStatusStable,
			ObservedAt:     time.UnixMilli(10_000),
		},
	})
	sink.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeContextCompact,
		RunID:    "run_context_projection",
		ThreadID: "thread_context_projection",
		TurnID:   "msg_context_projection",
		Step:     1,
		Compaction: &observation.CompactionEvent{
			RunID:               "run_context_projection",
			ThreadID:            "thread_context_projection",
			TurnID:              "msg_context_projection",
			Step:                1,
			OperationID:         "run_context_projection:compact:1:pre_request:threshold",
			RequestID:           "request_context_projection",
			Phase:               observation.CompactionPhaseStart,
			Status:              observation.CompactionStatusRunning,
			Trigger:             "pre_request",
			Reason:              "threshold",
			Source:              "context_manager",
			TokensBefore:        920,
			TokensAfterEstimate: 0,
			ObservedAt:          time.UnixMilli(10_001),
		},
	})

	if len(events) != 2 {
		t.Fatalf("events=%#v, want context usage and compaction", events)
	}
	usage, ok := events[0].(streamEventContextUsage)
	if !ok {
		t.Fatalf("events[0]=%T, want streamEventContextUsage", events[0])
	}
	if usage.Usage.RunID != "run_context_projection" ||
		usage.Usage.Phase != string(observation.ContextPhaseProjectedRequest) ||
		usage.Usage.InputTokens != 600 ||
		usage.Usage.ContextWindowTokens != 1000 ||
		usage.Usage.PressureStatus != string(observation.ContextStatusStable) {
		t.Fatalf("usage=%#v", usage.Usage)
	}
	compaction, ok := events[1].(streamEventContextCompaction)
	if !ok {
		t.Fatalf("events[1]=%T, want streamEventContextCompaction", events[1])
	}
	if compaction.Compaction.OperationID == "" ||
		compaction.Compaction.Status != "compacting" ||
		compaction.Compaction.Phase != string(observation.CompactionPhaseStart) {
		t.Fatalf("compaction=%#v", compaction.Compaction)
	}
}

func TestFloretActivityClearsModelIOBeforeLocalToolExecution(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 3)
	r := &run{
		id:            "run_model_io_activity",
		threadID:      "thread_model_io_activity",
		messageID:     "msg_model_io_activity",
		onStreamEvent: func(ev any) { events = append(events, ev) },
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_finish", Step: 1, FinishReason: "tool_calls"})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		RunID:      "run_model_io_activity",
		ThreadID:   "thread_model_io_activity",
		TurnID:     "msg_model_io_activity",
		ToolID:     "tool_read",
		ToolName:   "file.read",
		ToolKind:   "local",
		ObservedAt: time.Now(),
	})

	var modelIOEvents []streamEventModelIOStatus
	for _, ev := range events {
		if modelIO, ok := ev.(streamEventModelIOStatus); ok {
			modelIOEvents = append(modelIOEvents, modelIO)
		}
	}
	if len(modelIOEvents) != 2 {
		t.Fatalf("model IO events=%#v, want finalizing then clear", modelIOEvents)
	}
	if modelIOEvents[0].Phase != string(FlowerModelIOPhaseFinalizing) {
		t.Fatalf("first model IO=%#v, want finalizing", modelIOEvents[0])
	}
	if modelIOEvents[1].Phase != "" || modelIOEvents[1].RunID != "run_model_io_activity" {
		t.Fatalf("second model IO=%#v, want clear for run", modelIOEvents[1])
	}
}

func TestFloretEventSinkPreservesWhitespaceStreamObservationDeltas(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                 "msg_floret_stream_whitespace",
		onStreamEvent:             func(any) {},
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	for _, text := range []string{"foo", " ", "bar", "\n"} {
		sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderDelta, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: text}})
	}
	for _, text := range []string{"think", " ", "step", "\n"} {
		sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderReasoning, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationReasoningDelta, Text: text}})
	}

	var markdown *persistedMarkdownBlock
	var thinking *persistedThinkingBlock
	for _, block := range r.assistantBlocks {
		switch typed := block.(type) {
		case *persistedMarkdownBlock:
			markdown = typed
		case *persistedThinkingBlock:
			thinking = typed
		}
	}
	if markdown == nil || markdown.Content != "foo bar\n" {
		t.Fatalf("markdown=%#v, want preserved whitespace", markdown)
	}
	if thinking == nil || thinking.Content != "think step\n" {
		t.Fatalf("thinking=%#v, want preserved whitespace", thinking)
	}
}

func TestFloretEventSinkRecordsSourceObservations(t *testing.T) {
	t.Parallel()

	r := &run{}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderSources, Sources: []flruntime.SourceRef{{
		Title: "Example docs",
		URL:   "https://example.test/docs",
	}}})

	if len(r.collectedWebSourceOrder) != 1 {
		t.Fatalf("source order=%#v", r.collectedWebSourceOrder)
	}
	got := r.collectedWebSources["https://example.test/docs"]
	if got.Title != "Example docs" || got.URL != "https://example.test/docs" {
		t.Fatalf("source=%#v", got)
	}
}

func TestRedevenFloretGatewayConfigDoesNotCarryProviderConfiguration(t *testing.T) {
	t.Parallel()

	cfg := redevenFloretAdapterConfig("system", floretModelContextPolicy(1000, 200), config.AIReasoningSelection{Level: config.AIReasoningLevelLow})
	if cfg.Provider != "" {
		t.Fatalf("provider=%q, want empty transport field", cfg.Provider)
	}
	if cfg.Model != "" {
		t.Fatalf("model=%q, want empty transport field", cfg.Model)
	}
	if cfg.BaseURL != "" || cfg.APIKey != "" {
		t.Fatalf("Floret config must not carry Redeven provider endpoint or secret: base_url=%q api_key=%q", cfg.BaseURL, cfg.APIKey)
	}
	if cfg.Reasoning.Level != config.AIReasoningLevelLow {
		t.Fatalf("reasoning=%+v, want low selection", cfg.Reasoning)
	}
	identity, err := redevenFloretGatewayIdentity(" provider-a ", "openai", "https://api.example.test/v1/", " gpt-test ", "openai-responses")
	if err != nil {
		t.Fatalf("redevenFloretGatewayIdentity: %v", err)
	}
	if identity.Provider != "provider-a" || identity.Model != "gpt-test" {
		t.Fatalf("identity=%+v, want trimmed provider id/model", identity)
	}
	equivalent, err := redevenFloretGatewayIdentity("provider-a", "OPENAI", "HTTPS://API.EXAMPLE.TEST/v1/?ignored=true#fragment", "gpt-test", "openai-responses")
	if err != nil {
		t.Fatalf("equivalent gateway identity: %v", err)
	}
	if identity.StateCompatibilityKey != equivalent.StateCompatibilityKey {
		t.Fatalf("normalized equivalent endpoint changed compatibility key: %q != %q", identity.StateCompatibilityKey, equivalent.StateCompatibilityKey)
	}
	for _, testCase := range []struct {
		name         string
		providerID   string
		providerType string
		baseURL      string
		model        string
		route        string
	}{
		{name: "provider", providerID: "provider-b", providerType: "openai", baseURL: "https://api.example.test/v1", model: "gpt-test", route: "openai-responses"},
		{name: "type", providerID: "provider-a", providerType: "openai_compatible", baseURL: "https://api.example.test/v1", model: "gpt-test", route: "openai-responses"},
		{name: "endpoint", providerID: "provider-a", providerType: "openai", baseURL: "https://other.example.test/v1", model: "gpt-test", route: "openai-responses"},
		{name: "model", providerID: "provider-a", providerType: "openai", baseURL: "https://api.example.test/v1", model: "gpt-other", route: "openai-responses"},
		{name: "route", providerID: "provider-a", providerType: "openai", baseURL: "https://api.example.test/v1", model: "gpt-test", route: "openai-chat-completions"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			other, err := redevenFloretGatewayIdentity(testCase.providerID, testCase.providerType, testCase.baseURL, testCase.model, testCase.route)
			if err != nil {
				t.Fatalf("gateway identity: %v", err)
			}
			if identity.StateCompatibilityKey == other.StateCompatibilityKey {
				t.Fatalf("compatibility key did not distinguish %s", testCase.name)
			}
		})
	}
	if _, err := redevenFloretGatewayIdentity("provider-a", "openai", "https://user:secret@api.example.test/v1", "gpt-test", "openai-responses"); err == nil {
		t.Fatal("gateway identity accepted endpoint user information")
	}
}

func TestProjectFloretTaskCompleteDoesNotCreateTranscriptMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_task_complete"
	r.threadID = "thread_floret_task_complete"
	r.messageID = "msg_floret_task_complete"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:       "task_complete",
				CallID:     "call_task_complete",
				Payload:    map[string]any{"result": "Done."},
				OutputText: "Done.",
			},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	var blockSets []streamEventBlockSet
	for _, ev := range events {
		if bs, ok := ev.(streamEventBlockSet); ok {
			blockSets = append(blockSets, bs)
		}
	}
	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want no local activity or markdown projection: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks len=%d, want no local task_complete transcript projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
}

func TestProjectFloretTaskCompleteDoesNotApplyRedevenCompletionGate(t *testing.T) {
	t.Parallel()

	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_task_complete_no_local_gate"
	r.threadID = "thread_floret_task_complete_no_local_gate"
	r.messageID = "msg_floret_task_complete_no_local_gate"

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{Steps: 1},
			Signal:  &flruntime.TurnSignal{Name: "task_complete", CallID: "call_task_complete"},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if r.getEndReason() != "complete" || r.getFinalizationReason() != "task_complete" {
		t.Fatalf("task_complete lifecycle = (%q, %q), want (complete, task_complete)", r.getEndReason(), r.getFinalizationReason())
	}
}

func TestProjectFloretTaskCompletePreservesStreamedMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_task_complete_streamed"
	r.threadID = "thread_floret_task_complete_streamed"
	r.messageID = "msg_floret_task_complete_streamed"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.ensureAssistantMessageStarted()
	if err := r.appendTextDelta("Detailed analysis report."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:       "task_complete",
				CallID:     "call_task_complete",
				Payload:    map[string]any{"result": "Execution summary."},
				OutputText: "Execution summary.",
			},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events[beforeProjectEventCount:] {
		if bs, ok := ev.(streamEventBlockSet); ok {
			if block, ok := bs.Block.(persistedMarkdownBlock); ok {
				t.Fatalf("unexpected markdown block-set after task_complete: index=%d block=%#v", bs.BlockIndex, block)
			}
		}
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want only streamed markdown without local activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Detailed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Detailed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
	}
}

func TestProjectFloretNaturalStopDoesNotCreateTranscriptMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_natural_stop"
	r.threadID = "thread_floret_natural_stop"
	r.messageID = "msg_floret_natural_stop"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events {
		if _, ok := ev.(streamEventBlockDelta); ok {
			t.Fatalf("unexpected text delta event: %#v", ev)
		}
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks len=%d, want no local transcript or activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
}

func TestProjectFloretNaturalStopDoesNotUseResultOutputAsTranscriptFallback(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_natural_stop_no_fallback"
	r.threadID = "thread_floret_natural_stop_no_fallback"
	r.messageID = "msg_floret_natural_stop_no_fallback"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Output:  "This must come from Floret detail events instead.",
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if r.hasNonEmptyAssistantText() {
		t.Fatalf("assistant blocks gained text from result output fallback: %#v", r.assistantBlocks)
	}
	for _, ev := range events {
		switch typed := ev.(type) {
		case streamEventBlockDelta:
			t.Fatalf("unexpected transcript delta from result output: %#v", typed)
		case streamEventBlockSet:
			if block, ok := typed.Block.(persistedMarkdownBlock); ok && strings.Contains(block.Content, "Floret detail events") {
				t.Fatalf("unexpected transcript block from result output: %#v", typed)
			}
		}
	}
}

func TestProjectFloretNaturalStopPreservesStreamedMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_natural_stop_streamed"
	r.threadID = "thread_floret_natural_stop_streamed"
	r.messageID = "msg_floret_natural_stop_streamed"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.ensureAssistantMessageStarted()
	if err := r.appendTextDelta("Streamed analysis report."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events[beforeProjectEventCount:] {
		if bs, ok := ev.(streamEventBlockSet); ok {
			if block, ok := bs.Block.(persistedMarkdownBlock); ok {
				t.Fatalf("unexpected markdown block-set after natural stop: index=%d block=%#v", bs.BlockIndex, block)
			}
		}
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want only streamed markdown without local activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Streamed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Streamed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
	}
}

func TestProjectFloretResultIgnoresDetachedRun(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_detached_result"
	r.threadID = "thread_floret_detached_result"
	r.messageID = "msg_floret_detached_result"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.markDetached()

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Output:  "Late final answer.",
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult completed: %v", err)
	}
	err = r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusWaiting,
			Metrics: flruntime.RunMetrics{Steps: 2},
			Signal: &flruntime.TurnSignal{
				Name: "ask_user",
				Payload: map[string]any{
					"questions": []any{map[string]any{"id": "q1", "question": "Late question?"}},
				},
			},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult waiting: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none after detach: %#v", len(events), events)
	}
	if r.getEndReason() != "" || r.getFinalizationReason() != "" {
		t.Fatalf("detached result mutated final state: end=%q final=%q", r.getEndReason(), r.getFinalizationReason())
	}
	if r.waitingPrompt != nil {
		t.Fatalf("detached waiting result set waiting prompt: %#v", r.waitingPrompt)
	}
	raw, text, _, err := r.snapshotAssistantMessageJSONWithStatus("canceled")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if text != "" {
		t.Fatalf("assistant text=%q, want empty canceled boundary", text)
	}
	var msg persistedMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if msg.Status != "canceled" || len(msg.Blocks) != 0 {
		t.Fatalf("snapshot status=%q blocks=%d, want canceled empty boundary", msg.Status, len(msg.Blocks))
	}
}

func TestProjectFloretCancelledResultUsesCanceledLifecycle(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_cancelled"
	r.threadID = "thread_floret_cancelled"
	r.messageID = "msg_floret_cancelled"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCancelled,
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if got := r.getEndReason(); got != "canceled" {
		t.Fatalf("endReason=%q, want canceled", got)
	}
	if got := r.getFinalizationReason(); got != "canceled" {
		t.Fatalf("finalizationReason=%q, want canceled", got)
	}
	for _, ev := range events {
		if _, ok := ev.(streamEventError); ok {
			t.Fatalf("cancelled result emitted error event: %#v", events)
		}
	}
}

func TestProjectFloretCancelledResultWithDeadlineUsesTimedOutLifecycle(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_floret_cancelled_timeout"
	r.threadID = "thread_floret_cancelled_timeout"
	r.messageID = "msg_floret_cancelled_timeout"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	ctx, cancel := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
	defer cancel()

	err := r.projectFloretResult(
		ctx,
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCancelled,
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if got := r.getEndReason(); got != "timed_out" {
		t.Fatalf("endReason=%q, want timed_out", got)
	}
	if got := r.getFinalizationReason(); got != "timed_out" {
		t.Fatalf("finalizationReason=%q, want timed_out", got)
	}
	for _, ev := range events {
		if _, ok := ev.(streamEventError); ok {
			t.Fatalf("cancelled timeout result emitted error event: %#v", events)
		}
	}
}

func TestProjectFloretUnknownWaitingSignalFailsAsUnsupportedSignal(t *testing.T) {
	t.Parallel()

	r := newFloretRuntimeTestRun(t, runOptions{})
	r.id = "run_unknown_waiting"
	r.threadID = "thread_unknown_waiting"
	r.messageID = "msg_unknown_waiting"

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusWaiting,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:   "legacy_unknown_signal",
				CallID: "call_unknown_waiting",
				Payload: map[string]any{
					"source":  "legacy_unknown_signal",
					"summary": "Need to edit files.",
				},
			},
		},
		RunRequest{},
	)
	if err == nil {
		t.Fatalf("projectFloretResult should reject unknown waiting signal")
	}
	if !strings.Contains(err.Error(), "unsupported waiting control signal") {
		t.Fatalf("error=%v, want unsupported waiting control signal", err)
	}
}
