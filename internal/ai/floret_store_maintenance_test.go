package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
)

func TestOpenFloretRuntimeColdStart(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	runtime, err := openFloretRuntime(context.Background(), storePath, nil, nil)
	if err != nil {
		t.Fatalf("open cold Floret runtime: %v", err)
	}
	if runtime == nil || runtime.threadRuntime == nil {
		t.Fatal("cold start returned no typed thread runtime")
	}
	if err := runtime.close(); err != nil {
		t.Fatalf("close cold Floret runtime: %v", err)
	}
}

func TestOpenFloretRuntimeOpensOnceWithoutPreOpenMaintenance(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	phases := make([]FloretStoreStartupPhase, 0, 3)
	openCalls := 0
	runtime, err := openFloretRuntimeWith(
		context.Background(),
		storePath,
		func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
		slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		func(ctx context.Context, opts flruntime.Options) (*flruntime.Host, error) {
			openCalls++
			opts.StartupProgress.OnStartupPhase(flruntime.StartupPhaseVerifying)
			return flruntime.Open(ctx, flruntime.Options{Storage: flstorage.Memory()})
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.close() })
	if openCalls != 1 {
		t.Fatalf("runtime opens = %d, want one", openCalls)
	}
	wantPhases := []FloretStoreStartupPhase{FloretStoreStartupVerifying}
	if fmt.Sprint(phases) != fmt.Sprint(wantPhases) {
		t.Fatalf("startup phases = %v, want %v", phases, wantPhases)
	}
}

func TestOpenFloretRuntimePreservesCorruptStore(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	original := []byte("not-a-sqlite-database\n")
	if err := os.WriteFile(storePath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime, err := openFloretRuntime(context.Background(), storePath, nil, nil); err == nil {
		if runtime != nil {
			_ = runtime.close()
		}
		t.Fatal("corrupt Floret store opened successfully")
	}
	after, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, original) {
		t.Fatalf("corrupt store changed: got %q, want byte-for-byte preservation", after)
	}
}

func TestClassifyFloretStorageOpenErrorTreatsSQLiteBusyAsTemporary(t *testing.T) {
	err := classifyFloretStorageOpenError(errors.New("sqlite busy: database is locked"))
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) {
		t.Fatalf("classified error = %T %v, want FloretStoreStartupError", err, err)
	}
	if startupErr.Class != FloretStoreStartupTemporarilyBlocked || !startupErr.Retryable || !startupErr.SafeToRetry {
		t.Fatalf("startup error = %#v, want temporary retryable classification", startupErr)
	}
}

func TestClassifyFloretStorageOpenErrorTreatsAuthorityCorruptionAsIntegrityFailure(t *testing.T) {
	err := classifyFloretStorageOpenError(fmt.Errorf("open runtime: %w", flruntime.ErrAuthorityCorrupt))
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) {
		t.Fatalf("classified error = %T %v, want FloretStoreStartupError", err, err)
	}
	if startupErr.Class != FloretStoreStartupIntegrityError || startupErr.Retryable || startupErr.SafeToRetry {
		t.Fatalf("startup error = %#v, want fail-closed integrity classification", startupErr)
	}
}

func TestOpenFloretRuntimeReportsVerifyingBeforeClassifiedOpenFailure(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	phases := make([]FloretStoreStartupPhase, 0, 3)
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	_, err := openFloretRuntimeWith(
		t.Context(),
		storePath,
		func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
		logger,
		func(_ context.Context, opts flruntime.Options) (*flruntime.Host, error) {
			opts.StartupProgress.OnStartupPhase(flruntime.StartupPhaseVerifying)
			return nil, fmt.Errorf("private backend detail: %w", flruntime.ErrAuthorityCorrupt)
		},
	)
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) || startupErr.Class != FloretStoreStartupIntegrityError {
		t.Fatalf("startup error=%#v, want integrity classification", startupErr)
	}
	wantPhases := []FloretStoreStartupPhase{FloretStoreStartupVerifying}
	if fmt.Sprint(phases) != fmt.Sprint(wantPhases) {
		t.Fatalf("startup phases=%v, want %v", phases, wantPhases)
	}
	logged := logs.String()
	if !strings.Contains(logged, "startup_phase=verifying") || !strings.Contains(logged, "error_class=store_integrity_error") {
		t.Fatalf("sanitized startup log=%q", logged)
	}
	if strings.Contains(logged, "private backend detail") {
		t.Fatalf("startup log exposed raw error: %q", logged)
	}
}

