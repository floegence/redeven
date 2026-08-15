package lockfile

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

const lockOwnerHelperEnv = "REDEVEN_LOCKFILE_TEST_OWNER"

func TestAcquireRejectsLiveOwnerAndRecoversAfterOwnerExit(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "runtime.lock")
	command := exec.Command(os.Args[0], "-test.run=TestLockOwnerHelperProcess")
	command.Env = append(os.Environ(), lockOwnerHelperEnv+"=1", "REDEVEN_LOCKFILE_TEST_PATH="+lockPath)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()

	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "locked" {
		t.Fatalf("lock owner did not start: output=%q error=%v", scanner.Text(), scanner.Err())
	}
	if second, err := Acquire(lockPath); !errors.Is(err, ErrAlreadyLocked) {
		if second != nil {
			_ = second.Release()
		}
		t.Fatalf("concurrent Acquire() error = %v, want ErrAlreadyLocked", err)
	}

	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err == nil {
		t.Fatal("abnormally terminated lock owner returned no error")
	}
	recovered, err := Acquire(lockPath)
	if err != nil {
		t.Fatalf("Acquire() after owner exit error = %v", err)
	}
	if err := recovered.Release(); err != nil {
		t.Fatalf("Release() recovered lock error = %v", err)
	}
}

func TestLockOwnerHelperProcess(t *testing.T) {
	if os.Getenv(lockOwnerHelperEnv) != "1" {
		return
	}
	lock, err := Acquire(os.Getenv("REDEVEN_LOCKFILE_TEST_PATH"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()
	_, _ = fmt.Fprintln(os.Stdout, "locked")
	select {}
}

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
