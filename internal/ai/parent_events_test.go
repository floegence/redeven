package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestFlowerParentEventReportToolAndNaturalProviderDelivery(t *testing.T) {
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory(), EnableParentEvents: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	message := strings.Repeat("界", 2700)
	raw, _ := json.Marshal(map[string]any{"message": message})
	childGateway := delegationContextGateway(florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "report", Name: "report_to_parent", Args: string(raw)}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}, delegationContextDone())
	parentGateway := delegationContextGateway(delegationContextDone(), delegationContextDone())
	var threads flruntime.ThreadService
	var parentID identity.ThreadID
	threads, err = host.ThreadService(flruntime.AgentFactoryFunc(func(_ context.Context, req flruntime.AgentRequest) (*flruntime.Agent, error) {
		child := req.ThreadID != parentID
		gateway := parentGateway
		depth := 0
		if child {
			gateway = childGateway
			depth = 1
		}
		r := newRun(runOptions{ThreadID: req.ThreadID.String(), TurnID: req.TurnID.String(), AgentHomeDir: t.TempDir(), SubagentDepth: depth, FloretThreadRuntime: threads, SessionMeta: &session.Meta{CanRead: true}})
		surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, FlowerPermissionReadonly)
		if err != nil {
			return nil, err
		}
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "events", Name: "Events"}, SystemPrompt: surface.SystemPrompt, Context: flconfig.ContextPolicy{ContextWindowTokens: 256000}}, gateway,
			flruntime.WithAgentDynamicToolSurface(func(_ context.Context, req flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				if err := r.observeFloretCanonicalIdentity(req.RunID.String(), req.ThreadID.String(), req.TurnID.String()); err != nil {
					return flruntime.ToolSurface{}, err
				}
				registry := fltools.NewRegistry()
				for _, tool := range surface.FloretToolItems {
					if err := registry.Register(tool); err != nil {
						return flruntime.ToolSurface{}, err
					}
				}
				return flruntime.ToolSurface{Tools: registry, HostContext: surface.HostContext}, nil
			}),
			flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, req flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
				release, err := r.effectAuthorizations.authorize(req, surface.PermissionSnapshot)
				if err != nil {
					return flruntime.EffectDispatchResult{}, err
				}
				defer release()
				return floretAllowTestEffect.Dispatch(ctx, req, effect)
			})))
	}))
	if err != nil {
		t.Fatal(err)
	}
	parent, err := threads.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "parent"})
	if err != nil {
		t.Fatal(err)
	}
	parentID = parent.ThreadID
	child, err := threads.Create(t.Context(), flruntime.CreateThreadInput{ParentThreadID: parentID, TaskName: "Research", TaskDescription: "Actual objective", HostProfileRef: "explore", RequestKey: "child"})
	if err != nil {
		t.Fatal(err)
	}
	delegationContextSend(t, threads, child.ThreadID, "work", nil)
	events := threads.(flruntime.ThreadParentEventService)
	pending, err := events.ListParentEvents(t.Context(), flruntime.ListParentEventsInput{ThreadID: parentID, PendingOnly: true})
	if err != nil || len(pending.Events) != 2 {
		t.Fatalf("events=%+v err=%v", pending, err)
	}
	if len(parentGateway.Requests()) != 0 {
		t.Fatal("report or completion woke idle parent")
	}
	full, err := events.ReadParentEvents(t.Context(), flruntime.ReadParentEventsInput{ThreadID: parentID, EventID: pending.Events[0].ID})
	if err != nil || full.Events[0].Message != message {
		t.Fatal("full Unicode report lost")
	}
	readArgs, _ := json.Marshal(map[string]any{"action": "read", "event_id": pending.Events[0].ID})
	parentGateway = delegationContextGateway(florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "read", Name: "subagent_events", Args: string(readArgs)}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}, delegationContextDone(), delegationContextDone())
	delegationContextSend(t, threads, parentID, "review", nil)
	fullRequest, err := json.Marshal(parentGateway.Requests()[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(fullRequest), message) {
		t.Fatal("full event read lost report in actual provider continuation")
	}
	request := parentGateway.Requests()[0]
	visible, _ := json.Marshal(request)
	if !strings.Contains(string(visible), "Subagent events (runtime facts") || !strings.Contains(string(visible), pending.Events[0].ID) || strings.Contains(string(visible), message) {
		t.Fatalf("bad event projection: %s", visible)
	}
	if strings.Contains(string(visible), "report_to_parent") {
		t.Fatal("root received child-only report tool")
	}
	childRequest, _ := json.Marshal(childGateway.Requests()[0])
	if !strings.Contains(string(childRequest), "report_to_parent") || strings.Contains(string(childRequest), "Manage parent-owned subagents") {
		t.Fatal("child tool boundary changed")
	}
	r := &run{threadID: parentID.String(), threadRuntime: threads}
	result, err := r.readSubagentEvents(t.Context(), map[string]any{"action": "read", "event_id": pending.Events[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	normalized, truncated, err := normalizeTruncatedToolPayload("subagent_events", result)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(normalized)
	if truncated || !strings.Contains(string(encoded), message) {
		t.Fatal("explicit full event read truncated")
	}
	delegationContextSend(t, threads, parentID, "continue", nil)
	count := 0
	for _, m := range parentGateway.Requests()[2].Messages {
		if strings.Contains(m.Text, "Subagent events (runtime facts") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("repeated canonical admission count=%d", count)
	}
}

func newParentEventWaitAdapter(t *testing.T, summaries []flruntime.ThreadSummary) (*floretSubagentRuntime, *subagentHandoffTestRuntime) {
	t.Helper()
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { panic("unexpected execution") }))
	if err != nil {
		t.Fatal(err)
	}
	runtime := &subagentHandoffTestRuntime{ThreadService: service, summaries: summaries, views: map[identity.ThreadID]flruntime.ThreadView{}, viewErrs: map[identity.ThreadID]error{}}
	return newServiceFloretSubagentRuntime(&Service{threadRuntime: runtime}, &run{threadID: "thread-parent", turnID: "turn-parent"}), runtime
}

type parentEventWaitRuntime struct {
	*subagentHandoffTestRuntime
	mu          sync.Mutex
	events      []flruntime.ParentEvent
	waitStarted chan struct{}
	onWait      func()
}

func (s *parentEventWaitRuntime) ReportToParent(context.Context, flruntime.ReportToParentInput) (flruntime.ParentEventReceipt, error) {
	panic("unexpected report")
}
func (s *parentEventWaitRuntime) ReadParentEvents(context.Context, flruntime.ReadParentEventsInput) (flruntime.ParentEventPage, error) {
	panic("unexpected full read")
}
func (s *parentEventWaitRuntime) ListParentEvents(_ context.Context, in flruntime.ListParentEventsInput) (flruntime.ParentEventPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	page := flruntime.ParentEventPage{Events: []flruntime.ParentEvent{}}
	for _, event := range s.events {
		if in.PendingOnly && event.Admitted {
			continue
		}
		if len(in.SourceThreadIDs) > 0 {
			found := false
			for _, id := range in.SourceThreadIDs {
				if event.SourceThreadID == id {
					found = true
				}
			}
			if !found {
				continue
			}
		}
		copy := event
		copy.Message = ""
		page.Events = append(page.Events, copy)
	}
	return page, nil
}
func (s *parentEventWaitRuntime) WaitThreads(ctx context.Context, in flruntime.WaitThreadsInput) (flruntime.ThreadWaitResult, error) {
	close(s.waitStarted)
	if s.onWait != nil {
		s.onWait()
	}
	out, err := s.subagentHandoffTestRuntime.WaitThreads(ctx, in)
	if err != nil {
		return out, err
	}
	page, err := s.ListParentEvents(ctx, flruntime.ListParentEventsInput{ThreadID: *in.Scope.ParentID, SourceThreadIDs: in.ThreadIDs, PendingOnly: true})
	if err != nil {
		return out, err
	}
	out.ParentEvents = &page
	if len(page.Events) > 0 {
		out.Reason = flruntime.ThreadWaitEvents
	}
	return out, nil
}

func TestFlowerParentEventWaitMapsCanonicalWaitResultAndDoesNotRepeatAdmitted(t *testing.T) {
	now := time.Now()
	running := flruntime.ThreadSummary{ID: "child", TaskName: "Research", Activity: flruntime.ThreadActivityActive, CreatedAt: now, UpdatedAt: now}
	adapter, base := newParentEventWaitAdapter(t, []flruntime.ThreadSummary{running})
	runtime := &parentEventWaitRuntime{subagentHandoffTestRuntime: base, waitStarted: make(chan struct{})}
	adapter.service.threadRuntime = runtime
	// Install the canonical fact after subscription, before the first read.
	runtime.onWait = func() {
		runtime.mu.Lock()
		defer runtime.mu.Unlock()
		runtime.events = []flruntime.ParentEvent{{ID: "event", ParentThreadID: "thread-parent", SourceThreadID: "other", SourceTurnID: "turn-other", SourceRunID: "run-other", Kind: flruntime.ParentEventReport}, {ID: "selected", ParentThreadID: "thread-parent", SourceThreadID: "child", SourceTurnID: "turn-child", SourceRunID: "run-child", Kind: flruntime.ParentEventInputRequired, Message: "FULL_BODY_NOT_IN_WAIT"}}
	}
	out, err := adapter.wait(t.Context(), map[string]any{"ids": []any{"child"}, "timeout_ms": 10000})
	if err != nil || out["reason"] != "events" || out["timed_out"] != false {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "FULL_BODY_NOT_IN_WAIT") || strings.Contains(string(raw), "other") {
		t.Fatal("wait copied body or wrong target")
	}
	runtime.onWait = nil

	runtime.mu.Lock()
	runtime.events[1].Admitted = true
	runtime.mu.Unlock()
	runtime.waitStarted = make(chan struct{})
	out, err = adapter.wait(t.Context(), map[string]any{"ids": []any{"child"}, "timeout_ms": 10})
	if err != nil || out["reason"] != "wait_timeout" {
		t.Fatalf("busy loop after admission: %+v %v", out, err)
	}
	if reflect.ValueOf(out["handoffs"]).Len() != 0 {
		t.Fatal("running task got terminal handoff")
	}
}

func TestFlowerParentReportLimitsAndReadOnlyPermission(t *testing.T) {
	for _, def := range builtInParentEventToolDefinitions() {
		if permissionDecisionForTool(FlowerPermissionReadonly, def) != ApprovalDecisionAllow {
			t.Fatalf("readonly cannot use %s", def.Name)
		}
		if def.Name == "report_to_parent" && !reflect.DeepEqual(floretToolEffects(def), []fltools.Effect{fltools.EffectWrite}) {
			t.Fatal("report effect not declared")
		}
	}
	r := &run{subagentDepth: 1}
	for _, body := range []string{"", "  ", string([]byte{0xff}), strings.Repeat("a", 8193)} {
		if _, err := r.reportToParent(t.Context(), fltools.Invocation[map[string]any]{Args: map[string]any{"message": body}}); err == nil {
			t.Fatal("accepted invalid report")
		}
	}
}

func TestFlowerParentEventReadsRecheckRecipientAuthority(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), meta, "Parent", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	page, err := svc.GetFlowerParentEvents(t.Context(), meta, parent.ThreadID, ParentEventReadRequest{Action: "list"})
	if err != nil || len(page.Events) != 0 {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	for _, denied := range []*session.Meta{nil, {EndpointID: meta.EndpointID}, {EndpointID: "other", CanRead: true}} {
		if _, err := svc.GetFlowerParentEvents(t.Context(), denied, parent.ThreadID, ParentEventReadRequest{Action: "list"}); err == nil {
			t.Fatal("unauthorized recipient read")
		}
	}
	if _, err := svc.GetFlowerParentEvents(t.Context(), meta, parent.ThreadID, ParentEventReadRequest{Action: "read"}); err == nil {
		t.Fatal("unbounded read accepted")
	}
	for _, query := range []ParentEventReadRequest{{Action: "list", EventID: "forged"}, {Action: "list", Limit: 101}, {Action: "read", EventID: "forged"}} {
		if _, err := svc.GetFlowerParentEvents(t.Context(), meta, parent.ThreadID, query); err == nil {
			t.Fatalf("invalid query accepted: %+v", query)
		}
	}
}

func TestFlowerParentEventWaitWithoutTargetsIncludesEveryDirectChild(t *testing.T) {
	adapter, base := newParentEventWaitAdapter(t, []flruntime.ThreadSummary{{ID: "child", Activity: flruntime.ThreadActivityActive}})
	runtime := &parentEventWaitRuntime{subagentHandoffTestRuntime: base, waitStarted: make(chan struct{}), events: []flruntime.ParentEvent{{ID: "event", SourceThreadID: "child", Kind: flruntime.ParentEventReport}}}
	adapter.service.threadRuntime = runtime
	out, err := adapter.wait(t.Context(), map[string]any{"timeout_ms": 1})
	if err != nil || out["reason"] != "events" {
		t.Fatalf("out=%+v err=%v", out, err)
	}
}

func TestFlowerParentEventBoundaryPublishesReceiptAdmissionAndResolution(t *testing.T) {
	current := thinkingCurrent(1, "", true, flruntime.ThreadActivityActive)
	initial := flowerRuntimeCurrentBoundaryKey(current)
	current.ParentEvents = &flruntime.ParentEventPage{Events: []flruntime.ParentEvent{{ID: "event", Kind: flruntime.ParentEventInputRequired}}}
	receipt := flowerRuntimeCurrentBoundaryKey(current)
	current.ParentEvents.Events[0].Admitted = true
	admitted := flowerRuntimeCurrentBoundaryKey(current)
	current.ParentEvents.Events[0].Resolved = true
	resolved := flowerRuntimeCurrentBoundaryKey(current)
	if initial == receipt || receipt == admitted || admitted == resolved {
		t.Fatal("event boundary coalesced")
	}
}

type parentEventSubscribeBarrier struct {
	flruntime.ThreadService
	flruntime.ThreadParentEventService
	checked chan struct{}
	once    sync.Once
}

func (s *parentEventSubscribeBarrier) WaitThreads(ctx context.Context, input flruntime.WaitThreadsInput) (flruntime.ThreadWaitResult, error) {
	s.once.Do(func() { close(s.checked) })
	return s.ThreadService.(flruntime.ThreadWaiter).WaitThreads(ctx, input)
}

func TestFlowerParentEventProductEffectAndPassiveNaturalRequest(t *testing.T) {
	var childCalls atomic.Int32
	releaseReport := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseReport) }) }
	defer release()
	parentRequests := make(chan string, 2)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		names := extractOpenAIToolNames(request)
		if len(names) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Research")
			return
		}
		child := false
		for _, name := range names {
			if name == "report_to_parent" {
				child = true
			}
		}
		if child {
			if childCalls.Add(1) == 1 {
				select {
				case <-releaseReport:
				case <-r.Context().Done():
					return
				}
				writeDeepSeekIntegrationToolCall(w, flusher, "report", "report-call", "report_to_parent", `{"message":"Important verified discovery"}`)
				return
			}
			writeDeepSeekIntegrationTextResponse(w, flusher, "child-final", "Full final handoff")
			return
		}
		raw, _ := json.Marshal(request["input"])
		parentRequests <- string(raw)
		writeDeepSeekIntegrationTextResponse(w, flusher, "parent-final", "Reviewed references")
	}))
	defer provider.Close()
	svc := openRealtimeTestService(t, t.TempDir(), provider.URL)
	defer svc.Close()
	barrier := &parentEventSubscribeBarrier{ThreadService: svc.threadRuntime, ThreadParentEventService: svc.threadRuntime.(flruntime.ThreadParentEventService), checked: make(chan struct{})}
	meta := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), meta, "Parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	adapter := newServiceFloretSubagentRuntime(svc, &run{sessionMeta: meta, endpointID: meta.EndpointID, threadID: parent.ThreadID, turnID: "parent-turn", currentModelID: "openai/gpt-5-mini", permissionType: FlowerPermissionReadonly})
	spawned, err := adapter.spawn(t.Context(), "spawn-report", map[string]any{"task_name": "Research", "task_description": "Verify sources", "agent_type": "reviewer", "message": "Investigate"})
	if err != nil {
		t.Fatal(err)
	}
	childID := identity.ThreadID(spawned["thread_id"].(string))
	waited := make(chan map[string]any, 1)
	waitErrors := make(chan error, 1)
	go func() {
		waitAdapter := newServiceFloretSubagentRuntime(&Service{threadRuntime: barrier}, &run{threadID: parent.ThreadID, turnID: "parent-turn"})
		result, err := waitAdapter.wait(t.Context(), map[string]any{"ids": []any{childID.String()}, "timeout_ms": 10000})
		if err != nil {
			waitErrors <- err
		} else {
			waited <- result
		}
	}()
	select {
	case <-barrier.checked:
	case <-time.After(5 * time.Second):
		t.Fatal("canonical wait was not invoked")
	}
	release()
	select {
	case err := <-waitErrors:
		t.Fatal(err)
	case result := <-waited:
		if result["reason"] != "events" {
			t.Fatalf("wait did not wake for canonical event: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canonical event did not wake subscriber")
	}
	waitForFloretThreadIdle(t, svc.threadRuntime, childID)
	events, err := svc.GetFlowerParentEvents(t.Context(), meta, parent.ThreadID, ParentEventReadRequest{Action: "list"})
	if err != nil || len(events.Events) != 2 {
		view, _ := svc.threadRuntime.View(t.Context(), childID)
		t.Fatalf("events=%+v err=%v child=%+v", events, err, view)
	}
	select {
	case <-parentRequests:
		t.Fatal("event woke idle parent")
	default:
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "review-report", ThreadID: parent.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Review child events"}, Options: RunOptions{PermissionType: config.AIPermissionReadonly}}); err != nil {
		t.Fatal(err)
	}
	select {
	case request := <-parentRequests:
		if !strings.Contains(request, "Important verified discovery") || !strings.Contains(request, events.Events[1].ID) || strings.Contains(request, "Full final handoff") {
			t.Fatalf("request=%s", request)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("natural request missing")
	}
	waitForFloretThreadIdle(t, svc.threadRuntime, identity.ThreadID(parent.ThreadID))
}

func TestFlowerParentEventFullPageBypassesPresentationAndGenericOutputCaps(t *testing.T) {
	page := flruntime.ParentEventPage{Events: make([]flruntime.ParentEvent, 20)}
	for i := range page.Events {
		page.Events[i] = flruntime.ParentEvent{ID: fmt.Sprintf("event-%d", i), ParentThreadID: "thread-parent", SourceThreadID: "thread-child", SourceTurnID: "turn-child", SourceRunID: "run-child", SourceEntryID: fmt.Sprintf("entry-%d", i), Kind: flruntime.ParentEventReport, Message: strings.Repeat("x", 8192)}
	}
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "read", ToolName: "subagent_events", Status: toolResultStatusSuccess, Data: page})
	if err != nil {
		t.Fatal(err)
	}
	projection := fltools.BuildOutputProjection(result, fltools.MergeOutputPolicy(fltools.DefaultOutputPolicy(), result.OutputPolicy))
	if projection.Truncated {
		t.Fatal("explicit full page silently truncated")
	}
	var body struct {
		Data      flruntime.ParentEventPage `json:"data"`
		Truncated bool                      `json:"truncated"`
	}
	if err := json.Unmarshal([]byte(projection.VisibleText), &body); err != nil {
		t.Fatal(err)
	}
	if body.Truncated || !reflect.DeepEqual(body.Data, page) {
		t.Fatal("model event page changed")
	}
}
