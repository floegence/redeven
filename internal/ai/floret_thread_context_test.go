package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/floret/v5/config"
	"github.com/floegence/floret/v5/florettest"
	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flprovider "github.com/floegence/floret/v5/provider"
	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/floret/v5/storage"
)

func TestPublishedFloretUsageReachesFlowerThreadProjection(t *testing.T) {
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
	)
	agent, err := flruntime.NewAgent(config.AgentConfig{
		Profile:      config.AgentProfile{ID: "cache-usage", Name: "Cache Usage"},
		SystemPrompt: "Test canonical cache usage.",
		Context:      config.ContextPolicy{ContextWindowTokens: config.DefaultContextWindowTokens},
	}, gateway)
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return agent, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
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

	deadline := time.Now().Add(2 * time.Second)
	for {
		snapshot, readErr := reader.Context(t.Context(), created.ThreadID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if snapshot.UsageTotals != nil {
			projection, projectErr := flowerThreadContextProjection(snapshot, flruntime.ThreadView{ThreadID: created.ThreadID})
			if projectErr != nil {
				t.Fatal(projectErr)
			}
			if projection.Usage == nil || projection.Usage.ThreadUsage == nil || *projection.Usage.ThreadUsage != (FlowerThreadTokenUsage{
				InputTokens: 60, OutputTokens: 20, CacheReadTokens: 35, CacheWriteTokens: 5,
			}) {
				t.Fatalf("Flower thread usage=%#v", projection.Usage)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("published Floret usage did not reach Flower thread projection")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestFlowerThreadContextProjectionRestoresOneTerminalCompactionDivider(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	threadID := identity.ThreadID("thread-context")
	turnID := identity.TurnID("turn-context")
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: threadID, TurnID: turnID, Step: 1,
			OperationID: "compact-operation", RequestID: "compact-request",
			Phase: "noop", Status: "noop", Trigger: "manual", Reason: "manual",
			Source: flowerManualCompactionSourceName, TokensBefore: 6354, ObservedAt: observedAt,
		}},
	}, flruntime.ThreadView{ThreadID: threadID, Items: []flruntime.ThreadItem{
		{ID: "message-before", Kind: flruntime.ThreadItemUser, TurnID: "turn-before"},
		{ID: "message-compact", Kind: flruntime.ThreadItemUser, TurnID: turnID},
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
	if got := projection.Decorations[0]; got.DecorationID != "context-compaction:compact-operation" || got.Anchor.MessageID != "message-compact" || got.Anchor.Edge != "after" {
		t.Fatalf("decoration=%#v", got)
	}
}

func TestFlowerThreadContextProjectionIncludesCanonicalUsage(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Usage: &observation.ContextStatus{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-context", Step: 2,
			Phase: observation.ContextPhaseProviderUsage, ObservedAt: observedAt,
			Usage:           observation.ProviderUsage{WindowInputTokens: 500},
			ContextPressure: config.ContextPressure{ContextWindowTokens: 1000},
			UsedRatio:       0.5, Status: observation.ContextStatusStable,
		},
		UsageTotals: &flruntime.ThreadTokenUsageTotals{
			InputTokens: 120, OutputTokens: 30, CacheReadTokens: 75, CacheWriteTokens: 5,
		},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err != nil {
		t.Fatal(err)
	}
	if projection.Usage == nil || projection.Usage.InputTokens != 500 || projection.Usage.ContextWindowTokens != 1000 || projection.Usage.UpdatedAtMs != observedAt.UnixMilli() {
		t.Fatalf("usage=%#v", projection.Usage)
	}
	if projection.Usage.ThreadUsage == nil || *projection.Usage.ThreadUsage != (FlowerThreadTokenUsage{
		InputTokens: 120, OutputTokens: 30, CacheReadTokens: 75, CacheWriteTokens: 5,
	}) {
		t.Fatalf("thread usage=%#v", projection.Usage.ThreadUsage)
	}
}

func TestFlowerThreadContextProjectionRejectsNegativeCanonicalUsageTotals(t *testing.T) {
	_, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Usage: &observation.ContextStatus{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-context",
			Phase: observation.ContextPhaseProviderUsage, ObservedAt: time.Now(),
			ContextPressure: config.ContextPressure{ContextWindowTokens: 1000}, Status: observation.ContextStatusStable,
		},
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

func TestFlowerThreadContextProjectionFailsClosedWithoutCanonicalAnchor(t *testing.T) {
	_, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-missing",
			OperationID: "compact-operation", RequestID: "compact-request",
			Phase: "noop", Status: "noop", Source: flowerManualCompactionSourceName, ObservedAt: time.Now(),
		}},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err == nil {
		t.Fatal("missing canonical message anchor must fail closed")
	}
}
