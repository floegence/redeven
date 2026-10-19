package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
)

func TestFlowerContextProjectionEncodesEmptyModelContextListsWithoutMutatingCanonical(t *testing.T) {
	canonical := &flruntime.ThreadModelContext{EntryID: "context-entry", PathDepth: 1, TurnID: "turn-context", RunID: "run-context"}
	current := flruntime.ThreadView{ThreadID: "thread-context", Context: &flruntime.ThreadContextSnapshot{ModelContext: canonical}}
	data, err := marshalFlowerContextJSON(struct{}{}, current)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		ModelContext struct {
			Snapshot struct {
				Sections json.RawMessage `json:"sections"`
			} `json:"snapshot"`
			ChangedKeys json.RawMessage `json:"changed_keys"`
			RemovedKeys json.RawMessage `json:"removed_keys"`
		} `json:"model_context"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]json.RawMessage{
		"sections":     wire.ModelContext.Snapshot.Sections,
		"changed_keys": wire.ModelContext.ChangedKeys,
		"removed_keys": wire.ModelContext.RemovedKeys,
	} {
		if string(value) != "[]" {
			t.Errorf("%s=%s, want an empty array", name, value)
		}
	}
	if canonical.Snapshot.Sections != nil || canonical.ChangedKeys != nil || canonical.RemovedKeys != nil {
		t.Fatal("product projection mutated its canonical snapshot")
	}
}

func TestPublishedFloretUsageReachesLiveAndCanonicalFlowerProjections(t *testing.T) {
	liveUsage := make(chan FlowerContextUsage, 8)
	release := make(chan struct{})
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "cache-usage", StateCompatibilityKey: "test:cache-usage:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventUsage, Usage: flprovider.Usage{
				InputTokens: 60, OutputTokens: 20, CacheReadTokens: 35, CacheWriteTokens: 5,
				WindowInputTokens: 100, TotalTokens: 120, Source: "native", Available: true,
			}},
			{Type: flprovider.EventDelta, Text: "done"},
			{Type: flprovider.EventDone, Reason: "stop"},
		}},
		florettest.Step{BlockUntil: release, Events: []flprovider.Event{
			{Type: flprovider.EventUsage, Usage: flprovider.Usage{
				InputTokens: 40, OutputTokens: 10, CacheReadTokens: 50,
				WindowInputTokens: 90, TotalTokens: 100, Source: "native", Available: true,
			}},
			{Type: flprovider.EventDelta, Text: "done again"},
			{Type: flprovider.EventDone, Reason: "stop"},
		}},
	)
	agentConfig := config.AgentConfig{
		Profile:      config.AgentProfile{ID: "cache-usage", Name: "Cache Usage"},
		SystemPrompt: "Test canonical cache usage.",
		Context:      config.ContextPolicy{ContextWindowTokens: config.DefaultContextWindowTokens},
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(_ context.Context, request flruntime.AgentRequest) (*flruntime.Agent, error) {
		return flruntime.NewAgent(agentConfig, gateway, flruntime.WithAgentDynamicToolSurface(func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
			return flruntime.ToolSurface{ModelContextSnapshot: &flruntime.ModelContextSnapshot{Sections: []flruntime.ModelContextSection{{Key: "skills", Title: "Available skills", Text: "Test skill catalog"}}}}, nil
		}))
	}))
	if err != nil {
		t.Fatal(err)
	}
	updates, err := service.Subscribe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { updates.Close() })
	go func() {
		defer close(liveUsage)
		for {
			view, err := updates.Next(t.Context())
			if err != nil {
				return
			}
			projection, err := flowerCurrentContextProjection(view)
			if err != nil {
				return
			}
			if projection.Usage != nil && projection.Usage.ThreadUsage != nil {
				select {
				case liveUsage <- *projection.Usage:
				case <-t.Context().Done():
					return
				}
			}
		}
	}()
	reader := service.(flruntime.ThreadContextReader)
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-cache-usage"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "measure"}, RequestKey: "send-cache-usage",
	}); err != nil {
		t.Fatal(err)
	}
	firstLive := waitForFlowerLiveUsage(t, liveUsage)
	firstWant := FlowerThreadTokenUsage{InputTokens: 60, OutputTokens: 20, CacheReadTokens: 35, CacheWriteTokens: 5}
	if firstLive.ThreadUsage == nil || *firstLive.ThreadUsage != firstWant {
		t.Fatalf("first live thread usage=%#v, want %#v", firstLive.ThreadUsage, firstWant)
	}
	waitForFloretThreadIdle(t, service, created.ThreadID)

	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "measure again"}, RequestKey: "send-cache-usage-again",
	}); err != nil {
		t.Fatal(err)
	}

	if err := gateway.WaitForRequests(t.Context(), 2); err != nil {
		t.Fatal(err)
	}
	pending, err := reader.Context(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	projected, err := flowerThreadContextProjection(pending, flruntime.ThreadView{ThreadID: created.ThreadID})
	if err != nil {
		t.Fatal(err)
	}
	if projected.Usage == nil || projected.Usage.Confirmed == nil || projected.Usage.Confirmed.InputTokens != 100 || projected.Usage.Estimate == nil {
		t.Fatalf("pending context=%+v", projected.Usage)
	}
	// ScriptedGateway supplies semantic budget estimates, not qualified rendered
	// token attribution. Native totals remain visible without historical weights.
	if !projected.Usage.Confirmed.Available || !projected.Usage.Confirmed.Measured || projected.Usage.Confirmed.Characters != nil || projected.Usage.Confirmed.CharactersAvailable {
		t.Fatalf("unqualified attribution reached display: %+v", projected.Usage.Confirmed)
	}
	close(release)
	var secondLive FlowerContextUsage
	for {
		secondLive = waitForFlowerLiveUsage(t, liveUsage)
		if secondLive.ThreadUsage != nil && secondLive.ThreadUsage.InputTokens == 100 {
			break
		}
	}
	secondWant := FlowerThreadTokenUsage{InputTokens: 100, OutputTokens: 30, CacheReadTokens: 85, CacheWriteTokens: 5}
	if secondLive.ThreadUsage == nil || *secondLive.ThreadUsage != secondWant {
		t.Fatalf("second live thread usage=%#v, want %#v", secondLive.ThreadUsage, secondWant)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		snapshot, readErr := reader.Context(t.Context(), created.ThreadID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if snapshot.UsageTotals != nil && snapshot.UsageTotals.InputTokens == secondWant.InputTokens {
			projection, projectErr := flowerThreadContextProjection(snapshot, flruntime.ThreadView{ThreadID: created.ThreadID})
			if projectErr != nil {
				t.Fatal(projectErr)
			}
			if projection.Usage == nil || projection.Usage.ThreadUsage == nil || *projection.Usage.ThreadUsage != secondWant {
				t.Fatalf("Flower thread usage=%#v", projection.Usage)
			}
			if *projection.Usage.ThreadUsage != *secondLive.ThreadUsage {
				t.Fatalf("terminal usage=%#v, live usage=%#v", projection.Usage.ThreadUsage, secondLive.ThreadUsage)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("published Floret usage did not reach Flower thread projection")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestFlowerForkDetailPreservesCanonicalContextAcrossRestart(t *testing.T) {
	ctx := context.Background()
	server := newRealtimeTestServer(t, 0)
	stateDir := t.TempDir()
	svc := openRealtimeTestService(t, stateDir, server.URL)
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = svc.Close()
		}
	})
	meta := testSendTurnMeta()

	source, err := svc.CreateThread(ctx, meta, "Fork context source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ClientRequestID: "fork-context-usage", ThreadID: source.ThreadID, Input: RunInput{Text: "Record canonical usage."}}); err != nil {
		t.Fatal(err)
	}
	waitForFloretThreadIdle(t, svc.threadRuntime, identity.ThreadID(source.ThreadID))
	waitForThreadContextUsage(t, svc, source.ThreadID)
	compactQualificationThread(t, ctx, svc, meta, source.ThreadID, "fork-context-compaction")

	sourceDetail, err := svc.GetFlowerThreadDetail(ctx, meta, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	sourceContext := readThreadContextForForkTest(t, svc, source.ThreadID)
	if sourceContext.UsageTotals == nil || sourceContext.UsageTotals.InputTokens == 0 {
		t.Fatalf("source usage totals=%#v, want committed provider usage", sourceContext.UsageTotals)
	}
	if len(sourceContext.Compactions) != 1 || len(sourceDetail.Thread.ContextCompactions) != 1 {
		t.Fatalf("source compactions=(canonical:%d detail:%d), want one", len(sourceContext.Compactions), len(sourceDetail.Thread.ContextCompactions))
	}

	forked, err := svc.ForkThread(ctx, meta, source.ThreadID, "Fork context target")
	if err != nil {
		t.Fatal(err)
	}
	forkDetail, err := svc.GetFlowerThreadDetail(ctx, meta, forked.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	forkContext := readThreadContextForForkTest(t, svc, forked.ThreadID)
	assertForkContextDetail(t, sourceContext, forkContext, forkDetail, forked.ThreadID)

	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	closed = true
	restarted := openRealtimeTestService(t, stateDir, server.URL)
	t.Cleanup(func() { _ = restarted.Close() })
	restartedDetail, err := restarted.GetFlowerThreadDetail(ctx, meta, forked.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	restartedContext := readThreadContextForForkTest(t, restarted, forked.ThreadID)
	assertForkContextDetail(t, sourceContext, restartedContext, restartedDetail, forked.ThreadID)
}

func readThreadContextForForkTest(t *testing.T, svc *Service, threadID string) flruntime.ThreadContextSnapshot {
	t.Helper()
	reader, ok := svc.threadRuntime.(flruntime.ThreadContextReader)
	if !ok {
		t.Fatal("published Floret runtime does not expose ThreadContextReader")
	}
	snapshot, err := reader.Context(t.Context(), identity.ThreadID(threadID))
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func waitForThreadContextUsage(t *testing.T, svc *Service, threadID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		snapshot := readThreadContextForForkTest(t, svc, threadID)
		if snapshot.UsageTotals != nil && snapshot.UsageTotals.InputTokens > 0 {
			return
		}
		if time.Now().After(deadline) {
			view, _ := svc.threadRuntime.View(t.Context(), identity.ThreadID(threadID))
			t.Fatalf("thread %q did not commit provider usage: outcome=%v failure=%v view=%#v", threadID, view.LastOutcome, view.Failure, view)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func assertForkContextDetail(t *testing.T, source flruntime.ThreadContextSnapshot, fork flruntime.ThreadContextSnapshot, detail *FlowerThreadDetail, threadID string) {
	t.Helper()
	if detail == nil || detail.Thread.ThreadID != threadID || detail.Current.ThreadID != identity.ThreadID(threadID) {
		t.Fatalf("fork detail identity=%#v, want thread %q", detail, threadID)
	}
	if source.UsageTotals == nil || fork.UsageTotals == nil || *fork.UsageTotals != *source.UsageTotals {
		t.Fatalf("fork usage totals=%#v, want %#v", fork.UsageTotals, source.UsageTotals)
	}
	if detail.Thread.ContextUsage == nil || detail.Thread.ContextUsage.ThreadUsage == nil {
		t.Fatalf("fork detail usage=%#v, want canonical totals", detail.Thread.ContextUsage)
	}
	if len(source.Compactions) != 1 || len(fork.Compactions) != 1 || len(detail.Thread.ContextCompactions) != 1 {
		t.Fatalf("fork compactions=(source:%d canonical:%d detail:%d), want one", len(source.Compactions), len(fork.Compactions), len(detail.Thread.ContextCompactions))
	}
	sourceCompaction := source.Compactions[0]
	forkCompaction := fork.Compactions[0]
	if forkCompaction.ThreadID != identity.ThreadID(threadID) {
		t.Fatalf("fork context ThreadID=%q, want %q", forkCompaction.ThreadID, threadID)
	}
	if forkCompaction.TurnID != sourceCompaction.TurnID || forkCompaction.RunID != sourceCompaction.RunID || forkCompaction.OperationID != sourceCompaction.OperationID {
		t.Fatalf("fork historical identity=%#v, want TurnID=%q RunID=%q operation=%q", forkCompaction, sourceCompaction.TurnID, sourceCompaction.RunID, sourceCompaction.OperationID)
	}
}

func waitForFlowerLiveUsage(t *testing.T, usage <-chan FlowerContextUsage) FlowerContextUsage {
	t.Helper()
	select {
	case observed := <-usage:
		return observed
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live Flower usage totals")
		return FlowerContextUsage{}
	}
}

func waitForFloretThreadIdle(t *testing.T, service flruntime.ThreadService, threadID identity.ThreadID) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		view, err := service.View(t.Context(), threadID)
		if err != nil {
			t.Fatal(err)
		}
		if view.Activity == flruntime.ThreadActivityIdle {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for Floret thread to become idle")
}

func TestFlowerThreadContextProjectionRestoresOneTerminalCompactionDivider(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	threadID := identity.ThreadID("thread-context")
	turnID := identity.TurnID("turn-context")
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: threadID, TurnID: turnID, Step: 1,
			CanonicalOrdinal: 7, OperationID: "compact-operation", RequestID: "compact-request", AfterItemID: "message-before",
			Phase: "noop", Status: "noop", Trigger: "manual", Reason: "manual",
			Source: "thread_runtime", TokensBefore: 6354, ObservedAt: observedAt,
		}},
	}, flruntime.ThreadView{ThreadID: threadID, Items: []flruntime.ThreadItem{
		{ID: "message-before", Kind: flruntime.ThreadItemUser, TurnID: "turn-before", RunID: "run-before"},
		{ID: "message-compact", Kind: flruntime.ThreadItemUser, TurnID: turnID, RunID: "run-context"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Compactions) != 1 || len(projection.Decorations) != 1 {
		t.Fatalf("compactions=%#v decorations=%#v", projection.Compactions, projection.Decorations)
	}
	if got := projection.Compactions[0]; got.OperationID != "compact-operation" || got.Status != "noop" || got.UpdatedAtMs != observedAt.UnixMilli() {
		t.Fatalf("compaction=%#v", got)
	}
	if got := projection.Decorations[0]; got.DecorationID != "context-compaction:compact-operation" || got.Anchor.MessageID != "message-before" || got.Anchor.Edge != "after" {
		t.Fatalf("decoration=%#v", got)
	}
}

func TestFlowerThreadContextProjectionIncludesCanonicalUsage(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		ContextUsage: &flruntime.ThreadContextUsage{Confirmed: &observation.ContextStatus{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-context", Step: 2,
			Phase: observation.ContextPhaseProviderUsage, ObservedAt: observedAt,
			Provider: "test", Model: "test", RequestID: "request-context", PayloadFingerprint: "fingerprint-context",
			Usage:           observation.ProviderUsage{Available: true, Source: "native", WindowInputTokens: 500, InputTokens: 30, CacheReadTokens: 60, CacheWriteTokens: 10},
			RequestEstimate: config.RequestEstimate{Characters: &config.ContextCharacterBreakdown{Source: "prepared_characters_v1", Unit: "unicode_code_points", TotalCharacters: 240, Categories: []config.ContextCharacterCategory{{Category: "tool_result", Characters: 200}, {Category: "tool_call", Characters: 40}}}},
			ContextPressure: config.ContextPressure{ContextWindowTokens: 1000},
			UsedRatio:       0.5, Status: observation.ContextStatusStable,
		}},
		UsageTotals: &flruntime.ThreadTokenUsageTotals{
			InputTokens: 120, OutputTokens: 30, CacheReadTokens: 75, CacheWriteTokens: 5,
		},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err != nil {
		t.Fatal(err)
	}
	if projection.Usage == nil || projection.Usage.Confirmed.InputTokens != 500 || projection.Usage.Confirmed.ContextWindowTokens != 1000 || projection.Usage.Confirmed.UpdatedAtMs != observedAt.UnixMilli() {
		t.Fatalf("usage=%#v", projection.Usage)
	}
	if projection.Usage.Confirmed.Characters == nil || projection.Usage.Confirmed.Characters.TotalCharacters != 240 {
		t.Fatalf("canonical composition=%+v", projection.Usage.Confirmed)
	}
	if projection.Usage.ThreadUsage == nil || *projection.Usage.ThreadUsage != (FlowerThreadTokenUsage{
		InputTokens: 120, OutputTokens: 30, CacheReadTokens: 75, CacheWriteTokens: 5,
	}) {
		t.Fatalf("thread usage=%#v", projection.Usage.ThreadUsage)
	}
	if projection.Usage.RecentRequestUsage == nil || *projection.Usage.RecentRequestUsage != (FlowerThreadTokenUsage{InputTokens: 30, CacheReadTokens: 60, CacheWriteTokens: 10}) {
		t.Fatalf("recent usage=%+v", projection.Usage.RecentRequestUsage)
	}

}

func TestFlowerThreadContextProjectionRejectsNegativeCanonicalUsageTotals(t *testing.T) {
	_, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		ContextUsage: &flruntime.ThreadContextUsage{Confirmed: &observation.ContextStatus{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-context",
			Phase: observation.ContextPhaseProviderUsage, ObservedAt: time.Now(),
			ContextPressure: config.ContextPressure{ContextWindowTokens: 1000}, Status: observation.ContextStatusStable,
		}},
		UsageTotals: &flruntime.ThreadTokenUsageTotals{CacheReadTokens: -1},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err == nil {
		t.Fatal("negative canonical usage totals must fail closed")
	}
}

func TestFlowerThreadTokenUsageJSONKeepsZeroBuckets(t *testing.T) {
	raw, err := json.Marshal(FlowerThreadTokenUsage{InputTokens: 100})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"input_tokens":100,"output_tokens":0,"cache_read_tokens":0,"cache_write_tokens":0}`
	if string(raw) != want {
		t.Fatalf("usage JSON=%s, want %s", raw, want)
	}
}

