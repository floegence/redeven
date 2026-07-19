package agent

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"reflect"
	"testing"
	"time"
)

func TestControlBackoffUsesExponentialDelaysAndCap(t *testing.T) {
	b := newBackoffWithRandom(func() (float64, error) { return 0.5, nil })

	want := []time.Duration{
		250 * time.Millisecond,
		450 * time.Millisecond,
		810 * time.Millisecond,
		1458 * time.Millisecond,
	}
	for i, expected := range want {
		got, err := b.Next()
		if err != nil {
			t.Fatalf("Next() call %d error = %v", i+1, err)
		}
		if got != expected {
			t.Fatalf("Next() call %d = %s, want %s", i+1, got, expected)
		}
	}

	for i := 0; i < 100; i++ {
		got, err := b.Next()
		if err != nil {
			t.Fatalf("Next() capped call %d error = %v", i+1, err)
		}
		if got <= 0 || got > 10*time.Second {
			t.Fatalf("Next() capped call %d = %s, want within (0, 10s]", i+1, got)
		}
	}
}

func TestControlBackoffAppliesTwentyPercentJitter(t *testing.T) {
	tests := []struct {
		name    string
		random  float64
		wantMin time.Duration
		wantMax time.Duration
	}{
		{name: "lower bound", random: 0, wantMin: 200 * time.Millisecond, wantMax: 200 * time.Millisecond},
		{name: "midpoint", random: 0.5, wantMin: 250 * time.Millisecond, wantMax: 250 * time.Millisecond},
		{name: "upper bound", random: math.Nextafter(1, 0), wantMin: 300*time.Millisecond - 1, wantMax: 300 * time.Millisecond},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := newBackoffWithRandom(func() (float64, error) { return tt.random, nil })
			got, err := b.Next()
			if err != nil {
				t.Fatalf("Next() error = %v", err)
			}
			if got < tt.wantMin || got > tt.wantMax {
				t.Fatalf("Next() = %s, want within [%s, %s]", got, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestControlBackoffSamplesAcrossBoundedCapInterval(t *testing.T) {
	first := &backoff{next: 10 * time.Second, randomUnit: func() (float64, error) { return 0.75, nil }}
	second := &backoff{next: 10 * time.Second, randomUnit: func() (float64, error) { return 0.9, nil }}

	firstDelay, err := first.Next()
	if err != nil {
		t.Fatalf("first Next() error = %v", err)
	}
	secondDelay, err := second.Next()
	if err != nil {
		t.Fatalf("second Next() error = %v", err)
	}

	if firstDelay != 9500*time.Millisecond {
		t.Fatalf("first capped delay = %s, want 9.5s", firstDelay)
	}
	if secondDelay != 9800*time.Millisecond {
		t.Fatalf("second capped delay = %s, want 9.8s", secondDelay)
	}
}

func TestControlBackoffResetRestoresFirstDelay(t *testing.T) {
	b := newBackoffWithRandom(func() (float64, error) { return 0.5, nil })
	for i := 0; i < 3; i++ {
		if _, err := b.Next(); err != nil {
			t.Fatalf("Next() before Reset() error = %v", err)
		}
	}

	b.Reset()
	got, err := b.Next()
	if err != nil {
		t.Fatalf("Next() after Reset() error = %v", err)
	}
	if got != 250*time.Millisecond {
		t.Fatalf("Next() after Reset() = %s, want 250ms", got)
	}
}

func TestControlBackoffReturnsRandomSourceError(t *testing.T) {
	wantErr := errors.New("random source unavailable")
	b := newBackoffWithRandom(func() (float64, error) { return 0, wantErr })

	_, err := b.Next()
	if !errors.Is(err, wantErr) {
		t.Fatalf("Next() error = %v, want %v", err, wantErr)
	}
}

func TestControlLoopResetsBackoffAfterRegisteredAttempt(t *testing.T) {
	a := newControlLoopTestAgent()
	b := newBackoffWithRandom(func() (float64, error) { return 0.5, nil })
	attempts := 0
	delays := make([]time.Duration, 0, 3)
	a.onControlRetry = func(_ error, delay time.Duration) {
		delays = append(delays, delay)
	}

	attempt := func(context.Context) (controlAttemptResult, error) {
		attempts++
		return controlAttemptResult{registered: attempts == 3}, errors.New("disconnected")
	}
	wait := func(context.Context, time.Duration) bool {
		return len(delays) < 3
	}

	a.runControlAttempts(context.Background(), attempt, b, wait)

	want := []time.Duration{250 * time.Millisecond, 450 * time.Millisecond, 250 * time.Millisecond}
	if !reflect.DeepEqual(delays, want) {
		t.Fatalf("retry delays = %v, want %v", delays, want)
	}
}

func TestControlLoopCancellationDoesNotContinueSleeping(t *testing.T) {
	a := newControlLoopTestAgent()
	b := newBackoffWithRandom(func() (float64, error) { return 0.5, nil })
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	a.onControlRetry = func(error, time.Duration) { cancel() }

	startedAt := time.Now()
	a.runControlAttempts(ctx, func(context.Context) (controlAttemptResult, error) {
		attempts++
		return controlAttemptResult{}, errors.New("disconnected")
	}, b, waitControlRetry)

	if elapsed := time.Since(startedAt); elapsed >= 100*time.Millisecond {
		t.Fatalf("canceled control loop returned after %s, want immediate return", elapsed)
	}
	if attempts != 1 {
		t.Fatalf("control attempts = %d, want 1", attempts)
	}
}

func newControlLoopTestAgent() *Agent {
	return &Agent{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
}
