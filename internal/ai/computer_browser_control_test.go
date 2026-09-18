package ai

import (
	"context"
	"strings"
	"testing"
	"time"
)

func computerAuthorizedTestContext(t *testing.T, r *run, id, name string) context.Context {
	t.Helper()
	r.sessionMeta = testSendTurnMeta()
	snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInComputerToolDefinitions(), nil)
	snapshot.SnapshotID = "computer-control-test"
	ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
	return contextWithFloretToolExecutionAuthorization(ctx, id, name, "attempt-"+id, snapshot, ApprovalDecisionAllow, true, nil)
}

func TestSystemBrowserDiscoveryRequestsConnectionWithoutManagedFallback(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
	bindTargetTestRun(t, r)
	value, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "discover", "computer.targets"), "discover", "computer.targets", map[string]any{"browser_source": "system"})
	if err != nil {
		t.Fatal(err)
	}
	execution, ok := value.(targetToolExecution)
	if !ok || execution.inputRequired == nil || !strings.Contains(execution.inputRequired.Summary, "Connect") {
		t.Fatalf("system browser request did not produce connection assistance: %#v", value)
	}
	selected, _ := store.GetComputerTarget(t.Context(), "thread-first")
	if selected != "" || len(executor.calls) != 0 || len(host.managedProfiles) != 0 {
		t.Fatal("connection assistance started or selected a substitute browser")
	}
}

func TestSampledSafetyPauseBecomesCanonicalInputWithOriginalTarget(t *testing.T) {
	for _, nextTool := range []string{"computer.observe", "computer.exec", "computer.select_target", "computer.targets"} {
		t.Run(nextTool, func(t *testing.T) {
			host, _, store, _ := computerBindingFixture(t)
			target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", Ready: true, DisplayName: "Flower browser"}
			if err := host.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			if err := store.SetComputerTarget(t.Context(), "thread-first", target.ID); err != nil {
				t.Fatal(err)
			}
			calls := 0
			host.executors[target.ID] = scriptTestExecutor{fn: func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
				calls++
				return TargetToolResult{TargetID: target.ID, Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"captcha"}}, Result: map[string]any{"action_executed": false}}, nil
			}}
			r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
			bindTargetTestRun(t, r)
			runID, threadID, turnID := r.floretCanonicalIdentity()
			control := host.controlForTarget(target.ID)
			control.threadID, control.runID, control.turnID = threadID, runID, turnID
			_, err := host.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: threadID, TargetID: target.ID, ToolName: "computer.screenshot", liveFrame: true})
			if err != nil {
				t.Fatal(err)
			}
			candidate, err := host.rememberComputerCandidate(threadID, ComputerCandidate{TargetID: "desktop-main", Kind: "desktop.screen", State: "ready"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			value, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "next", nextTool), "next", nextTool, map[string]any{"candidate_ref": candidate.CandidateRef, "code": "await ui.observe();", "description": "Inspect the result"})
			if err != nil {
				t.Fatalf("sampled safety escaped as an ordinary tool error: %v", err)
			}
			execution, ok := value.(targetToolExecution)
			if !ok || execution.inputRequired == nil || execution.TargetID != target.ID || !strings.Contains(execution.inputRequired.Summary, "CAPTCHA") {
				t.Fatalf("original safety cause/target lost: %#v", value)
			}
			selected, _ := store.GetComputerTarget(t.Context(), threadID)
			if selected != target.ID || calls != 1 {
				t.Fatal("pause dispatched another action or replaced the target")
			}
		})
	}
}

