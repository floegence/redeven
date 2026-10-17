package ai

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

type flowerUpgradeFixture struct {
	ApprovalThreadID  string            `json:"approval_thread_id"`
	ParentThreadID    string            `json:"parent_thread_id"`
	ChildThreadID     string            `json:"child_thread_id"`
	CancelledThreadID string            `json:"cancelled_thread_id"`
	CrashedThreadID   string            `json:"crashed_thread_id"`
	ArchiveSHA256     string            `json:"archive_sha256"`
	Files             map[string]string `json:"files"`
	ThreadIDs         []string          `json:"thread_ids"`
	AttachmentForkID  string            `json:"attachment_fork_id"`
	WaitingThreadID   string            `json:"waiting_thread_id"`
	AttachmentID      string            `json:"attachment_id"`
}

// The archive was produced by the locked historical writer. Tests verify and
// extract its exact bytes; no current DTO serializes or refreshes these inputs.
func loadFlowerUpgradeFixture(t *testing.T, name string) (string, flowerUpgradeFixture) {
	t.Helper()
	root := filepath.Join("testdata", "upgrade", name)
	var manifest flowerUpgradeFixture
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(filepath.Join(root, "state.tar.gz"))
	if err != nil {
		t.Fatal(err)
	}
	if digest := sha256.Sum256(archive); hex.EncodeToString(digest[:]) != manifest.ArchiveSHA256 {
		t.Fatal("historical archive checksum changed")
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	state := t.TempDir()
	seen := make(map[string]bool)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Typeflag != tar.TypeReg || !filepath.IsLocal(header.Name) || seen[header.Name] || manifest.Files[header.Name] == "" {
			t.Fatalf("unexpected archive entry %q", header.Name)
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != manifest.Files[header.Name] {
			t.Fatalf("historical file checksum changed: %s", header.Name)
		}
		path := filepath.Join(state, header.Name)
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		seen[header.Name] = true
	}
	if len(seen) != len(manifest.Files) {
		t.Fatal("historical archive is incomplete")
	}
	return state, manifest
}

func fixtureMaintenanceOptions(t *testing.T, state string) Options {
	t.Helper()
	return Options{StateDir: state, AgentHomeDir: t.TempDir(), Shell: "/bin/sh", BuildVersion: "test-v1", DeferExecution: true, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func TestFlowerUpgradeReusesDataWithoutAutomaticSnapshots(t *testing.T) {
	state, fixture := loadFlowerUpgradeFixture(t, "10ce4c152")
	opts := fixtureMaintenanceOptions(t, state)
	obsolete := filepath.Join(state, flowerMaintenanceDir, "upgrade.json")
	if err := os.MkdirAll(filepath.Dir(obsolete), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(obsolete, []byte("damaged obsolete record"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"test-v1", "test-v2"} {
		opts.BuildVersion = version
		service, err := NewServiceContext(t.Context(), opts)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range fixture.ThreadIDs {
			view, err := service.threadRuntime.View(t.Context(), identity.ThreadID(id))
			if err != nil || len(view.Items) == 0 {
				t.Fatalf("history=%+v %v", view, err)
			}
		}
		if err := service.Activate(t.Context()); err != nil {
			t.Fatal(err)
		}
		if err := service.Close(); err != nil {
			t.Fatal(err)
		}
		snapshots, err := ListFlowerSnapshots(t.Context(), state)
		if err != nil || len(snapshots) != 0 {
			t.Fatalf("automatic snapshots=%+v %v", snapshots, err)
		}
		if _, err := os.Stat(obsolete); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("obsolete record retained: %v", err)
		}
	}
}

func captureFixtureSnapshot(t *testing.T, state string) string {
	t.Helper()
	snapshot, err := captureFlowerSnapshot(t.Context(), state, "fixture", "automatic", false)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot.ID
}

func TestFlowerRestoreStopsHistoricalWaitingTurnAndPreservesQueue(t *testing.T) {
	state, fixture := loadFlowerUpgradeFixture(t, "10ce4c152-waiting")
	snapshotID := captureFixtureSnapshot(t, state)
	opts := fixtureMaintenanceOptions(t, state)
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.threadRuntime.View(t.Context(), identity.ThreadID(fixture.WaitingThreadID))
	if err != nil || len(view.Queue) != 1 || len(view.Interactions) == 0 {
		t.Fatalf("waiting fixture=%+v %v", view, err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	if err = RestoreFlowerSnapshot(t.Context(), opts, snapshotID); err != nil {
		t.Fatal(err)
	}
	service, err = NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	view, err = service.threadRuntime.View(t.Context(), identity.ThreadID(fixture.WaitingThreadID))
	if err != nil || view.Activity != flruntime.ThreadActivityIdle || len(view.Queue) != 0 || len(view.RestoredInputs) != 1 {
		t.Fatalf("restored=%+v %v", view, err)
	}
	for _, interaction := range view.Interactions {
		if !interaction.Resolved {
			t.Fatal("restored interaction remains executable")
		}
	}
	if err = service.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err = service.threadRuntime.Retry(t.Context(), flruntime.RetryInput{ThreadID: view.ThreadID, SourceTurnID: view.TurnID, RequestKey: "retry-restored"}); err == nil {
		t.Fatal("restored task was retried")
	}
	if _, err = os.Stat(filepath.Join(state, "ai", "uploads", fixture.AttachmentID+".data")); err != nil {
		t.Fatal(err)
	}
	snapshots, err := ListFlowerSnapshots(context.Background(), state)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 2 {
		t.Fatalf("restore did not preserve the previous scene: %+v", snapshots)
	}
}

func TestFlowerUpgradePreservesAttachmentAuthorityInHistoricalFork(t *testing.T) {
	state, fixture := loadFlowerUpgradeFixture(t, "10ce4c152")
	service, err := NewServiceContext(t.Context(), fixtureMaintenanceOptions(t, state))
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	owner, err := NewUploadOwner("fixture_endpoint", "fixture_user", "fixture_channel")
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := service.openCanonicalLiveAttachment(t.Context(), owner, fixture.AttachmentForkID, fixture.AttachmentID)
	if err != nil || attachment.Upload == nil {
		t.Fatalf("historical fork lost canonical attachment access: %v", err)
	}
	foreign, err := NewUploadOwner("fixture_endpoint", "foreign_user", "foreign_channel")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.openCanonicalLiveAttachment(t.Context(), foreign, fixture.AttachmentForkID, fixture.AttachmentID); err == nil {
		t.Fatal("fork retention granted another user attachment access")
	}
	if err := service.DeleteThread(t.Context(), fixtureProductMeta(), fixture.ThreadIDs[0], false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.openCanonicalLiveAttachment(t.Context(), owner, fixture.AttachmentForkID, fixture.AttachmentID); err != nil {
		t.Fatalf("source deletion removed fork attachment: %v", err)
	}
}

func TestFlowerRestoreResumesAfterEveryFileRename(t *testing.T) {
	state, fixture := loadFlowerUpgradeFixture(t, "10ce4c152-waiting")
	snapshotID := captureFixtureSnapshot(t, state)
	opts := fixtureMaintenanceOptions(t, state)
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	interrupted := errors.New("simulated process exit")
	// Publish a fully prepared operation, but stop before replacing any file.
	err = restoreFlowerSnapshotWith(t.Context(), opts, snapshotID, func(context.Context, string) error { return interrupted })
	if !errors.Is(err, interrupted) {
		t.Fatal(err)
	}
	var journal flowerReplacement
	if err = readMaintenanceJSON(filepath.Join(state, flowerMaintenanceDir, "restore.json"), &journal); err != nil {
		t.Fatal(err)
	}
	renameCount := 0
	for _, item := range journal.Items {
		if item.HadOriginal {
			renameCount++
		}
		if item.HasPrepared {
			renameCount++
		}
	}
	if renameCount < 8 {
		t.Fatalf("incomplete fault coverage: %d renames", renameCount)
	}
	t.Run("cancelled_replacement", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "state")
		if err := copyFlowerTree(t.Context(), state, target); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		err := recoverFlowerReplacementWith(ctx, target, func() error { cancel(); return ctx.Err() })
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled replacement = %v", err)
		}
		if _, err := os.Stat(filepath.Join(target, flowerMaintenanceDir, "restore.json")); err != nil {
			t.Fatalf("cancel removed the recovery journal: %v", err)
		}
		for _, scene := range []string{"prepared", "previous"} {
			if _, err := os.Stat(filepath.Join(target, flowerMaintenanceDir, "restore-"+journal.ID, scene)); err != nil {
				t.Fatalf("cancel lost %s scene: %v", scene, err)
			}
		}
		resumed, err := NewServiceContext(t.Context(), fixtureMaintenanceOptions(t, target))
		if err != nil {
			t.Fatal(err)
		}
		defer resumed.Close()
		view, err := resumed.threadRuntime.View(t.Context(), identity.ThreadID(fixture.WaitingThreadID))
		if err != nil || view.Activity != flruntime.ThreadActivityIdle || len(view.RestoredInputs) != 1 {
			t.Fatalf("cancel resumed mixed or executable data: %+v %v", view, err)
		}
	})
	for cut := 1; cut <= renameCount; cut++ {
		t.Run(fmt.Sprintf("rename_%02d", cut), func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "state")
			if err := copyFlowerTree(t.Context(), state, target); err != nil {
				t.Fatal(err)
			}
			calls := 0
			err := recoverFlowerReplacementWith(t.Context(), target, func() error {
				calls++
				if calls == cut {
					return interrupted
				}
				return nil
			})
			if !errors.Is(err, interrupted) {
				t.Fatalf("interruption: %v", err)
			}
			// A new generation must roll the journal forward before opening storage.
			resumed, err := NewServiceContext(t.Context(), fixtureMaintenanceOptions(t, target))
			if err != nil {
				t.Fatal(err)
			}
			defer resumed.Close()
			view, err := resumed.threadRuntime.View(t.Context(), identity.ThreadID(fixture.WaitingThreadID))
			if err != nil || view.Activity != flruntime.ThreadActivityIdle || len(view.Queue) != 0 || len(view.RestoredInputs) != 1 {
				t.Fatalf("mixed or executable restored collection: %+v %v", view, err)
			}
			if _, err := os.Stat(filepath.Join(target, flowerMaintenanceDir, "restore.json")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("journal remains: %v", err)
			}
			actual, err := hashFlowerFile(t.Context(), filepath.Join(target, "ai/uploads", fixture.AttachmentID+".data"), "ai/uploads/"+fixture.AttachmentID+".data")
			if err != nil || actual.SHA256 != fixture.Files[actual.Path] {
				t.Fatalf("attachment changed: %+v %v", actual, err)
			}
		})
	}
}

func TestFlowerRestoreRejectsAlteredSnapshotBeforeChangingLiveData(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	snapshotID := captureFixtureSnapshot(t, state)
	opts := fixtureMaintenanceOptions(t, state)
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := hashFlowerFiles(t.Context(), state)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(state, flowerMaintenanceDir, "snapshots", snapshotID, flowerStorageRoots[0])
	file, err := os.OpenFile(source, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.WriteString("tampered"); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	err = RestoreFlowerSnapshot(t.Context(), opts, snapshotID)
	var startup *FloretStoreStartupError
	if !errors.As(err, &startup) || startup.Class != FloretStoreStartupIntegrityError {
		t.Fatalf("classification: %v", err)
	}
	after, err := hashFlowerFiles(t.Context(), state)
	if err != nil {
		t.Fatal(err)
	}
	for _, original := range before {
		if strings.HasPrefix(original.Path, flowerMaintenanceDir+"/") {
			continue
		}
		if !slices.Contains(after, original) {
			t.Fatalf("live file changed: %s", original.Path)
		}
	}
}

func TestFlowerRestoreRejectsOldTransportGeneration(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-waiting")
	snapshotID := captureFixtureSnapshot(t, state)
	opts := fixtureMaintenanceOptions(t, state)
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	var previous string
	for range 2 {
		if err = RestoreFlowerSnapshot(t.Context(), opts, snapshotID); err != nil {
			t.Fatal(err)
		}
		resumed, err := NewServiceContext(t.Context(), opts)
		if err != nil {
			t.Fatal(err)
		}
		if resumed.StorageGeneration() == previous || resumed.StorageGeneration() == "" {
			t.Fatal("restore reused a transport generation")
		}
		meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, EndpointID: "fixture_endpoint", ChannelID: "fixture_channel", UserPublicID: "fixture_user"}
		_, err = resumed.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "stale_browser_request", StorageGeneration: previous, Input: RunInput{Text: "must not replay"}})
		if !errors.Is(err, ErrFlowerStorageRestored) {
			t.Fatalf("stale request=%v", err)
		}
		previous = resumed.StorageGeneration()
		if err = resumed.Close(); err != nil {
			t.Fatal(err)
		}
		reopened, err := NewServiceContext(t.Context(), opts)
		if err != nil {
			t.Fatal(err)
		}
		if reopened.StorageGeneration() != previous {
			t.Fatal("generation did not survive restart")
		}
		if err = reopened.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
