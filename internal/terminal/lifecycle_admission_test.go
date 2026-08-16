package terminal

import (
	"errors"
	"io"
	"log/slog"
	"testing"
)

func TestTerminalCreationFailsBeforeProcessLaunchWhenLifecycleAdmissionIsClosed(t *testing.T) {
	manager := NewManager("", t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.Cleanup)
	manager.SetWorkloadAdmission(func() (func(), error) {
		return nil, errors.New("lifecycle fence held")
	})

	if _, err := manager.CreateSession("blocked", ""); err == nil {
		t.Fatal("terminal creation succeeded while Runtime lifecycle admission was closed")
	}
	if sessions := manager.VisibleSessionIDs(); len(sessions) != 0 {
		t.Fatalf("terminal processes were created before lifecycle admission: %#v", sessions)
	}
}
