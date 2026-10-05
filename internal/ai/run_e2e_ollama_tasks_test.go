package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// Real inference and real tools exercise the product commands. The fault proxy
// only pauses or cuts actual provider bytes; it never fabricates model output.
func TestE2E_FlowerOllamaTaskLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_OLLAMA_TASK_E2E") != "1" {
		t.Skip("run scripts/check_flower_tasks_ollama.sh to qualify the selected real model")
	}
	profile, model, modelID, key := loadOllamaQualificationProfile(t, t.Context())
	t.Logf("selected model=%s served_context=%d", model.EffectiveWireModelName(), model.ContextWindow)
	cases := []struct {
		name string
		run  func(*ollamaTaskFixture)
	}{
		{"files_and_terminal", ollamaTaskFiles},
		{"stop_stream_and_new_input", ollamaTaskStopStream},
		{"stop_visible_output_and_new_input", ollamaTaskStopVisible},
		{"stop_running_terminal", ollamaTaskStopTerminal},
		{"queue_edit_reorder_delete", ollamaTaskQueue},
		{"send_queued_now", ollamaTaskSendNow},
		{"stop_preserves_queue", ollamaTaskStopQueue},
		{"retry_interrupted_stream", ollamaTaskRetryStream},
		{"approval_accept_reject_stop", ollamaTaskApprovals},
		{"ask_user_restart_and_queued_input", ollamaTaskAskUser},
		{"stop_ask_user_and_new_input", ollamaTaskStopAskUser},
		{"subagents_parallel_handoff", ollamaTaskSubagents},
		{"subagent_full_history", ollamaTaskSubagentHistory},
		{"subagent_interrupt_and_followup", ollamaTaskSubagentInterrupt},
		{"parent_stop_cancels_child", ollamaTaskParentStop},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newOllamaTaskFixture(t, profile, model, modelID, key)
			tc.run(f)
			f.verifyLive()
		})
	}
}

type ollamaTaskFixture struct {
	t              *testing.T
	ctx            context.Context
	svc            *Service
	opts           Options
	meta           *session.Meta
	root, threadID string
	recorder       *ollamaContextRecorder
	fault          *ollamaTaskFault
	report         map[string]any
	mu             sync.Mutex
	frames         []FlowerLiveStreamEnvelope
}

func newOllamaTaskFixture(t *testing.T, profile config.AIProvider, model config.AIProviderModel, modelID, key string) *ollamaTaskFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	t.Cleanup(cancel)
	f := &ollamaTaskFixture{t: t, ctx: ctx, root: t.TempDir(), recorder: &ollamaContextRecorder{model: model.EffectiveWireModelName(), marker: "LIFECYCLE_FACT"}, report: map[string]any{"model": model.EffectiveWireModelName(), "runtime_pid": os.Getpid()}}
	proxy := newOllamaContextProxy(t, profile.BaseURL, f.recorder)
	f.fault = newOllamaTaskFault(t, proxy.URL)
	profile.BaseURL = f.fault.server.URL + "/v1"
	// Runtime journals must not appear among task files: otherwise a child
	// could recover a fact from SQLite instead of its inherited conversation.
	f.opts = Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: t.TempDir(), AgentHomeDir: f.root, Shell: "/bin/bash", Config: &config.AIConfig{CurrentModelID: modelID, PermissionType: config.AIPermissionFullAccess, Providers: []config.AIProvider{profile}}, RunMaxWallTime: 6 * time.Minute, RunIdleTimeout: 2 * time.Minute, ToolApprovalTimeout: 3 * time.Minute, ResolveProviderAPIKey: func(string) (string, bool, error) { return key, key != "", nil }}
	var err error
	f.svc, err = NewService(f.opts)
	if err != nil {
		t.Fatal(err)
	}
	f.meta = &session.Meta{EndpointID: "env_ollama_tasks", NamespacePublicID: "ns_ollama_tasks", ChannelID: "ch_ollama_tasks", UserPublicID: "user_ollama_tasks", UserEmail: "tasks@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	th, err := f.svc.CreateThread(ctx, f.meta, "Ollama task qualification", modelID, "", f.root)
	if err != nil {
		t.Fatal(err)
	}
	f.threadID = th.ThreadID
	f.report["state_root"] = f.opts.StateDir
	f.report["workspace"] = f.root
	f.report["proxy"] = f.fault.server.URL
	f.observe()
	t.Cleanup(func() {
		if f.svc != nil {
			if d, err := f.svc.GetFlowerThreadDetail(context.Background(), f.meta, f.threadID); err == nil {
				f.report["last_observed"] = d
			}
			parent := identity.ThreadID(f.threadID)
			if children, err := f.svc.threadRuntime.List(context.Background(), flruntime.ThreadScope{ParentID: &parent}); err == nil {
				views := []flruntime.ThreadView{}
				for _, child := range children {
					if view, err := f.svc.threadRuntime.View(context.Background(), child.ID); err == nil {
						views = append(views, view)
					}
				}
				f.report["child_views"] = views
			}
		}
		if f.svc != nil {
			_ = f.svc.Close()
		}
		f.report["pass"] = !t.Failed()
		f.report["requests"] = f.recorder.snapshot()
		f.report["faults"] = f.fault.snapshot()
		if root := os.Getenv("REDEVEN_FLOWER_TASK_REPORT_ROOT"); root != "" {
			if err := os.MkdirAll(root, 0700); err != nil {
				t.Error(err)
				return
			}
			raw, err := json.MarshalIndent(f.report, "", "  ")
			if err != nil {
				t.Error(err)
				return
			}
			if err := os.WriteFile(filepath.Join(root, strings.TrimPrefix(t.Name(), "TestE2E_FlowerOllamaTaskLifecycle/")+".json"), append(raw, '\n'), 0600); err != nil {
				t.Error(err)
			}
		}
	})
	return f
}