func TestComputerSamplerPreservesClassificationAndDiscardsPixels(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	target := TargetDescriptor{ID: "target", Kind: "browser.connected", Ready: true}
	if err := host.registry.Register(target); err != nil {
		t.Fatal(err)
	}
	if err := store.SetComputerTarget(t.Context(), "thread-first", target.ID); err != nil {
		t.Fatal(err)
	}
	host.executors[target.ID] = scriptTestExecutor{fn: func(context.Context, TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"captcha"}}, Result: map[string]any{"action_executed": false}}, nil
	}}
	control := host.controlForTarget(target.ID)
	control.threadID = "thread-first"
	control.runID = "run"
	frames := make(chan FlowerComputerFrame, 1)
	stop, err := host.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: "thread-first", TargetID: target.ID, ObserverID: "viewer", Revision: 1}}, func(frame FlowerComputerFrame) { frames <- frame })
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	select {
	case frame := <-frames:
		if frame.ErrorCode != "computer_control_required" || frame.AssistanceKind != "captcha" || frame.ResourceRef != "" || frame.FrameID != "" {
			t.Fatalf("wrong safety frame: %+v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("sampler did not publish a classified stop")
	}
	_, err = host.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: "thread-first", RunID: "run", TargetID: target.ID, ToolName: "computer.observe"})
	if !takeoverResult(TargetToolResult{}, err) || computerAssistanceKind(computerPauseSafety(TargetToolResult{}, err)) != "captcha" {
		t.Fatalf("sampler pause lost: %v", err)
	}
}

func TestSystemBrowserDiscoverySeparatesOccupancyFromConnection(t *testing.T) {
	host, _, _, _ := computerBindingFixture(t)
	target := TargetDescriptor{ID: "personal", Kind: "browser.connected", Ready: true}
	if err := host.registry.Register(target); err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget(target.ID)
	control.threadID = "thread-second"
	inventory, err := host.ComputerTargets(t.Context(), TargetToolCall{ThreadID: "thread-first", Arguments: []byte(`{"browser_source":"system"}`)}, ToolTargetPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	if inventory.ConnectionRequired || len(inventory.Candidates) != 1 || inventory.Candidates[0].State != "in_use" {
		t.Fatalf("busy browser mistaken for missing connection: %+v", inventory)
	}
}

func TestComputerSamplingReadFailureDoesNotAcquireUserControl(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	target := TargetDescriptor{ID: "read-failure", Kind: "browser.connected", Ready: true, State: "ready"}
	if err := host.registry.Register(target); err != nil {
		t.Fatal(err)
	}
	if err := store.SetComputerTarget(t.Context(), "thread-first", target.ID); err != nil {
		t.Fatal(err)
	}
	host.executors[target.ID] = browserControlReadyExecutor{scriptTestExecutor{fn: func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		if call.liveFrame {
			return computerObservationFailure(call, map[string]any{"action_executed": false, "observation_stage": "safety_scan"}, "fixture")
		}
		return TargetToolResult{TargetID: target.ID, Result: map[string]any{"observation": "fresh normal page"}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToCapture: true, SafeToSendToModel: true}}, nil
	}}}
	r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
	bindTargetTestRun(t, r)
	runID, threadID, turnID := r.floretCanonicalIdentity()
	control := host.controlForTarget(target.ID)
	control.threadID, control.runID, control.turnID = threadID, runID, turnID
	frames := make(chan FlowerComputerFrame, 1)
	stop, err := host.startComputerLiveFrames(t.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: threadID, TargetID: target.ID, ObserverID: "viewer", Revision: 1}}, func(frame FlowerComputerFrame) { frames <- frame })
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	select {
	case frame := <-frames:
		if frame.ErrorCode != "computer_view_unavailable" || frame.AssistanceKind != "" || frame.ResourceRef != "" {
			t.Fatalf("read failure became human assistance: %+v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("missing failed frame")
	}
	value, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "fresh", "computer.observe"), "fresh", "computer.observe", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	execution, ok := value.(targetToolExecution)
	if !ok || execution.inputRequired != nil {
		t.Fatalf("invented human step: %#v", value)
	}
	control.mu.Lock()
	paused := control.pause != nil
	control.mu.Unlock()
	if paused {
		t.Fatal("sampling failure locked target for user control")
	}
	current, _ := host.registry.ResolveTarget(t.Context(), target.ID)
	if !current.Ready {
		t.Fatal("read failure disconnected healthy browser")
	}
}
