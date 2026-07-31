package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	flruntime "github.com/floegence/floret/v3/runtime"
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
	if err := host.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
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
	_ = requireFloretStartupError(t, err, FloretStoreStartupIOError)
	after, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !reflect.DeepEqual(after, before) {
		t.Fatal("unsupported database was modified")
	}
}

func TestPrepareFloretStorageRejectsInvalidInputAndCancellation(t *testing.T) {
	var nilContext context.Context
	if _, err := prepareFloretStorage(nilContext, "x", nil); err == nil {
		t.Fatal("nil context was accepted")
	}
	if _, err := prepareFloretStorage(context.Background(), "", nil); err == nil {
		t.Fatal("empty path was accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := prepareFloretStorage(ctx, filepath.Join(t.TempDir(), "floret.sqlite"), nil)
	startup := requireFloretStartupError(t, err, FloretStoreStartupCancelled)
	if !startup.Retryable || !startup.SafeToRetry {
		t.Fatalf("cancelled startup = %#v", startup)
	}
}

func requireFloretStartupError(t *testing.T, err error, class FloretStoreStartupClass) *FloretStoreStartupError {
	t.Helper()
	var startup *FloretStoreStartupError
	if !errors.As(err, &startup) {
		t.Fatalf("error = %T %v", err, err)
	}
	if startup.Class != class {
		t.Fatalf("startup = %#v, want class %q", startup, class)
	}
	return startup
}