func (f *ollamaTaskFixture) observe() {
	sub, err := f.svc.SubscribeFlowerLiveStream(f.ctx, f.meta, FlowerLiveStreamRequest{})
	if err != nil {
		f.t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			frame, err := sub.Next(f.ctx)
			if err != nil {
				return
			}
			var e FlowerLiveStreamEnvelope
			if json.Unmarshal(frame.Data, &e) == nil {
				f.mu.Lock()
				f.frames = append(f.frames, e)
				f.mu.Unlock()
			}
		}
	}()
	f.t.Cleanup(func() { sub.Close(); <-done })
}

func (f *ollamaTaskFixture) send(id, text string) SendUserTurnResponse {
	f.t.Helper()
	r, err := f.svc.SendUserTurn(f.ctx, f.meta, SendUserTurnRequest{ThreadID: f.threadID, ClientRequestID: id, Input: RunInput{Text: text}})
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}
func (f *ollamaTaskFixture) view() *FlowerThreadDetail {
	f.t.Helper()
	d, err := f.svc.GetFlowerThreadDetail(f.ctx, f.meta, f.threadID)
	if err != nil {
		f.t.Fatal(err)
	}
	return d
}
func (f *ollamaTaskFixture) wait(label string, accepts func(*FlowerThreadDetail) bool) *FlowerThreadDetail {
	f.t.Helper()
	deadline := time.NewTimer(3 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(30 * time.Millisecond)
	defer ticker.Stop()
	for {
		d := f.view()
		if accepts(d) {
			return d
		}
		if strings.HasSuffix(f.t.Name(), "/subagent_full_history") {
			for _, child := range f.children() {
				v, err := f.svc.threadRuntime.View(f.ctx, child.ID)
				if err != nil {
					f.t.Fatal(err)
				}
				if v.LastOutcome != nil && *v.LastOutcome == flruntime.TurnOutcomeFailed {
					f.t.Fatalf("full-history child failed: %+v", v.Failure)
				}
			}
		}
		if d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil && *d.Current.LastOutcome == flruntime.TurnOutcomeFailed {
			f.t.Fatalf("%s failed before expected state: %+v", label, d.Current.Failure)
		}
		select {
		case <-f.ctx.Done():
			f.t.Fatal(f.ctx.Err())
		case <-deadline.C:
			f.t.Fatalf("%s timed out: activity=%s outcome=%v failure=%+v", label, d.Current.Activity, d.Current.LastOutcome, d.Current.Failure)
		case <-ticker.C:
		}
	}
}
func (f *ollamaTaskFixture) terminal(outcome flruntime.TurnOutcome) *FlowerThreadDetail {
	f.t.Helper()
	d := f.wait("terminal", func(d *FlowerThreadDetail) bool {
		return d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil && len(d.Current.Queue) == 0
	})
	if *d.Current.LastOutcome != outcome {
		f.t.Fatalf("outcome=%s want=%s failure=%+v", *d.Current.LastOutcome, outcome, d.Current.Failure)
	}
	for _, i := range d.Current.Interactions {
		if !i.Resolved {
			f.t.Fatalf("terminal retained unresolved interaction %s", i.ID)
		}
	}
	f.report["final"] = d
	return d
}
func (f *ollamaTaskFixture) finish(id, prompt, answer string) *FlowerThreadDetail {
	f.t.Helper()
	f.send(id, prompt)
	d := f.terminal(flruntime.TurnOutcomeCompleted)
	if answer != "" && !strings.Contains(ollamaTaskText(d.Current), answer) {
		f.t.Fatalf("answer=%q missing %q", ollamaTaskText(d.Current), answer)
	}
	return d
}
func ollamaTaskText(v flruntime.ThreadView) string {
	var b strings.Builder
	for _, i := range v.Items {
		if i.Kind == flruntime.ThreadItemAssistant && i.TurnID == v.TurnID {
			b.WriteString(i.Text)
		}
	}
	return b.String()
}
func (f *ollamaTaskFixture) stop() {
	f.t.Helper()
	start := time.Now()
	if _, err := f.svc.StopThread(f.ctx, f.meta, f.threadID); err != nil {
		f.t.Fatal(err)
	}
	if time.Since(start) > 2*time.Second {
		f.t.Fatal("Stop blocked on provider work")
	}
	f.report["stop_admission_ms"] = time.Since(start).Milliseconds()
}
func (f *ollamaTaskFixture) file(name, want string) {
	f.t.Helper()
	b, err := os.ReadFile(filepath.Join(f.root, name))
	if err != nil || string(b) != want {
		f.t.Fatalf("file %s=%q err=%v want=%q", name, b, err, want)
	}
}
func (f *ollamaTaskFixture) missing(name string) {
	f.t.Helper()
	if _, err := os.Stat(filepath.Join(f.root, name)); !os.IsNotExist(err) {
		f.t.Fatalf("unexpected file %s: %v", name, err)
	}
}
func (f *ollamaTaskFixture) tool(d *FlowerThreadDetail, name string) {
	f.t.Helper()
	for _, i := range d.Current.Items {
		if i.Activity != nil && i.Activity.ToolName == name && string(i.Activity.Status) == "success" {
			return
		}
	}
	f.t.Fatalf("no successful %s activity", name)
}
func (f *ollamaTaskFixture) verifyLive() {
	f.t.Helper()
	f.noRunningTerminalProcesses()
	d := f.view()
	deadline := time.Now().Add(3 * time.Second)
	for {
		f.mu.Lock()
		matched := false
		for _, e := range f.frames {
			if e.Current != nil && e.Current.ThreadID == d.Current.ThreadID && e.Current.ViewVersion == d.Current.ViewVersion && e.Current.Activity == d.Current.Activity {
				matched = true
			}
		}
		f.mu.Unlock()
		if matched {
			break
		}
		if time.Now().After(deadline) {
			f.t.Fatal("workspace stream missed canonical final state")
		}
		time.Sleep(20 * time.Millisecond)
	}
	seen := map[string]bool{}
	for _, i := range d.Current.Items {
		if seen[i.ID] {
			f.t.Fatalf("duplicate current item %s", i.ID)
		}
		seen[i.ID] = true
		if i.Live {
			f.t.Fatalf("terminal retained live item %s", i.ID)
		}
	}
	requests := f.recorder.snapshot()
	if len(requests) == 0 {
		f.t.Fatal("no real model requests")
	}
	for _, r := range requests {
		if r.Model != f.recorder.model {
			f.t.Fatalf("used unselected model %s", r.Model)
		}
	}
	f.report["live_final_matches"] = true
}

func (f *ollamaTaskFixture) noRunningTerminalProcesses() {
	f.t.Helper()
	manager := f.svc.terminalProcessManager()
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for _, p := range manager.processes {
		if p.Snapshot().Status == terminalProcessStatusRunning {
			f.t.Fatal("completed task left a running terminal process")
		}
	}
	f.report["terminal_processes_settled"] = true
}

func ollamaTaskFiles(f *ollamaTaskFixture) {
	if err := os.WriteFile(filepath.Join(f.root, "input.csv"), []byte("name,amount\nalpha,7\nbeta,11\ngamma,19\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	d := f.finish("files", "Use terminal.exec to read input.csv from the current working directory, calculate the sum of its amount column, and write exactly 37 followed by a newline into total.txt. Verify the file with a terminal command. Work only in the current directory. Report TOTAL=37 after verifying.", "TOTAL=37")
	f.file("total.txt", "37\n")
	f.tool(d, "terminal.exec")
	f.finish("file-followup", "Use terminal.exec to append exactly VERIFIED followed by a newline to total.txt, then read the file and report its two lines. Do not recompute or duplicate the original total.", "VERIFIED")
	f.file("total.txt", "37\nVERIFIED\n")
}

func ollamaTaskStopVisible(f *ollamaTaskFixture) { ollamaTaskStopGeneration(f, "hold_content") }
func ollamaTaskStopStream(f *ollamaTaskFixture)  { ollamaTaskStopGeneration(f, "hold") }
func ollamaTaskStopGeneration(f *ollamaTaskFixture, mode string) {
	f.fault.arm(mode)
	f.send("stream", "Without tools, explain how database transactions work in 40 detailed numbered paragraphs.")
	f.fault.waitHit(f.t)
	if mode == "hold_content" {
		f.wait("visible assistant output", func(d *FlowerThreadDetail) bool {
			return ollamaTaskText(d.Current) != ""
		})
		f.report["visible_output_before_stop"] = true
	}
	f.stop()
	f.terminal(flruntime.TurnOutcomeCancelled)
	f.stop()
	if _, err := f.svc.RetryThreadContinuation(f.ctx, f.meta, f.threadID); err == nil {
		f.t.Fatal("cancelled turn offered failure retry")
	}
	f.finish("after-stop", "New task: calculate 17*19. Reply exactly RESULT=323. Do not resume the interrupted explanation or call tools.", "RESULT=323")
}

func ollamaTaskStopTerminal(f *ollamaTaskFixture) {
	f.send("terminal-stop", "Use terminal.exec with yield_ms 30000 and execute exactly: printf STARTED > started.txt; sleep 30; printf SHOULD_NOT_RUN > late.txt . Wait for the command and then report completion. Work only in the current directory.")
	f.wait("terminal started", func(d *FlowerThreadDetail) bool {
		_, err := os.Stat(filepath.Join(f.root, "started.txt"))
		return err == nil
	})
	f.stop()
	f.terminal(flruntime.TurnOutcomeCancelled)
	f.file("started.txt", "STARTED")
	f.missing("late.txt")
	f.noRunningTerminalProcesses()
	f.finish("terminal-after-stop", "Use terminal.exec to write exactly RECOVERED into recovered.txt in the current directory. Reply RECOVERED.", "RECOVERED")
	f.file("recovered.txt", "RECOVERED")
}

func ollamaTaskQueue(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("queue-active", "Reply exactly FIRST. Do not call tools.")
	f.fault.waitHit(f.t)
	a := f.send("queue-a", "Use terminal.exec to append OLD followed by a newline into order.txt in the current directory, then reply OLD.")
	b := f.send("queue-b", "Use terminal.exec to append B followed by a newline into order.txt in the current directory, then reply B.")
	c := f.send("queue-c", "Use terminal.exec to append DELETED followed by a newline into order.txt in the current directory, then reply DELETED.")
	if a.Kind != "queued" || b.Kind != "queued" || c.Kind != "queued" {
		f.t.Fatal("active input was not queued")
	}
	old := "Use terminal.exec to append OLD followed by a newline into order.txt in the current directory, then reply OLD."
	edited := "Use terminal.exec to append A followed by a newline into order.txt in the current directory, then reply A."
	if _, err := f.svc.EditQueuedInput(f.ctx, f.meta, f.threadID, a.QueueID, EditQueuedInputRequest{ClientRequestID: "edit-a", ExpectedText: &old, Text: edited}); err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.svc.EditQueuedInput(f.ctx, f.meta, f.threadID, a.QueueID, EditQueuedInputRequest{ClientRequestID: "stale-a", ExpectedText: &old, Text: "STALE"}); err == nil {
		f.t.Fatal("stale edit accepted")
	}
	if err := f.svc.DeleteQueuedInput(f.ctx, f.meta, f.threadID, c.QueueID); err != nil {
		f.t.Fatal(err)
	}
	if err := f.svc.ReorderQueue(f.ctx, f.meta, f.threadID, ReorderQueueRequest{OrderedQueueIDs: []string{b.QueueID, a.QueueID}}); err != nil {
		f.t.Fatal(err)
	}
	f.fault.release()
	d := f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("order.txt", "B\nA\n")
	var users []string
	for _, i := range d.Current.Items {
		if i.Kind == flruntime.ThreadItemUser {
			users = append(users, i.Text)
		}
	}
	if len(users) != 3 || users[2] != edited {
		f.t.Fatalf("canonical user sequence=%v", users)
	}
}

func ollamaTaskSendNow(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("now-active", "Without tools, write 30 paragraphs explaining the history of compilers.")
	f.fault.waitHit(f.t)
	a := f.send("now-queued", "Use terminal.exec to write exactly NEW_INPUT into new-input.txt in the current directory. Reply NEW_INPUT.")
	if a.Kind != "queued" {
		f.t.Fatal("new input was not queued")
	}
	if _, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, a.QueueID); err != nil {
		f.t.Fatal(err)
	}
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("new-input.txt", "NEW_INPUT")
	if f.fault.snapshot()["canceled"].(int) < 1 {
		f.t.Fatal("send now did not cancel the active provider request")
	}
}

func ollamaTaskStopQueue(f *ollamaTaskFixture) {
	f.fault.arm("hold")
	f.send("stop-queue-active", "Without tools, explain transactions in 30 paragraphs.")
	f.fault.waitHit(f.t)
	q := f.send("stop-queue-pending", "Use terminal.exec to append exactly RESUMED followed by a newline to resumed.txt in the current directory. Reply RESUMED.")
	if q.Kind != "queued" {
		f.t.Fatal("input was not queued")
	}
	f.stop()
	d := f.wait("stopped with queue", func(d *FlowerThreadDetail) bool {
		return d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
	})
	if *d.Current.LastOutcome != flruntime.TurnOutcomeCancelled || len(d.Current.Queue) != 1 {
		f.t.Fatal("stop lost queue or started pending input")
	}
	f.missing("resumed.txt")
	if _, err := f.svc.SendQueuedInputNow(f.ctx, f.meta, f.threadID, q.QueueID); err != nil {
		f.t.Fatal(err)
	}
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("resumed.txt", "RESUMED\n")
}

func ollamaTaskRetryStream(f *ollamaTaskFixture) {
	// Cut the real inference request AFTER the same turn's committed tool
	// result. A retry must continue that turn without repeating its write.
	f.fault.armAfterTool("cut", "EFFECT_COMMITTED")
	f.send("retry-effect", "Use terminal.exec exactly once to run: printf 'ONCE\\n' >> effects.txt; printf EFFECT_COMMITTED . Then, without any more tools, explain durable side-effect identity in six numbered points and end with RETRY_COMPLETE. Work only in the current directory.")
	f.fault.waitHit(f.t)
	d := f.terminal(flruntime.TurnOutcomeFailed)
	f.file("effects.txt", "ONCE\n")
	f.report["failure_before_retry"] = d.Thread.RunErrorCode
	if _, err := f.svc.RetryThreadContinuation(f.ctx, f.meta, f.threadID); err != nil {
		f.t.Fatal(err)
	}
	d = f.terminal(flruntime.TurnOutcomeCompleted)
	if !strings.Contains(ollamaTaskText(d.Current), "RETRY_COMPLETE") {
		f.t.Fatal("retry did not finish requested work")
	}
	f.file("effects.txt", "ONCE\n")
	users := 0
	for _, i := range d.Current.Items {
		if i.Kind == flruntime.ThreadItemUser {
			users++
		}
	}
	if users != 1 {
		f.t.Fatalf("retry duplicated user input: %d", users)
	}
	if _, err := f.svc.RetryThreadContinuation(f.ctx, f.meta, f.threadID); err == nil {
		f.t.Fatal("completed turn admitted duplicate retry")
	}
}

func (f *ollamaTaskFixture) approval() flruntime.ThreadInteraction {
	f.t.Helper()
	d := f.wait("approval", func(d *FlowerThreadDetail) bool {
		for _, i := range d.Current.Interactions {
			if i.Kind == flruntime.ThreadInteractionApproval && !i.Resolved {
				return true
			}
		}
		return false
	})
	for _, i := range d.Current.Interactions {
		if i.Kind == flruntime.ThreadInteractionApproval && !i.Resolved {
			return i
		}
	}
	panic("unreachable")
}
func ollamaTaskApprovals(f *ollamaTaskFixture) {
	if err := f.svc.SetThreadPermissionType(f.ctx, f.meta, f.threadID, config.AIPermissionApprovalRequired); err != nil {
		f.t.Fatal(err)
	}
	for _, action := range []string{"accept", "reject", "stop"} {
		f.send("approval-"+action, fmt.Sprintf("Use terminal.exec to write exactly APPROVED into %s.txt in the current directory. If permission is denied or cancelled, do not try any other tool or alternate route. Report the actual outcome.", action))
		i := f.approval()
		f.missing(action + ".txt")
		if action == "stop" {
			f.stop()
			f.terminal(flruntime.TurnOutcomeCancelled)
			f.missing(action + ".txt")
			continue
		}
		approvals := 0
		for {
			if _, err := f.svc.SubmitFlowerApproval(f.meta, SubmitFlowerApprovalRequest{ThreadID: f.threadID, InteractionID: i.ID, Approved: action == "accept"}); err != nil {
				f.t.Fatal(err)
			}
			approvals++
			d := f.wait("approval completion or next tool", func(d *FlowerThreadDetail) bool {
				if d.Current.Activity == flruntime.ThreadActivityIdle {
					return true
				}
				for _, next := range d.Current.Interactions {
					if next.Kind == flruntime.ThreadInteractionApproval && !next.Resolved {
						return true
					}
				}
				return false
			})
			if d.Current.Activity == flruntime.ThreadActivityIdle {
				break
			}
			if action != "accept" {
				f.t.Fatal("denied task requested another tool approval")
			}
			if approvals >= 8 {
				f.t.Fatal("simple write exceeded bounded approval count")
			}
			// A real model may verify its write in a second terminal call.
			// Each call must receive its own user approval before proceeding.
			for _, next := range d.Current.Interactions {
				if next.Kind == flruntime.ThreadInteractionApproval && !next.Resolved {
					i = next
					break
				}
			}
		}
		f.report["approvals_"+action] = approvals
		f.terminal(flruntime.TurnOutcomeCompleted)
		if action == "accept" {
			// Approval governs whether the requested write happens. A single
			// terminal newline does not change this text marker's meaning.
			content, err := os.ReadFile(filepath.Join(f.root, "accept.txt"))
			if err != nil || strings.TrimSuffix(string(content), "\n") != "APPROVED" {
				f.t.Fatalf("approved content=%q err=%v", content, err)
			}
		} else {
			f.missing("reject.txt")
		}
	}
	f.finish("approval-recover", "Reply exactly APPROVAL_RECOVERED without using tools.", "APPROVAL_RECOVERED")
}

func (f *ollamaTaskFixture) ask() *RequestUserInputPrompt {
	f.t.Helper()
	d := f.wait("ask user", func(d *FlowerThreadDetail) bool { return d.Thread.WaitingPrompt != nil })
	return d.Thread.WaitingPrompt
}
func ollamaTaskAskUser(f *ollamaTaskFixture) {
	f.send("ask", "Before doing any work, use ask_user to ask me for a release codename. Use one free-text question with id codename and response_mode write. After I answer, use terminal.exec to write that exact answer to codename.txt in the current directory, then reply CODENAME_SAVED.")
	p := f.ask()
	queued := f.send("ask-queued", "After the codename task, use terminal.exec to read codename.txt and write its contents to copied.txt in the current directory. Reply COPY_DONE.")
	if queued.Kind != "queued" {
		f.t.Fatal("input while waiting was not queued")
	}
	if err := f.svc.Close(); err != nil {
		f.t.Fatal(err)
	}
	var err error
	f.svc, err = NewService(f.opts)
	if err != nil {
		f.t.Fatal(err)
	}
	f.observe()
	restored := f.ask()
	if !reflect.DeepEqual(p, restored) {
		f.t.Fatal("restart changed user question")
	}
	answer := SubmitRequestUserInputResponseRequest{ThreadID: f.threadID, Response: RequestUserInputResponse{PromptID: p.PromptID, Answers: map[string]RequestUserInputAnswer{"codename": {Text: "LIFECYCLE_FACT_ORCHID"}}}}
	if _, err := f.svc.SubmitRequestUserInputResponse(f.ctx, f.meta, answer); err != nil {
		f.t.Fatal(err)
	}
	f.terminal(flruntime.TurnOutcomeCompleted)
	f.file("codename.txt", "LIFECYCLE_FACT_ORCHID")
	f.file("copied.txt", "LIFECYCLE_FACT_ORCHID")
	if _, err := f.svc.SubmitRequestUserInputResponse(f.ctx, f.meta, answer); err != nil {
		f.t.Fatalf("idempotent answer rejected: %v", err)
	}
	answer.Response.Answers["codename"] = RequestUserInputAnswer{Text: "CONFLICT"}
	if _, err := f.svc.SubmitRequestUserInputResponse(f.ctx, f.meta, answer); err == nil {
		f.t.Fatal("conflicting answer replay accepted")
	}
}

func ollamaTaskStopAskUser(f *ollamaTaskFixture) {
	f.send("ask-stop", "Use ask_user to ask for the missing release name with one free-text question, then wait for my answer. Do not guess it.")
	f.ask()
	f.stop()
	f.terminal(flruntime.TurnOutcomeCancelled)
	f.finish("ask-stop-new", "The previous question is cancelled. New task: reply exactly FRESH_TASK without tools.", "FRESH_TASK")
}

func (f *ollamaTaskFixture) children() []flruntime.ThreadSummary {
	f.t.Helper()
	parent := identity.ThreadID(f.threadID)
	items, err := f.svc.threadRuntime.List(f.ctx, flruntime.ThreadScope{ParentID: &parent})
	if err != nil {
		f.t.Fatal(err)
	}
	return items
}
func ollamaTaskSubagents(f *ollamaTaskFixture) {
	if err := os.WriteFile(filepath.Join(f.root, "left.txt"), []byte("17\n19\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "right.txt"), []byte("23\n29\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	f.finish("subagents", fmt.Sprintf("Use subagents to spawn exactly two worker children with mission_only context: Left Audit must use terminal.exec to read %s/left.txt and return LEFT_SUM=36; Right Audit must use terminal.exec to read %s/right.txt and return RIGHT_SUM=52. Spawn both before waiting. Ask them to actually calculate from the files and not modify files. Use subagents wait for both complete handoffs, then use terminal.exec to save the combined total as exactly 88 followed by a newline in combined.txt in your current directory, and report both sums and the total. Do not calculate the individual sums on their behalf. Do not close them.", f.root, f.root), "")
	f.file("combined.txt", "88\n")
	children := f.children()
	if len(children) != 2 {
		f.t.Fatalf("children=%d want 2", len(children))
	}
	for _, child := range children {
		d, err := f.svc.GetFlowerSubagentDetail(f.ctx, f.meta, f.threadID, child.ID.String())
		if err != nil {
			f.t.Fatal(err)
		}
		if d.Current.LastOutcome == nil || *d.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
			f.t.Fatalf("child failed: %+v", d.Current.Failure)
		}
		found := false
		for _, i := range d.Current.Items {
			found = found || i.Activity != nil && i.Activity.ToolName == "terminal.exec" && string(i.Activity.Status) == "success"
		}
		if !found {
			f.t.Fatal("child did not execute terminal task")
		}
	}
	f.report["children"] = children
	f.finish("subagent-followup", "Use subagents list and inspect the two completed children. Send a follow-up input to Left Audit asking it to use terminal.exec to calculate 36*2 and report LEFT_DOUBLE=72. Wait for its new complete handoff, then report LEFT_DOUBLE=72. Do not spawn new children.", "LEFT_DOUBLE=72")
	if len(f.children()) != 2 {
		f.t.Fatal("follow-up duplicated children")
	}
}

func ollamaTaskSubagentHistory(f *ollamaTaskFixture) {
	f.finish("history-seed", "This is a synthetic conversation-history test. The fictional release codename is LIFECYCLE_FACT_AMBER_731. It is a non-sensitive fixture label that a later task will refer to within this conversation only; no permanent memory or file storage is requested. Reply exactly REMEMBERED without tools or questions.", "REMEMBERED")
	d := f.finish("history-child", "Use subagents to spawn exactly one worker named History Audit with full_history context. Ask it to recover the release codename only from inherited conversation messages, never by reading other files. It must use terminal.exec only to write exactly that codename with no trailing newline into inherited.txt in the current directory and verify that file. Do not include the codename in the mission message. Do not call terminal.exec yourself. Wait for its handoff and report HISTORY_SAVED.", "HISTORY_SAVED")
	f.file("inherited.txt", "LIFECYCLE_FACT_AMBER_731")
	children := f.children()
	if len(children) != 1 {
		f.t.Fatalf("full-history children=%d", len(children))
	}
	child, err := f.svc.GetFlowerSubagentDetail(f.ctx, f.meta, f.threadID, children[0].ID.String())
	if err != nil {
		f.t.Fatal(err)
	}
	inherited, mission, executed := false, false, false
	for _, item := range child.Current.Items {
		if item.Kind == flruntime.ThreadItemUser {
			if item.TurnID == child.Current.TurnID {
				mission = true
				if strings.Contains(item.Text, "LIFECYCLE_FACT_AMBER_731") {
					f.t.Fatal("child mission leaked the inherited fact")
				}
			} else {
				inherited = inherited || strings.Contains(item.Text, "LIFECYCLE_FACT_AMBER_731")
			}
		}
		executed = executed || item.TurnID == child.Current.TurnID && item.Activity != nil && item.Activity.ToolName == "terminal.exec" && string(item.Activity.Status) == "success"
	}
	if !inherited || !mission || !executed || child.Current.LastOutcome == nil || *child.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
		f.t.Fatal("child did not complete a tool task from inherited history")
	}
	for _, item := range d.Current.Items {
		if item.Activity != nil && item.Activity.ToolName == "terminal.exec" {
			f.t.Fatal("parent performed the child's file task")
		}
	}
	f.report["history_inherited_without_mission_leak"] = true
	f.finish("history-close", "Use subagents close on History Audit, then list the children and report HISTORY_CLOSED. Do not spawn children or delete conversation history.", "HISTORY_CLOSED")
	if len(f.children()) != 1 {
		f.t.Fatal("closing a child deleted its conversation")
	}
}

func ollamaTaskSubagentInterrupt(f *ollamaTaskFixture) {
	f.finish("child-steer", fmt.Sprintf("Use subagents to spawn exactly one worker named Slow Audit with mission_only context. Its mission is to execute terminal.exec with yield_ms 30000 and command 'printf STARTED > %s/child-started.txt; sleep 30; printf OLD > %s/child-old.txt', then report OLD. After spawning, use terminal.exec yourself to wait until %s/child-started.txt exists (a bounded shell loop). Then immediately call subagents send_input on that child's returned thread_id with interrupt true and message: 'The old task is cancelled. Use terminal.exec to write exactly STEERED into %s/child-new.txt and report STEERED. Do not run the old command again.' Wait for the child and report STEERED. Do not create a second child.", f.root, f.root, f.root, f.root), "STEERED")
	f.file("child-started.txt", "STARTED")
	f.file("child-new.txt", "STEERED")
	f.missing("child-old.txt")
	if len(f.children()) != 1 {
		f.t.Fatal("child interrupt duplicated child")
	}
}

func ollamaTaskParentStop(f *ollamaTaskFixture) {
	f.send("parent-stop", fmt.Sprintf("Use subagents to spawn one worker named Pending Audit with mission_only context. The child must execute terminal.exec with yield_ms 30000 and command 'printf STARTED > %s/parent-child-started.txt; sleep 30; printf OLD > %s/parent-child-old.txt', then report OLD. After spawning call subagents wait for the child with timeout_ms 120000.", f.root, f.root))
	f.wait("child running", func(*FlowerThreadDetail) bool {
		_, err := os.Stat(filepath.Join(f.root, "parent-child-started.txt"))
		return err == nil
	})
	f.stop()
	f.terminal(flruntime.TurnOutcomeCancelled)
	f.missing("parent-child-old.txt")
	children := f.children()
	if len(children) != 1 {
		f.t.Fatal("expected one active delegated child")
	}
	f.wait("children stopped", func(*FlowerThreadDetail) bool {
		for _, child := range children {
			v, err := f.svc.threadRuntime.View(f.ctx, child.ID)
			if err != nil {
				f.t.Fatal(err)
			}
			if v.Activity != flruntime.ThreadActivityIdle {
				return false
			}
			if v.LastOutcome == nil || *v.LastOutcome != flruntime.TurnOutcomeCancelled {
				f.t.Fatalf("child outcome=%v failure=%+v", v.LastOutcome, v.Failure)
			}
		}
		return true
	})
	f.missing("parent-child-old.txt")
	f.finish("parent-stop-new", "The delegated task is cancelled. Reply exactly PARENT_RECOVERED without tools.", "PARENT_RECOVERED")
}

type ollamaTaskFault struct {
	server         *httptest.Server
	mu             sync.Mutex
	mode           string
	afterTool      string
	hit, unblock   chan struct{}
	canceled, cuts int
}

func (p *ollamaTaskFault) arm(mode string) { p.armAfterTool(mode, "") }
func (p *ollamaTaskFault) armAfterTool(mode, marker string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.mode = mode
	p.afterTool = marker
	p.hit = make(chan struct{})
	p.unblock = make(chan struct{})
}
func (p *ollamaTaskFault) release() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.unblock != nil {
		select {
		case <-p.unblock:
		default:
			close(p.unblock)
		}
	}
}
func (p *ollamaTaskFault) waitHit(t *testing.T) {
	t.Helper()
	p.mu.Lock()
	hit := p.hit
	p.mu.Unlock()
	select {
	case <-hit:
	case <-time.After(90 * time.Second):
		t.Fatal("real provider did not reach fault boundary")
	}
}
func (p *ollamaTaskFault) snapshot() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{"canceled": p.canceled, "stream_cuts": p.cuts}
}
func newOllamaTaskFault(t *testing.T, base string) *ollamaTaskFault {
	p := &ollamaTaskFault{}
	client := &http.Client{Timeout: 6 * time.Minute}
	p.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read request", 400)
			return
		}
		var input struct {
			Tools    []json.RawMessage `json:"tools"`
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(body, &input)
		mode := ""
		var hit, unblock chan struct{}
		if len(input.Tools) > 0 {
			p.mu.Lock()
			eligible := p.afterTool == ""
			for _, m := range input.Messages {
				if m.Role == "tool" && bytes.Contains(m.Content, []byte(p.afterTool)) {
					eligible = true
				}
			}
			if eligible {
				mode, hit, unblock = p.mode, p.hit, p.unblock
				p.mode = ""
			}
			p.mu.Unlock()
		}
		u, err := http.NewRequestWithContext(r.Context(), r.Method, base+r.URL.RequestURI(), bytes.NewReader(body))
		if err != nil {
			http.Error(w, "create request", 502)
			return
		}
		u.Header = r.Header.Clone()
		resp, err := client.Do(u)
		if err != nil {
			http.Error(w, "upstream unavailable", 502)
			return
		}
		defer resp.Body.Close()
		for k, vs := range resp.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		if mode == "" {
			if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
				s := bufio.NewScanner(resp.Body)
				s.Buffer(make([]byte, 4096), 1<<20)
				for s.Scan() {
					fmt.Fprintln(w, s.Text())
					w.(http.Flusher).Flush()
				}
			} else {
				_, _ = io.Copy(w, resp.Body)
			}
			return
		}
		s := bufio.NewScanner(resp.Body)
		s.Buffer(make([]byte, 4096), 1<<20)
		hasDelta := false
		for s.Scan() {
			line := s.Text()
			fmt.Fprintln(w, line)
			w.(http.Flusher).Flush()
			if strings.HasPrefix(line, "data: ") {
				var chunk struct {
					Choices []struct {
						Delta struct {
							Content          string `json:"content"`
							Reasoning        string `json:"reasoning"`
							ReasoningContent string `json:"reasoning_content"`
						} `json:"delta"`
					} `json:"choices"`
				}
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &chunk) == nil {
					for _, choice := range chunk.Choices {
						hasDelta = hasDelta || choice.Delta.Content != "" || mode != "hold_content" && (choice.Delta.Reasoning != "" || choice.Delta.ReasoningContent != "")
					}
				}
			}
			// Pause only after the original event delimiter. Adding a second
			// delimiter would corrupt the provider stream when it resumes.
			if line == "" && hasDelta {
				close(hit)
				if mode == "cut" {
					p.mu.Lock()
					p.cuts++
					p.mu.Unlock()
					conn, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				select {
				case <-r.Context().Done():
					p.mu.Lock()
					p.canceled++
					p.mu.Unlock()
					return
				case <-unblock:
				}
				mode = ""
				break
			}
		}
		for s.Scan() {
			fmt.Fprintln(w, s.Text())
			w.(http.Flusher).Flush()
		}
	}))
	t.Cleanup(func() { p.release(); p.server.Close() })
	return p
}