func TestOpenFloretRuntimeForwardsMigrationPhasesFromFloret(t *testing.T) {
	phases := make([]FloretStoreStartupPhase, 0, 4)
	result, err := openFloretRuntimeWith(
		t.Context(),
		filepath.Join(t.TempDir(), "floret.sqlite"),
		func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
		nil,
		func(ctx context.Context, opts flruntime.Options) (*flruntime.Host, error) {
			opts.StartupProgress.OnStartupPhase(flruntime.StartupPhaseMigrating)
			opts.StartupProgress.OnStartupPhase(flruntime.StartupPhaseVerifying)
			return flruntime.Open(ctx, flruntime.Options{Storage: flstorage.Memory()})
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = result.close() })
	want := []FloretStoreStartupPhase{FloretStoreStartupMigrating, FloretStoreStartupVerifying}
	if fmt.Sprint(phases) != fmt.Sprint(want) {
		t.Fatalf("startup phases = %v, want %v", phases, want)
	}
}

func TestOpenFloretFailureUsesActualPhaseAndSanitizedLog(t *testing.T) {
	for _, phase := range []flruntime.StartupPhase{"", flruntime.StartupPhaseMigrating, flruntime.StartupPhaseVerifying} {
		t.Run(string(phase), func(t *testing.T) {
			var logs bytes.Buffer
			_, err := openFloretHost(t.Context(), filepath.Join(t.TempDir(), "floret.sqlite"), nil, slog.New(slog.NewTextHandler(&logs, nil)),
				func(_ context.Context, opts flruntime.Options) (*flruntime.Host, error) {
					if phase != "" {
						opts.StartupProgress.OnStartupPhase(phase)
					}
					return nil, errors.New("private backend diagnostic")
				})
			var failure *FloretStoreStartupError
			if !errors.As(err, &failure) {
				t.Fatal(err)
			}
			want := string(phase)
			if want == "" {
				want = "opening"
			}
			if failure.Phase != want || !strings.Contains(logs.String(), "startup_phase="+want) {
				t.Fatalf("failure phase=%q logs=%s", failure.Phase, logs.String())
			}
			if strings.Contains(logs.String(), "private backend diagnostic") {
				t.Fatal("raw diagnostic exposed")
			}
		})
	}
}

func TestClassifyFloretStorageOpenErrorFailsClosedForUnknownAndPermissionErrors(t *testing.T) {
	tests := []struct {
		name  string
		err   error
		class FloretStoreStartupClass
	}{
		{name: "unknown io", err: errors.New("opaque storage failure"), class: FloretStoreStartupIOError},
		{name: "opaque temporary text", err: errors.New("provider temporarily unavailable"), class: FloretStoreStartupIOError},
		{name: "canonical import conflict", err: flruntime.ErrRequestConflict, class: FloretStoreStartupMigrationFailed},
		{name: "permission", err: os.ErrPermission, class: FloretStoreStartupEnvironmentPermissionError},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := classifyFloretStorageOpenError(test.err)
			var startupErr *FloretStoreStartupError
			if !errors.As(err, &startupErr) {
				t.Fatalf("classified error = %T %v, want FloretStoreStartupError", err, err)
			}
			if startupErr.Class != test.class || startupErr.Retryable || startupErr.SafeToRetry {
				t.Fatalf("startup error = %#v, want fail-closed class %q", startupErr, test.class)
			}
		})
	}
}