func TestFlowerThreadContextProjectionKeepsEmptyHistoryNoopWithoutInventingAnchor(t *testing.T) {
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-missing",
			CanonicalOrdinal: 7, OperationID: "compact-operation", RequestID: "compact-request",
			Phase: "noop", Status: "noop", Source: "thread_runtime", ObservedAt: time.Now(),
		}},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err != nil || len(projection.Compactions) != 1 || len(projection.Decorations) != 0 {
		t.Fatalf("empty-history projection=%#v err=%v", projection, err)
	}
}

func TestFlowerCompactionDecisionPreservesCanonicalEvidence(t *testing.T) {
	pressure := config.ContextPressure{Signal: config.PressureSignalProjected, Source: config.PressureSourceUsageAnchoredDelta, ProjectedInputTokens: 480000, ContextWindowTokens: 525000, ThresholdTokens: 472500, RequestSafeLimit: 500000}
	decision := &observation.CompactionDecision{Pressure: pressure, Before: &observation.CompactionRequestSnapshot{
		PayloadFingerprint: "unsent-candidate", Provider: "test", Model: "model", CalibrationRequestID: "qualified-request",
		Estimate: config.RequestEstimate{EstimatedInputTokens: 470382, Source: "fixture_v5", Method: config.EstimateMethodProviderRenderedPayload}, Pressure: pressure,
	}}
	canonical := flruntime.ThreadContextCompaction{CanonicalOrdinal: 1, RunID: "run", ThreadID: "thread", TurnID: "turn", OperationID: "compact", Phase: "failed", Status: "failed", Decision: decision}
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{Compactions: []flruntime.ThreadContextCompaction{canonical}}, flruntime.ThreadView{ThreadID: "thread"})
	if err != nil || len(projection.Compactions) != 1 {
		t.Fatalf("projection=%+v err=%v", projection, err)
	}
	got := projection.Compactions[0].Decision
	if got == nil || got.After != nil || got.Before.PayloadFingerprint != "unsent-candidate" || got.Before.EstimatedInputTokens != 470382 || got.Pressure.ProjectedInputTokens != 480000 || got.Before.CalibrationRequestID != "qualified-request" {
		t.Fatalf("evidence=%+v", got)
	}
	got.Before.EstimatedInputTokens = 1
	if decision.Before.Estimate.EstimatedInputTokens != 470382 {
		t.Fatal("product mapping aliases canonical evidence")
	}
	canonical.Decision = nil
	historical, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{Compactions: []flruntime.ThreadContextCompaction{canonical}}, flruntime.ThreadView{ThreadID: "thread"})
	if err != nil || historical.Compactions[0].Decision != nil {
		t.Fatalf("historical evidence fabricated: %+v %v", historical, err)
	}
}
