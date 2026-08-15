package redevpluginintegration

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/floegence/redevplugin/v2/pkg/ownerscope"
)

func TestPrepareOwnerScopeGenerationProjectsEligibleCopiedRootWithoutMutation(t *testing.T) {
	stateDir := copiedOwnerScopeState(t)
	root := filepath.Join(stateDir, "apps", "redevplugin")
	before := ownerScopeTreeDigest(t, root)

	generation, err := PrepareOwnerScopeGeneration(context.Background(), stateDir)
	var recoveryRequired *OwnerScopeRecoveryRequiredError
	if generation.Path != "" || !errors.As(err, &recoveryRequired) {
		t.Fatalf("PrepareOwnerScopeGeneration() = %#v, %v", generation, err)
	}
	if err := recoveryRequired.Plan.Validate(); err != nil {
		t.Fatalf("recovery plan validation error = %v", err)
	}
	if !errors.Is(err, ownerscope.ErrOwnerScopeJournalCorrupt) {
		t.Fatalf("typed recovery error lost original cause: %v", err)
	}
	after := ownerScopeTreeDigest(t, root)
	if after != before {
		t.Fatalf("read-only recovery inspection changed plugin root: before=%s after=%s", before, after)
	}
}

func TestPrepareOwnerScopeGenerationDoesNotOfferRecoveryForCorruptOrUnknownState(t *testing.T) {
	for _, test := range []struct {
		name    string
		relPath string
		body    string
		want    error
	}{
		{name: "corrupt journal", relPath: ownerscope.MigrationJournalName, body: "{", want: ownerscope.ErrOwnerScopeJournalCorrupt},
		{name: "unknown state", relPath: "db/unknown.sqlite", body: "unknown", want: ownerscope.ErrOwnerScopeMigrationRequired},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			path := filepath.Join(stateDir, "apps", "redevplugin", filepath.FromSlash(test.relPath))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(test.body), 0o600); err != nil {
				t.Fatal(err)
			}
			before := ownerScopeTreeDigest(t, filepath.Join(stateDir, "apps", "redevplugin"))
			_, err := PrepareOwnerScopeGeneration(context.Background(), stateDir)
			var recoveryRequired *OwnerScopeRecoveryRequiredError
			if errors.As(err, &recoveryRequired) || !errors.Is(err, test.want) {
				t.Fatalf("PrepareOwnerScopeGeneration() error = %v, recovery = %#v", err, recoveryRequired)
			}
			if after := ownerScopeTreeDigest(t, filepath.Join(stateDir, "apps", "redevplugin")); after != before {
				t.Fatalf("rejected state changed: before=%s after=%s", before, after)
			}
		})
	}
}

func TestRecoverOwnerScopeRetainsArchiveAndCommitsFreshReusableGeneration(t *testing.T) {
	stateDir := copiedOwnerScopeState(t)
	plan, err := InspectOwnerScopeRecovery(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RecoverOwnerScope(context.Background(), stateDir, strings.Repeat("0", 64)); !errors.Is(err, ownerscope.ErrOwnerScopeRecoveryPlanMismatch) {
		t.Fatalf("stale recovery plan error = %v", err)
	}

	result, err := RecoverOwnerScope(context.Background(), stateDir, plan.PlanSHA256)
	if err != nil {
		t.Fatal(err)
	}
	if result.Plan != plan || result.RecoveryID == "" || result.ArchivePath == "" || result.GenerationPath == "" || result.FreshGenerationID == "" {
		t.Fatalf("recovery result = %#v", result)
	}
	if _, err := os.Stat(filepath.Join(result.ArchivePath, ownerscope.MigrationJournalName)); err != nil {
		t.Fatalf("retained archive migration journal: %v", err)
	}
	for _, rel := range []string{"db", "storage", "settings", "secrets"} {
		if _, err := os.Stat(filepath.Join(result.GenerationPath, rel)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("fresh generation inherited %s: %v", rel, err)
		}
	}
	reopened, err := PrepareOwnerScopeGeneration(context.Background(), stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Path != result.GenerationPath || reopened.Status.FreshGenerationID != result.FreshGenerationID {
		t.Fatalf("reopened generation = %#v, result = %#v", reopened, result)
	}
}

func copiedOwnerScopeState(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	sourceStateDir := t.TempDir()
	sourceRoot := filepath.Join(sourceStateDir, "apps", "redevplugin")
	if err := os.MkdirAll(sourceRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	generation, err := ownerscope.PrepareOwnerScopeGeneration(ctx, sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(generation.Path, "storage", "copied-user-state")
	if err := os.MkdirAll(filepath.Dir(marker), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("untrusted copied state"), 0o600); err != nil {
		t.Fatal(err)
	}

	destinationStateDir := t.TempDir()
	destinationRoot := filepath.Join(destinationStateDir, "apps", "redevplugin")
	copyOwnerScopeTree(t, sourceRoot, destinationRoot)
	return destinationStateDir
}

func copyOwnerScopeTree(t *testing.T, source, destination string) {
	t.Helper()
	err := filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if entry.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported owner scope fixture entry %s", path)
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, body, info.Mode().Perm())
	})
	if err != nil {
		t.Fatal(err)
	}
}

func ownerScopeTreeDigest(t *testing.T, root string) string {
	t.Helper()
	var records []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		record := relative + "\x00" + info.Mode().String()
		if entry.Type().IsRegular() {
			body, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			digest := sha256.Sum256(body)
			record += "\x00" + fmt.Sprintf("%x", digest)
		} else if entry.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			record += "\x00" + link
		}
		records = append(records, record)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(records)
	digest := sha256.Sum256([]byte(strings.Join(records, "\n")))
	return fmt.Sprintf("%x", digest)
}
