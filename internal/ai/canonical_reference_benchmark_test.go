package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

var (
	canonicalReferenceBenchmarkReferences []FlowerMessageReference
	canonicalReferenceBenchmarkMessage    FlowerTimelineMessage
	canonicalReferenceBenchmarkWire       []byte
)

func TestCanonicalReferencePerformanceBudgets(t *testing.T) {
	if raceDetectorEnabled {
		t.Skip("performance budgets require a non-instrumented build")
	}
	t.Run("browser projection 100 references", func(t *testing.T) {
		references := canonicalReferenceBenchmarkFixture(100)
		var wire []byte
		project := func() error {
			raw, err := canonicalUserTimelineMessage(
				"turn_budget", "entry_budget", "", nil, references, 1783677600000,
			)
			if err != nil {
				return err
			}
			message, ok, err := flowerTimelineMessageFromRaw(
				"thread_budget", "turn_budget", "run_budget", "entry_budget", raw,
			)
			if err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("canonical timeline message was not projected")
			}
			wire, err = json.Marshal(message)
			return err
		}
		var projectionErr error
		allocs := testing.AllocsPerRun(20, func() { projectionErr = project() })
		if projectionErr != nil {
			t.Fatal(projectionErr)
		}
		if len(wire) == 0 {
			t.Fatal("browser projection produced an empty payload")
		}
		if allocs > 3500 {
			t.Fatalf("browser projection allocations=%.0f, budget=3500", allocs)
		}
		const iterations = 25
		startedAt := time.Now()
		for range iterations {
			if err := project(); err != nil {
				t.Fatal(err)
			}
		}
		if average := time.Since(startedAt) / iterations; average > 2*time.Millisecond {
			t.Fatalf("browser projection average=%s, budget=2ms", average)
		}
	})

	t.Run("lookup across 1000 turns", func(t *testing.T) {
		const referenceID = "context:oldest"
		pager := canonicalReferenceBenchmarkTurnPager{turns: canonicalReferenceBenchmarkTurns(1000, referenceID)}
		lookup := func() error {
			listed, err := listAllFloretThreadTurns(context.Background(), pager, "thread_budget")
			if err != nil {
				return err
			}
			if _, ok := exactFlowerCanonicalReference(listed, "turn_0000", referenceID); !ok {
				return fmt.Errorf("oldest canonical reference was not found")
			}
			return nil
		}
		var lookupErr error
		allocs := testing.AllocsPerRun(20, func() { lookupErr = lookup() })
		if lookupErr != nil {
			t.Fatal(lookupErr)
		}
		if allocs > 30 {
			t.Fatalf("1000-turn lookup allocations=%.0f, budget=30", allocs)
		}
		const iterations = 25
		startedAt := time.Now()
		for range iterations {
			if err := lookup(); err != nil {
				t.Fatal(err)
			}
		}
		if average := time.Since(startedAt) / iterations; average > 2*time.Millisecond {
			t.Fatalf("1000-turn lookup average=%s, budget=2ms", average)
		}
	})
}

func BenchmarkCanonicalReferenceSanitization(b *testing.B) {
	for _, count := range []int{1, 10, 100} {
		b.Run(fmt.Sprintf("references_%d", count), func(b *testing.B) {
			references := canonicalReferenceBenchmarkFixture(count)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				projected, err := publicFloretMessageReferences(references)
				if err != nil {
					b.Fatal(err)
				}
				canonicalReferenceBenchmarkReferences = projected
			}
		})
	}
}

func BenchmarkCanonicalReferenceStrictRawParse(b *testing.B) {
	for _, count := range []int{1, 10, 100} {
		b.Run(fmt.Sprintf("references_%d", count), func(b *testing.B) {
			raw := canonicalReferenceBenchmarkRawReferences(b, count)
			b.SetBytes(int64(len(raw)))
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				parsed, err := decodeFlowerTimelineMessageReferences(raw, "user")
				if err != nil {
					b.Fatal(err)
				}
				canonicalReferenceBenchmarkReferences = parsed
			}
		})
	}
}

func BenchmarkCanonicalReferenceTimelineProjection(b *testing.B) {
	for _, count := range []int{1, 10, 100} {
		b.Run(fmt.Sprintf("references_%d", count), func(b *testing.B) {
			raw := canonicalReferenceBenchmarkRawMessage(b, count)
			b.SetBytes(int64(len(raw)))
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				message, ok, err := flowerTimelineMessageFromRaw(
					"thread_benchmark",
					"turn_benchmark",
					"run_benchmark",
					"entry_benchmark",
					raw,
				)
				if err != nil {
					b.Fatal(err)
				}
				if !ok {
					b.Fatal("canonical timeline message was not projected")
				}
				canonicalReferenceBenchmarkMessage = message
			}
		})
	}
}

func BenchmarkCanonicalReferenceBrowserProjection(b *testing.B) {
	for _, count := range []int{1, 10, 100} {
		b.Run(fmt.Sprintf("references_%d", count), func(b *testing.B) {
			references := canonicalReferenceBenchmarkFixture(count)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				raw, err := canonicalUserTimelineMessage(
					"turn_benchmark",
					"entry_benchmark",
					"",
					nil,
					references,
					1783677600000,
				)
				if err != nil {
					b.Fatal(err)
				}
				message, ok, err := flowerTimelineMessageFromRaw(
					"thread_benchmark",
					"turn_benchmark",
					"run_benchmark",
					"entry_benchmark",
					raw,
				)
				if err != nil {
					b.Fatal(err)
				}
				if !ok {
					b.Fatal("canonical timeline message was not projected")
				}
				wire, err := json.Marshal(message)
				if err != nil {
					b.Fatal(err)
				}
				canonicalReferenceBenchmarkWire = wire
			}
		})
	}
}

