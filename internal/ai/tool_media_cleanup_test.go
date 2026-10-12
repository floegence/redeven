package ai

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

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
		if store.writes.TryLock() {
			store.writes.Unlock()
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

func TestToolMediaStartupCollectsUnadmittedSnapshots(t *testing.T) {
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
	if _, err := store.read(t.Context(), attachment.ResourceRef); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("startup did not collect the unadmitted snapshot: %v", err)
	}
}
