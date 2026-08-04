package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	flruntime "github.com/floegence/floret/v3/runtime"
	flstoragespi "github.com/floegence/floret/v3/storage/spi"
)

func TestOpenFloretRuntimeUsesOnePublishedHostOpen(t *testing.T) {
	var phases []FloretStoreStartupPhase
	openCalls := 0
	bootstrap, _, err := openFloretRuntimeWith(
		context.Background(),
		filepath.Join(t.TempDir(), "floret.sqlite"),
		func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
		func(ctx context.Context, options flruntime.Options) (*flruntime.Host, error) {
			openCalls++
			return flruntime.Open(ctx, options)
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if openCalls != 1 {
		t.Fatalf("Floret runtime opens = %d, want 1", openCalls)
	}
	if !reflect.DeepEqual(phases, []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupVerifying}) {
		t.Fatalf("phases = %v", phases)
	}
	if err := bootstrap.close(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenFloretRuntimeClassifiesTheSinglePublishedOpenFailure(t *testing.T) {
	openCalls := 0
	_, _, err := openFloretRuntimeWith(
		context.Background(),
		filepath.Join(t.TempDir(), "floret.sqlite"),
		nil,
		func(context.Context, flruntime.Options) (*flruntime.Host, error) {
			openCalls++
			return nil, flstoragespi.ErrConflict
		},
	)
	startup := requireFloretStartupError(t, err, FloretStoreStartupTemporarilyBlocked)
	if !startup.Retryable || !startup.SafeToRetry {
		t.Fatalf("startup = %#v", startup)
	}
	if openCalls != 1 {
		t.Fatalf("Floret runtime opens = %d, want 1", openCalls)
	}
}

func TestOpenFloretHostInitializesAndVerifiesEmptyBackend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "floret.sqlite")
	var phases []FloretStoreStartupPhase
	host, err := openFloretHost(context.Background(), path, func(phase FloretStoreStartupPhase) {
		phases = append(phases, phase)
	}, flruntime.Open)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(phases, []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupVerifying}) {
		t.Fatalf("phases = %v", phases)
	}
	if err := host.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestOpenFloretHostRejectsUnsupportedDatabaseWithoutMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-floret.sqlite")
	if err := os.WriteFile(path, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = openFloretHost(context.Background(), path, nil, flruntime.Open)
	_ = requireFloretStartupError(t, err, FloretStoreStartupIOError)
	after, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !reflect.DeepEqual(after, before) {
		t.Fatal("unsupported database was modified")
	}
}

func TestOpenFloretHostRejectsInvalidInputAndCancellation(t *testing.T) {
	var nilContext context.Context
	if _, err := openFloretHost(nilContext, "x", nil, flruntime.Open); err == nil {
		t.Fatal("nil context was accepted")
	}
	if _, err := openFloretHost(context.Background(), "", nil, flruntime.Open); err == nil {
		t.Fatal("empty path was accepted")
	}
	if _, err := openFloretHost(context.Background(), "x", nil, nil); err == nil {
		t.Fatal("nil opener was accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := openFloretHost(ctx, filepath.Join(t.TempDir(), "floret.sqlite"), nil, flruntime.Open)
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
