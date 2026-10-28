package ai

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestToolMediaCleanupPreservesSharedCanonicalBytesAndRemovesOrphans(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body := imageReadFixture(t, "png")
	attachment, _, snapshot, err := imageSnapshot(body, "retained.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.put(t.Context(), attachment, snapshot); err != nil {
		t.Fatal(err)
	}
	orphan, _, orphanBody, err := imageSnapshot(imageReadFixture(t, "jpeg"), "orphan.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.put(t.Context(), orphan, orphanBody); err != nil {
		t.Fatal(err)
	}
	frame, computer := computerFrameFixture(t)
	if err := store.put(t.Context(), computer, frame); err != nil {
		t.Fatal(err)
	}
	// Duplicate ownership is intentionally represented only by canonical refs.
	retained := func(context.Context) ([]string, error) {
		return []string{attachment.ResourceRef, attachment.ResourceRef, computer.ResourceRef}, nil
	}
	count, err := store.sweepUnreferenced(t.Context(), retained)
	if err != nil || count != 1 {
		t.Fatalf("sweep=%d %v", count, err)
	}
	recovered, err := store.read(t.Context(), attachment.ResourceRef)
	if err != nil || !bytes.Equal(recovered, body) {
		t.Fatalf("shared snapshot=%v", err)
	}
	if _, err := store.read(t.Context(), orphan.ResourceRef); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("orphan=%v", err)
	}
	if _, err := store.read(t.Context(), computer.ResourceRef); err != nil {
		t.Fatalf("computer frame=%v", err)
	}
	count, err = store.sweepUnreferenced(t.Context(), func(context.Context) ([]string, error) { return nil, nil })
	if err != nil || count != 2 {
		t.Fatalf("last owner removal=%d %v", count, err)
	}
}

func TestToolMediaCleanupFailsClosedOnAuthorityError(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body, attachment := computerFrameFixture(t)
	if err := store.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	authorityError := errors.New("canonical retention read failed")
	count, err := store.sweepUnreferenced(t.Context(), func(context.Context) ([]string, error) { return nil, authorityError })
	if count != 0 || !errors.Is(err, authorityError) {
		t.Fatalf("authority failure=%d %v", count, err)
	}
	if _, err := store.read(t.Context(), attachment.ResourceRef); err != nil {
		t.Fatal("authority failure removed bytes")
	}
}

func TestToolMediaCleanupChecksExecutionWhileHoldingWriteGate(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body, attachment := computerFrameFixture(t)
	if err := store.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	svc := &Service{toolMedia: store, floretMediaInventory: func(context.Context) (flruntime.MediaInventory, error) {
		if _, release, acquired := store.writes.collect(t.Context()); acquired {
			release()
			t.Fatal("canonical retention was read outside the media write gate")
		}
		return flruntime.MediaInventory{Idle: false}, nil
	}}
	if removed, err := svc.sweepToolMedia(t.Context(), false); removed != 0 || !errors.Is(err, errToolMediaExecutionActive) {
		t.Fatalf("unfinished execution sweep=%d %v", removed, err)
	}
	if _, err := store.read(t.Context(), attachment.ResourceRef); err != nil {
		t.Fatal("unfinished execution lost a pending snapshot")
	}
	if removed, err := svc.sweepToolMedia(t.Context(), true); removed != 1 || err != nil {
		t.Fatalf("deferred execution sweep=%d %v", removed, err)
	}
}

func TestToolMediaCleanupRunsAfterActivation(t *testing.T) {
	state := t.TempDir()
	store := newToolMediaStore(filepath.Join(state, "computer", "keyframes"))
	body, attachment := computerFrameFixture(t)
	if err := store.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	svc, err := NewServiceContext(t.Context(), fixtureMaintenanceOptions(t, state))
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	if _, err := store.read(t.Context(), attachment.ResourceRef); err != nil {
		t.Fatalf("preparation removed media before activation: %v", err)
	}
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	waitForToolMediaRemoval(t, store, attachment.ResourceRef)
}

func waitForToolMediaRemoval(t *testing.T, store toolMediaStore, ref string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, err := store.read(t.Context(), ref)
		if errors.Is(err, os.ErrNotExist) {
			break
		}
		if err != nil || time.Now().After(deadline) {
			t.Fatalf("background cleanup did not collect the unadmitted snapshot: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestToolMediaWriterPreemptsMaintenance(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body, attachment := computerFrameFixture(t)
	if err := store.put(t.Context(), attachment, body); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	go func() {
		removed, err := store.sweepUnreferenced(ctx, func(ctx context.Context) ([]string, error) {
			close(entered)
			<-ctx.Done()
			// Cancellation must be checked even if a collector returns a partial result.
			return nil, nil
		})
		if removed != 0 {
			done <- errors.New("cancelled scan deleted media")
			return
		}
		done <- err
	}()
	<-entered
	writeCtx, stop := context.WithTimeout(t.Context(), 500*time.Millisecond)
	defer stop()
	if err := store.put(writeCtx, attachment, body); err != nil {
		t.Fatalf("interactive write did not preempt maintenance: %v", err)
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("maintenance should yield: %v", err)
	}
	if _, err := store.read(t.Context(), attachment.ResourceRef); err != nil {
		t.Fatalf("retained media lost: %v", err)
	}
}

func TestToolMediaWriterCancellationWhileInventoryIsBlocked(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body, attachment := computerFrameFixture(t)
	entered, release, swept := make(chan struct{}), make(chan struct{}), make(chan struct{})
	defer func() { close(release); <-swept }()
	go func() {
		defer close(swept)
		_, _ = store.sweepUnreferenced(t.Context(), func(context.Context) ([]string, error) {
			close(entered)
			<-release
			return nil, errors.New("inventory unavailable")
		})
	}()
	<-entered
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- store.put(ctx, attachment, body) }()
	deadline := time.Now().Add(time.Second)
	for {
		store.writes.mu.Lock()
		queued := store.writes.writers > 0
		store.writes.mu.Unlock()
		if queued {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("writer did not queue")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("cancelled writer waited for inventory release")
	}
}

func TestToolMediaMaintenanceSkipsBusyWriter(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	release, err := store.writes.write(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	called := false
	removed, err := store.sweepUnreferenced(t.Context(), func(context.Context) ([]string, error) { called = true; return nil, nil })
	if removed != 0 || called || !errors.Is(err, errToolMediaMaintenanceBusy) {
		t.Fatalf("maintenance waited or scanned: %d %v %v", removed, called, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := store.writes.write(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled writer: %v", err)
	}
}

func TestToolMediaConcurrentWritersPreserveBytes(t *testing.T) {
	store := newToolMediaStore(t.TempDir())
	body, attachment := computerFrameFixture(t)
	done := make(chan error, 24)
	for i := 0; i < 24; i++ {
		go func() { done <- store.put(t.Context(), attachment, body) }()
	}
	for i := 0; i < 24; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.read(t.Context(), attachment.ResourceRef)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("concurrent persistence: %v", err)
	}
	if removed, err := store.sweepUnreferenced(t.Context(), func(context.Context) ([]string, error) { return []string{attachment.ResourceRef}, nil }); err != nil || removed != 0 {
		t.Fatalf("retention after writes: %d %v", removed, err)
	}
}
