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
