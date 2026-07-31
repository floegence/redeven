package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
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

	t.Run("exact lookup in 1000 turn thread", func(t *testing.T) {
		const referenceID = "context:oldest"
		reader := &canonicalReferenceBenchmarkTurnReader{turn: canonicalReferenceBenchmarkTurns(1000, referenceID)[0]}
		lookupCalls := 0
		lookup := func() error {
			lookupCalls++
			turn, err := reader.ReadThreadTurn(context.Background(), "turn_0000")
			if err != nil {
				return err
			}
			if _, ok := exactFlowerCanonicalReference(turn, referenceID); !ok {
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
		if reader.exactCalls != lookupCalls || reader.listCalls != 0 {
			t.Fatalf("lookup calls=%d exact calls=%d list calls=%d", lookupCalls, reader.exactCalls, reader.listCalls)
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

type canonicalReferenceBenchmarkTurnReader struct {
	turn       flruntime.ThreadTurnSnapshot
	exactCalls int
	listCalls  int
}

func (r *canonicalReferenceBenchmarkTurnReader) ReadThreadTurn(_ context.Context, turnID identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	r.exactCalls++
	if turnID != r.turn.TurnID {
		return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
	}
	return r.turn, nil
}

func (r *canonicalReferenceBenchmarkTurnReader) ListThreadTurns(context.Context, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	r.listCalls++
	return flruntime.ThreadTurnsPage{}, errors.New("unexpected canonical history scan")
}

func BenchmarkCanonicalReferenceLookupAcross1000Turns(b *testing.B) {
	const (
		threadID    = "thread_benchmark"
		turnCount   = 1000
		referenceID = "context:oldest"
	)
	turns := canonicalReferenceBenchmarkTurns(turnCount, referenceID)
	reader := canonicalReferenceBenchmarkTurnReader{turn: turns[0]}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		turn, err := reader.ReadThreadTurn(context.Background(), "turn_0000")
		if err != nil {
			b.Fatal(err)
		}
		reference, ok := exactFlowerCanonicalReference(turn, referenceID)
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
			TurnID:      identity.TurnID(fmt.Sprintf("turn_%04d", index)),
			RunID:       identity.RunID(fmt.Sprintf("run_%04d", index)),
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
