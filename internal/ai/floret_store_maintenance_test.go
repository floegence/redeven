package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	flruntime "github.com/floegence/floret/v4/runtime"
)

func TestOpenFloretRuntimeColdStart(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	runtime, err := openFloretRuntime(context.Background(), storePath, nil)
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

func TestOpenFloretRuntimePreservesCorruptStore(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "floret.sqlite")
	original := []byte("not-a-sqlite-database\n")
	if err := os.WriteFile(storePath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime, err := openFloretRuntime(context.Background(), storePath, nil); err == nil {
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
