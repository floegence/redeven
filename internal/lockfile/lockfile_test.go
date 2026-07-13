package lockfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReleaseClearsActiveLeaseContentBeforeUnlock(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "runtime.lock")
	lk, err := Acquire(lockPath)
	if err != nil {
		t.Fatalf("Acquire() error = %v", err)
	}
	if err := lk.SetContent([]byte("active runtime lease\n")); err != nil {
		t.Fatalf("SetContent() error = %v", err)
	}
	if err := lk.Release(); err != nil {
		t.Fatalf("Release() error = %v", err)
	}

	body, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if len(body) != 0 {
		t.Fatalf("lock content after Release = %q, want empty", string(body))
	}
}

func TestRetireIfEvaluatesAndClearsContentWhileLocked(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "runtime.lock")
	original := []byte("active runtime lease\n")
	if err := os.WriteFile(lockPath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	retired, err := RetireIf(lockPath, func(body []byte) (bool, error) {
		if string(body) != string(original) {
			t.Fatalf("predicate content = %q, want %q", string(body), string(original))
		}
		return true, nil
	})
	if err != nil {
		t.Fatalf("RetireIf() error = %v", err)
	}
	if !retired {
		t.Fatal("RetireIf() retired = false, want true")
	}
	body, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != 0 {
		t.Fatalf("lock content after RetireIf = %q, want empty", string(body))
	}
}

func TestRetireIfPreservesRejectedContent(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "runtime.lock")
	original := []byte("another runtime lease\n")
	if err := os.WriteFile(lockPath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	retired, err := RetireIf(lockPath, func([]byte) (bool, error) { return false, nil })
	if err != nil {
		t.Fatalf("RetireIf() error = %v", err)
	}
	if retired {
		t.Fatal("RetireIf() retired = true, want false")
	}
	body, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != string(original) {
		t.Fatalf("lock content after rejected RetireIf = %q, want %q", string(body), string(original))
	}
}
