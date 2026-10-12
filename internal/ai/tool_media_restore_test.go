package ai

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestFlowerSnapshotRestoresImmutableToolMedia(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	opts := fixtureMaintenanceOptions(t, state)
	svc, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	store := newToolMediaStore(filepath.Join(state, "computer", "keyframes"))
	image, _, imageBytes, err := imageSnapshot(imageReadFixture(t, "png"), "snapshot.png")
	if err != nil {
		t.Fatal(err)
	}
	frameBytes, frame := computerFrameFixture(t)
	for _, media := range []struct {
		attachment TargetToolAttachment
		body       []byte
	}{{image, imageBytes}, {frame, frameBytes}} {
		if err := store.put(t.Context(), media.attachment, media.body); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := captureFlowerSnapshot(t.Context(), state, "test", "automatic", false)
	if err != nil || !slices.Contains(snapshot.Roots, "computer/keyframes") {
		t.Fatalf("snapshot roots=%v %v", snapshot.Roots, err)
	}
	if _, err := verifyFlowerSnapshot(t.Context(), state, snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(store.directory); err != nil {
		t.Fatal(err)
	}
	if err := RestoreFlowerSnapshot(t.Context(), opts, snapshot.ID); err != nil {
		t.Fatal(err)
	}
	for _, media := range []struct {
		ref  string
		body []byte
	}{{image.ResourceRef, imageBytes}, {frame.ResourceRef, frameBytes}} {
		body, err := store.read(t.Context(), media.ref)
		if err != nil || !bytes.Equal(body, media.body) {
			t.Fatalf("restored %s: %v", media.ref, err)
		}
	}
}

func TestFlowerReleasedRestoreContractsPreserveToolMedia(t *testing.T) {
	for _, existingJournal := range []bool{false, true} {
		t.Run(map[bool]string{false: "snapshot", true: "inflight_journal"}[existingJournal], func(t *testing.T) {
			state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
			opts := fixtureMaintenanceOptions(t, state)
			svc, err := NewServiceContext(t.Context(), opts)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			// The released snapshot has no media root or files.
			snapshot, err := captureFlowerSnapshot(t.Context(), state, "test", "automatic", false)
			if err != nil || slices.Contains(snapshot.Roots, "computer/keyframes") {
				t.Fatalf("released snapshot=%v %v", snapshot.Roots, err)
			}
			store := newToolMediaStore(filepath.Join(state, "computer", "keyframes"))
			body, attachment := computerFrameFixture(t)
			if err := store.put(t.Context(), attachment, body); err != nil {
				t.Fatal(err)
			}
			if existingJournal {
				interrupted := errors.New("process interrupted")
				if err := restoreFlowerSnapshotWith(t.Context(), opts, snapshot.ID, func(context.Context, string) error { return interrupted }); !errors.Is(err, interrupted) {
					t.Fatal(err)
				}
				journalPath := filepath.Join(state, flowerMaintenanceDir, "restore.json")
				var operation flowerReplacement
				if err := readMaintenanceJSON(journalPath, &operation); err != nil {
					t.Fatal(err)
				}
				// Model the exact released journal: its immutable media directory
				// was outside the replacement collection.
				operation.Items = slices.DeleteFunc(operation.Items, func(item flowerReplacementItem) bool { return item.Path == "computer/keyframes" })
				operation.Files = slices.DeleteFunc(operation.Files, func(file flowerSnapshotFile) bool { return strings.HasPrefix(file.Path, "computer/keyframes/") })
				if err := os.RemoveAll(filepath.Join(state, flowerMaintenanceDir, "restore-"+operation.ID, "prepared", "computer", "keyframes")); err != nil {
					t.Fatal(err)
				}
				if err := writeMaintenanceJSON(journalPath, operation); err != nil {
					t.Fatal(err)
				}
				if err := recoverFlowerReplacement(t.Context(), state); err != nil {
					t.Fatal(err)
				}
			} else if err := RestoreFlowerSnapshot(t.Context(), opts, snapshot.ID); err != nil {
				t.Fatal(err)
			}
			actual, err := store.read(t.Context(), attachment.ResourceRef)
			if err != nil || !bytes.Equal(actual, body) {
				t.Fatalf("released restore removed historical media: %v", err)
			}
		})
	}
}
