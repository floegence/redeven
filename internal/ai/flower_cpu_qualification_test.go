package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// This explicit qualification fixture is compiled unchanged against each frozen
// product revision. It never synthesizes runtime views or bypasses persistence.
func TestFlowerCPUQualification(t *testing.T) {
	if os.Getenv("REDEVEN_CPU_QUALIFICATION") != "1" {
		t.Skip("explicit runtime and renderer performance qualification")
	}
	state := os.Getenv("REDEVEN_CPU_STATE")
	if state == "" {
		state = t.TempDir()
	}
	if err := os.MkdirAll(state, 0700); err != nil {
		t.Fatal(err)
	}
	if entries, readErr := os.ReadDir(state); readErr != nil {
		t.Fatal(readErr)
	} else if len(entries) != 0 {
		t.Fatal("qualification requires a fresh empty state directory; preserve earlier evidence and choose a new directory")
	}
	configValue := &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}
	service, err := NewServiceContext(t.Context(), Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: configValue, DeferExecution: true, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	meta := testSendTurnMeta()
	var produced atomic.Int64
	var ready atomic.Bool
	var running atomic.Bool
	var wireBytes atomic.Int64
	var generations atomic.Int64
	var hz atomic.Int64
	hz.Store(40)
	var mode atomic.Value
	mode.Store("mixed")
	var initialBytes atomic.Int64
	var sequence atomic.Int64
	type outputEvidence struct {
		index     int
		nextAt    time.Time
		text      strings.Builder
		reasoning strings.Builder
		timings   map[int]int64
	}
	var evidenceMu sync.Mutex
	evidence := make(map[identity.RunID]*outputEvidence)
	latestRuns := make(map[string]identity.RunID)
	done := make(chan struct{})
	stopFixture := sync.OnceFunc(func() { close(done) })
	t.Cleanup(stopFixture)
	tool := fltools.Define[struct{}](fltools.Definition{Name: "qualification_inspect", ReadOnly: true, InputSchema: fltools.StrictObject(map[string]any{}, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}, Activity: func(fltools.Invocation[any]) (*fltools.ActivityPresentation, error) {
		return &fltools.ActivityPresentation{Label: "Inspect evidence", Renderer: fltools.ActivityRendererTerminal, Payload: fltools.TerminalActivityPayload{Operation: "exec", Command: "inspect", Output: strings.Repeat("Completed inspection. ", 100), Status: "success"}}, nil
	}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
		return fltools.Result{Text: "Inspection complete."}, nil
	})
	makeAgent := func(gateway flprovider.Gateway) *flruntime.Agent {
		agent, e := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "qualification", Name: "Qualification"}, SystemPrompt: "Preserve all evidence.", Context: flconfig.ContextPolicy{ContextWindowTokens: 10000000}}, gateway, flruntime.WithAgentLoopLimits(flruntime.LoopLimits{DuplicateToolLimit: 10000, NoProgressLimit: 10000, WallTime: time.Hour}), flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
		if e != nil {
			t.Fatal(e)
		}
		return agent
	}
	send := func(id string, key string, agent *flruntime.Agent, text string) error {
		service.floretEffects.put(identity.ThreadID(id), key, floretEffectRequest{agent: agent, meta: *meta, req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
		_, e := service.threadRuntime.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(id), RequestKey: flruntime.RequestKey(key), Input: flruntime.UserInput{Text: text}})
		return e
	}
	created, err := service.CreateThread(t.Context(), meta, "CPU qualification", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	rootID := created.ThreadID
	var ids = []string{rootID}
	childDetail := os.Getenv("REDEVEN_CPU_CHILD_DETAIL") == "1"
	var visitedRoots []string
	if childDetail {
		for index := range 11 {
			root, e := service.CreateThread(t.Context(), meta, fmt.Sprintf("Visited root %d", index), "", "", "")
			if e != nil {
				t.Fatal(e)
			}
			visitedRoots = append(visitedRoots, root.ThreadID)
		}
		visitedRoots = append(visitedRoots, rootID)
	}
	var configureMu sync.Mutex
	summaryReader := service.threadRuntime.(flruntime.ThreadSummaryReader)
	waitIdle := func(id string) error {
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			s, e := summaryReader.Summary(t.Context(), identity.ThreadID(id))
			if e != nil {
				return e
			}
			if s.Activity == flruntime.ThreadActivityIdle {
				return nil
			}
			time.Sleep(time.Millisecond)
		}
		return fmt.Errorf("seed did not finish")
	}
	seed := func(count int) error {
		for i := 0; i < count; i++ {
			serial := sequence.Add(1)
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "qualification", StateCompatibilityKey: "qualification:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
				florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: fmt.Sprintf("a-%d", serial), Name: "qualification_inspect", Args: "{}"}, {ID: fmt.Sprintf("b-%d", serial), Name: "qualification_inspect", Args: "{}"}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}},
				florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: qualificationHistoryResponse(int(serial))}, {Type: flprovider.EventDone, Reason: "stop"}}})
			if e := send(rootID, fmt.Sprintf("seed-%d", serial), makeAgent(gateway), fmt.Sprintf("Historical request %d", serial)); e != nil {
				return e
			}
			if e := waitIdle(rootID); e != nil {
				return e
			}
			view, e := service.threadRuntime.View(t.Context(), identity.ThreadID(rootID))
			if e != nil {
				return e
			}
			if e := verifyQualificationHistory(view, int(serial)); e != nil {
				return fmt.Errorf("seed %d: %w", serial, e)
			}
		}
		return nil
	}
	historyTurns := 100
	if value, parseErr := strconv.Atoi(os.Getenv("REDEVEN_CPU_HISTORY_TURNS")); parseErr == nil && value > 0 {
		historyTurns = value
	}
	if err = seed(historyTurns); err != nil {
		t.Fatal(err)
	}
	ready.Store(true)
	if os.Getenv("REDEVEN_CPU_SEED_ONLY") == "1" {
		t.Logf("verified %d successful turns, %d messages, and %d completed Activities", historyTurns, 2*historyTurns, 2*historyTurns)
		return
	}
	gateway := testFloretGatewayFunc(func(ctx context.Context, request flprovider.Request) (<-chan flprovider.Event, error) {
		evidenceMu.Lock()
		latestRuns[string(request.ThreadID)] = request.RunID
		output := evidence[request.RunID]
		if output == nil {
			output = &outputEvidence{timings: make(map[int]int64)}
			evidence[request.RunID] = output
		}
		evidenceMu.Unlock()
		events := make(chan flprovider.Event, 1)
		go func() {
			defer close(events)
			evidenceMu.Lock()
			firstOutput := output.index == 0
			evidenceMu.Unlock()
			if size := initialBytes.Load(); size > 0 && firstOutput {
				prefix := strings.Repeat("x", int(size))
				if mode.Load() == "code" {
					prefix = "```text\n" + prefix
				}
				select {
				case events <- flprovider.Event{Type: flprovider.EventDelta, Text: prefix}:
					evidenceMu.Lock()
					output.text.WriteString(prefix)
					evidenceMu.Unlock()
				case <-ctx.Done():
					return
				}
			}
			interval := time.Second / time.Duration(hz.Load())
			timer := time.NewTimer(interval)
			defer timer.Stop()
			for {
				evidenceMu.Lock()
				if output.nextAt.IsZero() {
					output.nextAt = time.Now().Add(interval)
				}
				deadline := output.nextAt
				evidenceMu.Unlock()
				timer.Reset(max(0, time.Until(deadline)))
				select {
				case <-ctx.Done():
					return
				case <-timer.C:
					if !running.Load() {
						// A final provider response must contain an answer. Empty done
						// responses intentionally trigger the engine's no-output recovery.
						const final = "\nQualification complete."
						select {
						case events <- flprovider.Event{Type: flprovider.EventDelta, Text: final}:
							evidenceMu.Lock()
							output.text.WriteString(final)
							evidenceMu.Unlock()
						case <-ctx.Done():
							return
						}
						select {
						case events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}:
						case <-ctx.Done():
						}
						return
					}
					evidenceMu.Lock()
					// Tool responses share this run's absolute schedule. Starting
					// another provider request must not silently lower its rate.
					output.nextAt = output.nextAt.Add(interval)
					output.index++
					index := output.index
					output.timings[index] = time.Now().UnixMilli()
					evidenceMu.Unlock()
					if mode.Load() == "mixed" && index%400 == 0 {
						select {
						case events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: fmt.Sprintf("live-%d", index), Name: "qualification_inspect", Args: "{}"}}}:
						case <-ctx.Done():
							return
						}
						select {
						case events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}:
						case <-ctx.Done():
						}
						produced.Add(1)
						return
					}
					kind := flprovider.EventDelta
					if mode.Load() == "mixed" && index%400 < 40 {
						kind = flprovider.EventReasoning
					}
					value := fmt.Sprintf("word%06d ", index)
					pattern := index % 160
					if mode.Load() != "mixed" {
						pattern = -1
					}
					switch pattern {
					case 20:
						value = "\n\n## Live section\n\n"
					case 40:
						value = "\n\n| Key | Value |\n| --- | --- |\n| CPU | bounded |\n\n"
					case 80:
						value = "\n\n~~~ts\nconst x = 1;\n"
					case 100:
						value = "\n~~~\n\n"
					}
					select {
					case events <- flprovider.Event{Type: kind, Text: value}:
						evidenceMu.Lock()
						if kind == flprovider.EventReasoning {
							output.reasoning.WriteString(value)
						} else {
							output.text.WriteString(value)
						}
						evidenceMu.Unlock()
						produced.Add(1)
					case <-ctx.Done():
						return
					}
				}
			}
		}()
		return events, nil
	})
	mux := http.NewServeMux()
	encode := func(w http.ResponseWriter, value any) {
		w.Header().Set("Content-Type", "application/json")
		if e := json.NewEncoder(w).Encode(value); e != nil {
			t.Errorf("encode fixture: %v", e)
		}
	}
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("op") {
		case "setup":
			encode(w, map[string]any{"threads": ids, "pid": os.Getpid(), "state": state, "ready": ready.Load(), "generation": generations.Load(), "history_turns": historyTurns, "history_messages": 2 * historyTurns, "history_completed_activities": 2 * historyTurns, "history_verified": true})
		case "list":
			value, e := service.ListThreads(r.Context(), meta, 200, "")
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			encode(w, value)
		case "detail":
			value, e := service.GetFlowerThreadDetail(r.Context(), meta, r.URL.Query().Get("id"))
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			encode(w, value)
		case "configure":
			configureMu.Lock()
			defer configureMu.Unlock()
			if running.Load() {
				http.Error(w, "stop before configure", 409)
				return
			}
			count, _ := strconv.Atoi(r.URL.Query().Get("threads"))
			if count < 1 || count > 7 {
				http.Error(w, "threads must be 1..7", 400)
				return
			}
			rate, _ := strconv.Atoi(r.URL.Query().Get("hz"))
			if rate < 1 || rate > 200 {
				http.Error(w, "hz must be 1..200", 400)
				return
			}
			hz.Store(int64(rate))
			pattern := r.URL.Query().Get("mode")
			if pattern == "" {
				pattern = "mixed"
			}
			if pattern != "mixed" && pattern != "plain" && pattern != "code" {
				http.Error(w, "invalid workload mode", 400)
				return
			}
			size, _ := strconv.ParseInt(r.URL.Query().Get("initial_bytes"), 10, 64)
			if size < 0 || size > 1<<20 {
				http.Error(w, "initial bytes must be 0..1MiB", 400)
				return
			}
			mode.Store(pattern)
			initialBytes.Store(size)
			// Each measurement forks the untouched seed. Prior live output must not
			// change history size between alternating baseline/candidate rounds.
			for _, id := range ids[1:] {
				if e := service.DeleteThread(r.Context(), meta, id, false); e != nil {
					http.Error(w, e.Error(), 500)
					return
				}
			}
			ids = ids[:1]
			evidenceMu.Lock()
			clear(evidence)
			clear(latestRuns)
			evidenceMu.Unlock()
			for len(ids) <= count {
				var childID string
				var e error
				if childDetail {
					seedView, readErr := service.threadRuntime.View(r.Context(), identity.ThreadID(rootID))
					if readErr != nil {
						http.Error(w, readErr.Error(), 500)
						return
					}
					child, forkErr := service.threadRuntime.Fork(r.Context(), flruntime.ForkThreadInput{
						SourceThreadID: identity.ThreadID(rootID), ParentThreadID: identity.ThreadID(rootID), ParentTurnID: seedView.Turns[len(seedView.Turns)-1].TurnID,
						TaskName: "Inspect retained work", TaskDescription: "Verify canonical child detail under load.", HostProfileRef: subagentAgentTypeWorker,
						ForkMode: subagentContextModeFullHistory, RequestKey: flruntime.RequestKey(fmt.Sprintf("cpu-child-%d", sequence.Add(1))),
					})
					e = forkErr
					childID = child.ThreadID.String()
					if e == nil {
						e = service.ensureChildThreadSettings(r.Context(), &run{threadID: rootID, endpointID: meta.EndpointID, permissionType: FlowerPermissionApprovalRequired}, childID, rootID, subagentAgentTypeWorker)
					}
				} else {
					fork, forkErr := service.ForkThread(r.Context(), meta, rootID, fmt.Sprintf("CPU qualification %d", len(ids)))
					e = forkErr
					if e == nil {
						childID = fork.ThreadID
					}
				}
				if e != nil {
					http.Error(w, e.Error(), 500)
					return
				}
				ids = append(ids, childID)
			}
			encode(w, map[string]any{"threads": ids[1 : count+1], "hz": rate, "mode": pattern, "initial_bytes": size, "parent_thread": rootID, "visited_roots": visitedRoots, "child_detail": childDetail})
		case "subagent_detail":
			value, e := service.GetFlowerSubagentDetail(r.Context(), meta, rootID, r.URL.Query().Get("id"))
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			encode(w, map[string]any{"detail": value})
		case "start":
			configureMu.Lock()
			defer configureMu.Unlock()
			if running.Swap(true) {
				http.Error(w, "already generating", 409)
				return
			}
			count, _ := strconv.Atoi(r.URL.Query().Get("threads"))
			if count < 1 || count >= len(ids) {
				running.Store(false)
				http.Error(w, "configure first", 400)
				return
			}
			generation := generations.Add(1)
			produced.Store(0)
			wireBytes.Store(0)
			for _, id := range ids[1 : count+1] {
				if e := send(id, fmt.Sprintf("live-%d-%s", generation, id), makeAgent(gateway), "Generate complete live Markdown evidence."); e != nil {
					http.Error(w, e.Error(), 500)
					return
				}
			}
			encode(w, true)
		case "stop":
			running.Store(false)
			for _, id := range ids {
				if e := waitIdle(id); e != nil {
					http.Error(w, e.Error(), 500)
					return
				}
			}
			encode(w, true)
		case "cancel":
			value, e := service.StopThread(r.Context(), meta, r.URL.Query().Get("id"))
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			encode(w, value)
		case "stats":
			if r.URL.Query().Get("gc") == "1" {
				runtime.GC()
			}
			var memory runtime.MemStats
			runtime.ReadMemStats(&memory)
			service.mu.Lock()
			subscribers, queued := len(service.flowerLiveSubscribers), service.flowerLiveQueuedBytes
			service.mu.Unlock()
			evidenceMu.Lock()
			threadUpdates := make(map[string]int, len(latestRuns))
			for id, run := range latestRuns {
				threadUpdates[id] = evidence[run].index
			}
			evidenceMu.Unlock()
			encode(w, map[string]any{"produced": produced.Load(), "thread_updates": threadUpdates, "wire_bytes": wireBytes.Load(), "goroutines": runtime.NumGoroutine(), "heap_bytes": memory.HeapAlloc, "alloc_bytes": memory.TotalAlloc, "subscribers": subscribers, "queued_bytes": queued})
		case "grow_history":
			configureMu.Lock()
			defer configureMu.Unlock()
			count, e := strconv.Atoi(r.URL.Query().Get("turns"))
			if e != nil || count < historyTurns || count > 1000 || running.Load() {
				http.Error(w, "history must grow while idle to at most 1000 turns", 400)
				return
			}
			if e = seed(count - historyTurns); e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			historyTurns = count
			encode(w, true)
		case "evidence":
			current, e := service.threadRuntime.View(r.Context(), identity.ThreadID(r.URL.Query().Get("id")))
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			evidenceMu.Lock()
			defer evidenceMu.Unlock()
			runID := latestRuns[string(current.ThreadID)]
			output := evidence[runID]
			if output == nil {
				http.Error(w, "no generated output", 409)
				return
			}
			var prose, reasoning strings.Builder
			var values []flruntime.ThreadItem
			for _, item := range current.Items {
				if item.RunID != runID {
					continue
				}
				values = append(values, item)
				if item.Kind == flruntime.ThreadItemAssistant {
					prose.WriteString(item.Text)
				}
				if item.Kind == flruntime.ThreadItemThinking {
					reasoning.WriteString(item.Text)
				}
			}
			encode(w, map[string]any{"items": values, "run_id": runID, "text": output.text.String(), "reasoning": output.reasoning.String(), "exact_text": prose.String() == output.text.String(), "exact_reasoning": reasoning.String() == output.reasoning.String(), "updates": output.index, "timings": output.timings})
		case "quit":
			running.Store(false)
			encode(w, true)
			stopFixture()
		default:
			http.NotFound(w, r)
		}
	})
	mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		sub, e := service.SubscribeFlowerLiveStream(r.Context(), meta, FlowerLiveStreamRequest{})
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		defer sub.Close()
		w.Header().Set("Content-Type", "application/x-ndjson")
		for {
			frame, e := sub.Next(r.Context())
			if e != nil {
				return
			}
			wireBytes.Add(int64(len(frame.Data)))
			if _, e = w.Write(append(frame.Data, '\n')); e != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	})
	mux.Handle("/", http.FileServer(http.Dir(os.Getenv("REDEVEN_CPU_DIST"))))
	server := httptest.NewServer(mux)
	defer server.Close()
	info := map[string]any{"url": server.URL, "pid": os.Getpid(), "state": state, "thread": rootID}
	data, _ := json.Marshal(info)
	if err = os.WriteFile(filepath.Join(state, "fixture.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Log(string(data))
	select {
	case <-done:
	case <-t.Context().Done():
		t.Fatal(t.Context().Err())
	}
}

// Qualification must verify actual canonical facts, not infer success from idle.
// This read happens only while seeding, outside every measured interval.
func verifyQualificationHistory(view flruntime.ThreadView, turns int) error {
	if len(view.Turns) != turns {
		return fmt.Errorf("historical turns=%d, want %d", len(view.Turns), turns)
	}
	byTurn := make(map[identity.TurnID][]flruntime.ThreadItem, turns)
	for _, item := range view.Items {
		byTurn[item.TurnID] = append(byTurn[item.TurnID], item)
	}
	for index, turn := range view.Turns {
		if turn.Outcome == nil || *turn.Outcome != flruntime.TurnOutcomeCompleted || !turn.FinalBoundaryComplete {
			return fmt.Errorf("historical turn %d did not complete successfully: %+v", index+1, turn)
		}
		users, assistants, activities := 0, 0, 0
		for _, item := range byTurn[turn.TurnID] {
			if item.Live {
				return fmt.Errorf("historical turn %d contains live item %s", index+1, item.ID)
			}
			switch item.Kind {
			case flruntime.ThreadItemUser:
				users++
				if item.Text != fmt.Sprintf("Historical request %d", index+1) {
					return fmt.Errorf("historical turn %d has unexpected user content", index+1)
				}
			case flruntime.ThreadItemAssistant:
				assistants++
				if item.Text != qualificationHistoryResponse(index+1) {
					return fmt.Errorf("historical turn %d has incomplete assistant content", index+1)
				}
			case flruntime.ThreadItemTool:
				if item.Activity == nil || item.Activity.Status != "success" {
					return fmt.Errorf("historical turn %d has incomplete activity %s", index+1, item.ID)
				}
				activities++
			default:
				return fmt.Errorf("historical turn %d has unexpected item kind %s", index+1, item.Kind)
			}
		}
		if users != 1 || assistants != 1 || activities != 2 {
			return fmt.Errorf("historical turn %d: users=%d assistants=%d completed activities=%d, want 1/1/2", index+1, users, assistants, activities)
		}
	}
	return nil
}

func qualificationHistoryResponse(serial int) string {
	return fmt.Sprintf("Historical response %d.\n\n", serial) + strings.Repeat("Verified history with **Markdown** and 中文 content. ", 12)
}

func TestQualificationHistoryRejectsIncompleteSeeds(t *testing.T) {
	completed := flruntime.TurnOutcomeCompleted
	valid := func() flruntime.ThreadView {
		return flruntime.ThreadView{
			Turns: []flruntime.ThreadTurn{{TurnID: "turn-1", Outcome: &completed, FinalBoundaryComplete: true}},
			Items: []flruntime.ThreadItem{
				{TurnID: "turn-1", Kind: flruntime.ThreadItemUser, Text: "Historical request 1"},
				{TurnID: "turn-1", Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{Status: observation.ActivityStatusSuccess}},
				{TurnID: "turn-1", Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{Status: observation.ActivityStatusSuccess}},
				{TurnID: "turn-1", Kind: flruntime.ThreadItemAssistant, Text: qualificationHistoryResponse(1)},
			},
		}
	}
	if err := verifyQualificationHistory(valid(), 1); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name      string
		breakView func(*flruntime.ThreadView)
	}{
		{"failed idle turn", func(view *flruntime.ThreadView) {
			failed := flruntime.TurnOutcomeFailed
			view.Turns[0].Outcome = &failed
		}},
		{"missing terminal outcome", func(view *flruntime.ThreadView) { view.Turns[0].Outcome = nil }},
		{"missing final boundary", func(view *flruntime.ThreadView) { view.Turns[0].FinalBoundaryComplete = false }},
		{"missing assistant", func(view *flruntime.ThreadView) { view.Items = view.Items[:3] }},
		{"partial assistant", func(view *flruntime.ThreadView) { view.Items[3].Text = "partial" }},
		{"incomplete activity", func(view *flruntime.ThreadView) { view.Items[1].Activity.Status = observation.ActivityStatusRunning }},
		{"missing activity", func(view *flruntime.ThreadView) { view.Items[1].Activity = nil }},
		{"live historical item", func(view *flruntime.ThreadView) { view.Items[3].Live = true }},
		{"wrong turn identity", func(view *flruntime.ThreadView) { view.Items[3].TurnID = "other" }},
		{"missing turn", func(view *flruntime.ThreadView) { view.Turns = nil }},
	} {
		t.Run(test.name, func(t *testing.T) {
			view := valid()
			test.breakView(&view)
			if err := verifyQualificationHistory(view, 1); err == nil {
				t.Fatal("invalid history was accepted for qualification")
			}
		})
	}
}
