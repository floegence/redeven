package ai

import (
	"compress/gzip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	flruntime "github.com/floegence/floret/v2/runtime"
	flstorage "github.com/floegence/floret/v2/storage"
)

func TestPrepareFloretStorageInitializesAndVerifiesEmptyBackend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "floret.sqlite")
	var phases []FloretStoreStartupPhase
	source, err := prepareFloretStorage(context.Background(), path, func(phase FloretStoreStartupPhase) {
		phases = append(phases, phase)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(phases, []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupVerifying}) {
		t.Fatalf("phases = %v", phases)
	}
	host, err := flruntime.Open(context.Background(), flruntime.Options{Storage: source})
	if err != nil {
		t.Fatal(err)
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareFloretStorageMigratesExactPublishedSchemaV16Once(t *testing.T) {
	path := filepath.Join(t.TempDir(), "floret.sqlite")
	expandGzipFixture(t, filepath.Join("testdata", "floret_v0_26_0_current.sqlite.gz"), path)

	var phases []FloretStoreStartupPhase
	source, err := prepareFloretStorage(context.Background(), path, func(phase FloretStoreStartupPhase) {
		phases = append(phases, phase)
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupMigrating, FloretStoreStartupVerifying}
	if !reflect.DeepEqual(phases, want) {
		t.Fatalf("phases = %v, want %v", phases, want)
	}
	host, err := flruntime.Open(context.Background(), flruntime.Options{Storage: source})
	if err != nil {
		t.Fatal(err)
	}
	reader, err := host.ThreadReader(context.Background(), "fixture-v026-thread")
	if err != nil {
		t.Fatal(err)
	}
	overview, err := reader.ReadOverview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Thread.ID != "fixture-v026-thread" || overview.Thread.Title != "Published v0.26 fixture" {
		t.Fatalf("migrated thread = %#v", overview.Thread)
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}

	phases = nil
	if _, err := prepareFloretStorage(context.Background(), path, func(phase FloretStoreStartupPhase) { phases = append(phases, phase) }); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(phases, []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupVerifying}) {
		t.Fatalf("restart phases = %v", phases)
	}
}

func TestPrepareFloretStorageRejectsUnsupportedDatabaseWithoutMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-floret.sqlite")
	if err := os.WriteFile(path, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = prepareFloretStorage(context.Background(), path, nil)
	startup := requireFloretStartupError(t, err, FloretStoreStartupIOError)
	if startup.Committed || startup.RolledBack {
		t.Fatalf("unexpected migration facts: %#v", startup)
	}
	after, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !reflect.DeepEqual(after, before) {
		t.Fatal("unsupported database was modified")
	}
}

func TestPrepareFloretStorageRejectsInvalidInputAndCancellation(t *testing.T) {
	if _, err := prepareFloretStorage(nil, "x", nil); err == nil {
		t.Fatal("nil context was accepted")
	}
	if _, err := prepareFloretStorage(context.Background(), "", nil); err == nil {
		t.Fatal("empty path was accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := prepareFloretStorage(ctx, filepath.Join(t.TempDir(), "floret.sqlite"), nil)
	startup := requireFloretStartupError(t, err, FloretStoreStartupCancelled)
	if !startup.Retryable || !startup.SafeToRetry || startup.Committed {
		t.Fatalf("cancelled startup = %#v", startup)
	}
}

func TestClassifyFloretMigrationErrorPreservesFailClosedFacts(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantClass FloretStoreStartupClass
		retryable bool
	}{
		{name: "schema", err: &flstorage.MigrationSchemaError{Version: "15", Reason: "unsupported"}, wantClass: FloretStoreStartupUnsupportedStore},
		{name: "operation conflict", err: flstorage.ErrMigrationConflict, wantClass: FloretStoreStartupConfigurationError},
		{name: "cancelled", err: context.Canceled, wantClass: FloretStoreStartupCancelled, retryable: true},
		{name: "rollback", err: errors.New("write failed"), wantClass: FloretStoreStartupMigrationRolledBack, retryable: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			startup := requireFloretStartupError(t, classifyFloretMigrationError(test.err), test.wantClass)
			if startup.Committed || !startup.RolledBack || startup.Retryable != test.retryable {
				t.Fatalf("startup = %#v", startup)
			}
		})
	}
}

func requireFloretStartupError(t *testing.T, err error, class FloretStoreStartupClass) *FloretStoreStartupError {
	t.Helper()
	var startup *FloretStoreStartupError
	if !errors.As(err, &startup) {
		t.Fatalf("error = %T %v", err, err)
	}
	if startup.Class != class || startup.OperationID != floretV2MigrationOperationID {
		t.Fatalf("startup = %#v, want class %q", startup, class)
	}
	return startup
}

func expandGzipFixture(t *testing.T, sourcePath, destinationPath string) {
	t.Helper()
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	compressed, err := gzip.NewReader(source)
	if err != nil {
		t.Fatal(err)
	}
	defer compressed.Close()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(destination, compressed); err != nil {
		_ = destination.Close()
		t.Fatal(err)
	}
	if err := destination.Close(); err != nil {
		t.Fatal(err)
	}
}
