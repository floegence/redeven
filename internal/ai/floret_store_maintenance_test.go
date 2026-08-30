package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v6/runtime"
	flstorage "github.com/floegence/floret/v6/storage"
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

func TestOpenFloretRuntimeMaintainsBeforeSingleOpen(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	phases := make([]FloretStoreStartupPhase, 0, 3)
	maintainCalls := 0
	openCalls := 0
	runtime, err := openFloretRuntimeWith(
		context.Background(),
		storePath,
		func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		func(_ context.Context, gotPath string, policy flstorage.SQLiteMaintenancePolicy) (flstorage.SQLiteMaintenanceResult, error) {
			maintainCalls++
			if gotPath != storePath {
				t.Fatalf("maintenance path = %q, want %q", gotPath, storePath)
			}
			if policy != floretStoreMaintenancePolicy {
				t.Fatalf("maintenance policy = %#v, want %#v", policy, floretStoreMaintenancePolicy)
			}
			return flstorage.SQLiteMaintenanceResult{Action: flstorage.SQLiteMaintenanceActionNone, Reason: "database_missing"}, nil
		},
		func(ctx context.Context, _ flruntime.Options) (*flruntime.Host, error) {
			openCalls++
			return flruntime.Open(ctx, flruntime.Options{Storage: flstorage.Memory()})
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.close() })
	if maintainCalls != 1 || openCalls != 1 {
		t.Fatalf("calls = maintain:%d open:%d, want exactly one of each", maintainCalls, openCalls)
	}
	wantPhases := []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupOptimizing, FloretStoreStartupVerifying}
	if fmt.Sprint(phases) != fmt.Sprint(wantPhases) {
		t.Fatalf("startup phases = %v, want %v", phases, wantPhases)
	}
}

func TestOpenFloretRuntimeFailsClosedBeforeRuntimeOpenWhenMaintenanceValidationFails(t *testing.T) {
	openCalls := 0
	_, err := openFloretRuntimeWith(
		context.Background(),
		filepath.Join(t.TempDir(), "floret.sqlite"),
		nil,
		nil,
		func(context.Context, string, flstorage.SQLiteMaintenancePolicy) (flstorage.SQLiteMaintenanceResult, error) {
			return flstorage.SQLiteMaintenanceResult{}, errors.New("maintenance inspection unavailable")
		},
		func(ctx context.Context, _ flruntime.Options) (*flruntime.Host, error) {
			openCalls++
			return flruntime.Open(ctx, flruntime.Options{Storage: flstorage.Memory()})
		},
	)
	if err == nil {
		t.Fatal("maintenance validation failure opened the runtime")
	}
	if openCalls != 0 {
		t.Fatalf("runtime opens = %d, want 0", openCalls)
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
		func(context.Context, string, flstorage.SQLiteMaintenancePolicy) (flstorage.SQLiteMaintenanceResult, error) {
			return flstorage.SQLiteMaintenanceResult{Action: flstorage.SQLiteMaintenanceActionNone, Reason: "file_below_threshold"}, nil
		},
		func(context.Context, flruntime.Options) (*flruntime.Host, error) {
			return nil, fmt.Errorf("private backend detail: %w", flruntime.ErrAuthorityCorrupt)
		},
	)
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) || startupErr.Class != FloretStoreStartupIntegrityError {
		t.Fatalf("startup error=%#v, want integrity classification", startupErr)
	}
	wantPhases := []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupOptimizing, FloretStoreStartupVerifying}
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

func TestClassifyFloretStorageOpenErrorFailsClosedForUnknownAndPermissionErrors(t *testing.T) {
	tests := []struct {
		name  string
		err   error
		class FloretStoreStartupClass
	}{
		{name: "unknown io", err: errors.New("opaque storage failure"), class: FloretStoreStartupIOError},
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