type canonicalReferenceBenchmarkTurnPager struct {
	turns []flruntime.ThreadTurnSnapshot
}

func (p canonicalReferenceBenchmarkTurnPager) ListThreadTurns(_ context.Context, req flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	end := len(p.turns)
	if req.BeforeCursor != nil {
		end = -1
		for index, turn := range p.turns {
			if turn.UserEntryID == req.BeforeCursor.EntryID {
				end = index
				break
			}
		}
		if end < 0 {
			return flruntime.ThreadTurnsPage{}, fmt.Errorf("unknown benchmark cursor %q", req.BeforeCursor.EntryID)
		}
	}
	limit := req.Limit
	if req.Tail > 0 {
		limit = req.Tail
	}
	if limit <= 0 {
		limit = 200
	}
	start := max(0, end-limit)
	page := flruntime.ThreadTurnsPage{
		ThreadID:       req.ThreadID,
		Turns:          append([]flruntime.ThreadTurnSnapshot(nil), p.turns[start:end]...),
		HasMore:        start > 0,
		ThroughOrdinal: int64(end),
	}
	if start > 0 {
		page.BeforeCursor = &flruntime.ThreadTurnsBeforeCursor{EntryID: p.turns[start].UserEntryID}
	}
	return page, nil
}

func BenchmarkCanonicalReferenceLookupAcross1000Turns(b *testing.B) {
	const (
		threadID    = "thread_benchmark"
		turnCount   = 1000
		referenceID = "context:oldest"
	)
	turns := canonicalReferenceBenchmarkTurns(turnCount, referenceID)
	pager := canonicalReferenceBenchmarkTurnPager{turns: turns}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		listed, err := listAllFloretThreadTurns(context.Background(), pager, threadID)
		if err != nil {
			b.Fatal(err)
		}
		reference, ok := exactFlowerCanonicalReference(listed, "turn_0000", referenceID)
		if !ok {
			b.Fatal("oldest canonical reference was not found")
		}
		canonicalReferenceBenchmarkReferences = []FlowerMessageReference{{
			ReferenceID: reference.ReferenceID,
			Kind:        string(reference.Kind),
			Label:       reference.Label,
		}}
	}
}

func canonicalReferenceBenchmarkTurns(turnCount int, referenceID string) []flruntime.ThreadTurnSnapshot {
	turns := make([]flruntime.ThreadTurnSnapshot, 0, turnCount)
	for index := range turnCount {
		turn := flruntime.ThreadTurnSnapshot{
			TurnID:      flruntime.TurnID(fmt.Sprintf("turn_%04d", index)),
			RunID:       flruntime.RunID(fmt.Sprintf("run_%04d", index)),
			Ordinal:     int64(index + 1),
			UserEntryID: fmt.Sprintf("entry_%04d", index),
		}
		if index == 0 {
			turn.UserReferences = []flruntime.MessageReference{{
				ReferenceID: referenceID,
				Kind:        flruntime.MessageReferenceFile,
				Label:       "oldest.txt",
				ResourceRef: "redeven-context:v1:benchmark",
			}}
		}
		turns = append(turns, turn)
	}
	return turns
}

func canonicalReferenceBenchmarkRawReferences(b *testing.B, count int) json.RawMessage {
	b.Helper()
	projected, err := publicFloretMessageReferences(canonicalReferenceBenchmarkFixture(count))
	if err != nil {
		b.Fatal(err)
	}
	raw, err := json.Marshal(projected)
	if err != nil {
		b.Fatal(err)
	}
	return raw
}

func canonicalReferenceBenchmarkRawMessage(b *testing.B, count int) json.RawMessage {
	b.Helper()
	raw, err := canonicalUserTimelineMessage(
		"turn_benchmark",
		"entry_benchmark",
		"",
		nil,
		canonicalReferenceBenchmarkFixture(count),
		1783677600000,
	)
	if err != nil {
		b.Fatal(err)
	}
	return raw
}

func canonicalReferenceBenchmarkFixture(count int) []flruntime.MessageReference {
	references := make([]flruntime.MessageReference, 0, count)
	for index := range count {
		reference := flruntime.MessageReference{
			ReferenceID: fmt.Sprintf("context:%d", index),
			Label:       fmt.Sprintf("Reference %d", index),
		}
		switch index % 5 {
		case 0:
			reference.Kind = flruntime.MessageReferenceFile
			reference.Text = fmt.Sprintf("/private/workspace/src/file-%d.ts", index)
			reference.ResourceRef = fmt.Sprintf("redeven-context:v1:file-%d", index)
		case 1:
			reference.Kind = flruntime.MessageReferenceDirectory
			reference.Text = fmt.Sprintf("/private/workspace/src/directory-%d", index)
			reference.ResourceRef = fmt.Sprintf("redeven-context:v1:directory-%d", index)
		case 2:
			reference.Kind = flruntime.MessageReferenceText
			reference.Text = fmt.Sprintf("Selected source excerpt %d with stable benchmark content.", index)
			reference.Truncated = true
		case 3:
			reference.Kind = flruntime.MessageReferenceTerminal
			reference.Text = fmt.Sprintf("go test ./internal/ai -run Reference%d", index)
		case 4:
			reference.Kind = flruntime.MessageReferenceProcess
			reference.Text = fmt.Sprintf("PID %d redeven-worker", 1000+index)
		}
		references = append(references, reference)
	}
	return references
}
