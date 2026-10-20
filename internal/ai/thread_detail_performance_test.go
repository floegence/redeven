package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/config"
)

// This test-only reader reproduces the removed call path for paired qualification.
// Production has no List fallback. Run this benchmark explicitly with -benchtime=1x.
type enumeratingSummaryRuntime struct{ flruntime.ThreadService }

func (r enumeratingSummaryRuntime) Summary(ctx context.Context, id identity.ThreadID) (flruntime.ThreadSummary, error) {
	summaries, err := r.List(ctx, flruntime.ThreadScope{})
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == id {
			return summary, nil
		}
	}
	return flruntime.ThreadSummary{}, flruntime.ErrThreadNotFound
}

func BenchmarkFlowerThreadDetailPointRead(b *testing.B) {
	for _, roots := range []int{25, 200} {
		b.Run(fmt.Sprintf("roots_%d", roots), func(b *testing.B) {
			ctx := b.Context()
			svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: b.TempDir(), AgentHomeDir: b.TempDir(), Shell: "/bin/bash", Config: &config.AIConfig{CurrentModelID: "openai/test", Providers: []config.AIProvider{{ID: "openai", Name: "Synthetic", Type: "openai", Models: []config.AIProviderModel{{ModelName: "test"}}}}}})
			if err != nil {
				b.Fatal(err)
			}
			defer svc.Close()
			host, err := flruntime.Open(ctx, flruntime.Options{Storage: storage.SQLite(filepath.Join(b.TempDir(), "synthetic.sqlite"))})
			if err != nil {
				b.Fatal(err)
			}
			defer host.Shutdown(context.Background())
			steps := make([]florettest.Step, roots*2)
			for i := range steps {
				steps[i] = florettest.Step{Events: []provider.Event{{Type: provider.EventDelta, Text: "Synthetic acknowledged answer."}, {Type: provider.EventDone, Reason: "stop"}}}
			}
			gateway := florettest.NewScriptedGateway(provider.Identity{Provider: "test", Model: "point-read", StateCompatibilityKey: "point-read:v1"}, provider.Capabilities{Reasoning: provider.ReasoningUnsupported}, steps...)
			runtime, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
				return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "perf", Name: "Performance"}, SystemPrompt: "Synthetic qualification.", Context: flconfig.ContextPolicy{ContextWindowTokens: 1000000}}, gateway)
			}))
			if err != nil {
				b.Fatal(err)
			}
			svc.threadRuntime = runtime
			meta := testSendTurnMeta()
			ids := make([]string, roots)
			for i := range roots {
				created, err := svc.CreateThread(ctx, meta, fmt.Sprintf("Synthetic root %d", i), "", "", svc.agentHomeDir)
				if err != nil {
					b.Fatal(err)
				}
				ids[i] = created.ThreadID
				text := "Fixed short conversation."
				if i > 0 {
					text = strings.Repeat("Unrelated synthetic history. ", 600)
				}
				for turn := range 2 {
					_, err = runtime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(ids[i]), RequestKey: flruntime.RequestKey(fmt.Sprintf("seed-%d", turn)), Input: flruntime.UserInput{Text: text}})
					if err != nil {
						b.Fatal(err)
					}
					deadline := time.Now().Add(10 * time.Second)
					for {
						view, e := runtime.View(ctx, identity.ThreadID(ids[i]))
						if e != nil {
							b.Fatal(e)
						}
						if view.Activity == flruntime.ThreadActivityIdle {
							break
						}
						if time.Now().After(deadline) {
							b.Fatal("synthetic turn did not settle")
						}
						time.Sleep(time.Millisecond)
					}
				}
			}
			measure := func(id string, old bool) time.Duration {
				if old {
					svc.threadRuntime = enumeratingSummaryRuntime{runtime}
				} else {
					svc.threadRuntime = runtime
				}
				started := time.Now()
				_, e := svc.GetFlowerThreadDetail(ctx, meta, id)
				if e != nil {
					b.Fatal(e)
				}
				return time.Since(started)
			}
			for _, selected := range []struct{ name, id string }{{"short", ids[0]}, {"long", ids[1]}} {
				before, after := make([]time.Duration, 30), make([]time.Duration, 30)
				measure(selected.id, true)
				measure(selected.id, false)
				for i := range before {
					if i%2 == 0 {
						before[i] = measure(selected.id, true)
						after[i] = measure(selected.id, false)
					} else {
						after[i] = measure(selected.id, false)
						before[i] = measure(selected.id, true)
					}
				}
				sort.Slice(before, func(i, j int) bool { return before[i] < before[j] })
				sort.Slice(after, func(i, j int) bool { return after[i] < after[j] })
				b.ReportMetric(float64(before[15].Microseconds())/1000, selected.name+"_before_p50_ms")
				b.ReportMetric(float64(before[28].Microseconds())/1000, selected.name+"_before_p95_ms")
				b.ReportMetric(float64(after[15].Microseconds())/1000, selected.name+"_after_p50_ms")
				b.ReportMetric(float64(after[28].Microseconds())/1000, selected.name+"_after_p95_ms")
				improvement := 1 - float64(after[28])/float64(before[28])
				b.ReportMetric(100*improvement, selected.name+"_p95_reduction_pct")
				if selected.name == "short" && improvement < 0.70 {
					b.Fatalf("short detail P95 reduction %.1f%%, want >=70%%", 100*improvement)
				}
			}
		})
	}
}
