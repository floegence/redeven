package managedwebservice

import (
	"errors"
	"math"
	"os"
	"testing"
)

func TestReadManagedProcessRejectsWrappedPID(t *testing.T) {
	for _, pid := range []int{-1, 0, math.MaxInt32 + 1, os.Getpid() + 1<<32} {
		if _, err := readManagedProcess(pid); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("invalid PID %d: %v", pid, err)
		}
	}
	if _, err := readManagedProcess(os.Getpid()); err != nil {
		t.Fatal(err)
	}
}
