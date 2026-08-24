package terminal

import (
	"errors"
	"io"
	"log/slog"
	"testing"
)

func TestTerminalCreationFailsBeforeProcessLaunchWhenWorkloadAdmissionFails(t *testing.T) {
	manager := NewManager("", t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.Cleanup)
	manager.SetWorkloadAdmission(func() (func(), error) {
		return nil, errors.New("workload admission denied")
	})

	if _, err := manager.CreateSession("blocked", ""); err == nil {
		t.Fatal("terminal creation succeeded after workload admission failed")
	}
	if sessions := manager.VisibleSessionIDs(); len(sessions) != 0 {
		t.Fatalf("terminal processes were created after workload admission failed: %#v", sessions)
	}
}
