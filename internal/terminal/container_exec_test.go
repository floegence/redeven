package terminal

import (
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestContainerExecSessionIsHiddenAndUsesReadExecuteOwnerAccess(t *testing.T) {
	t.Parallel()
	manager := newQuietTestManager(t, t.TempDir())
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateContainerExecSession(ContainerExecSessionRequest{
		Name: "Container Exec", Executable: "/bin/sh", OwnerUserID: "user-a",
	})
	if err != nil {
		t.Fatalf("CreateContainerExecSession() error = %v", err)
	}
	if got := manager.visibleSessionInfos(); len(got) != 0 {
		t.Fatalf("visibleSessionInfos() = %+v, want no product Exec session", got)
	}
	if isExec, err := manager.authorizeSessionInteraction(&session.Meta{CanRead: true, CanExecute: true, UserPublicID: "user-a"}, created.ID); err != nil || !isExec {
		t.Fatalf("owner read+execute access = (%v, %v), want Exec access", isExec, err)
	}
	if _, err := manager.authorizeSessionInteraction(&session.Meta{CanRead: true, CanWrite: true, CanExecute: true, UserPublicID: "user-b"}, created.ID); err == nil {
		t.Fatal("other user unexpectedly accessed container Exec session")
	}
	if err := manager.DeleteSession(created.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("DeleteSession() error = %v, want hidden session", err)
	}
	if err := manager.DeleteContainerExecSession(created.ID, "user-b"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("DeleteContainerExecSession(other owner) error = %v", err)
	}
	if err := manager.DeleteContainerExecSession(created.ID, "user-a"); err != nil {
		t.Fatalf("DeleteContainerExecSession(owner) error = %v", err)
	}
	if manager.isContainerExecSession(created.ID) {
		t.Fatal("container Exec session remained registered after close")
	}
}

func TestContainerExecSessionExpiresBeforeFirstAttachment(t *testing.T) {
	t.Parallel()
	manager := newQuietTestManager(t, t.TempDir())
	manager.containerExecInitialTimeout = 20 * time.Millisecond
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateContainerExecSession(ContainerExecSessionRequest{
		Name: "Container Exec", Executable: "/bin/sh", OwnerUserID: "user-a",
	})
	if err != nil {
		t.Fatalf("CreateContainerExecSession() error = %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for manager.isContainerExecSession(created.ID) && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if manager.isContainerExecSession(created.ID) {
		t.Fatal("container Exec session did not expire")
	}
	if _, ok := manager.term.GetSession(created.ID); ok {
		t.Fatal("expired container Exec process remained in terminal manager")
	}
}

func TestContainerExecSessionUsesReconnectWindowAfterDetach(t *testing.T) {
	t.Parallel()
	manager := newQuietTestManager(t, t.TempDir())
	manager.containerExecInitialTimeout = time.Second
	manager.containerExecReconnectTimeout = 25 * time.Millisecond
	t.Cleanup(manager.Cleanup)
	created, err := manager.CreateContainerExecSession(ContainerExecSessionRequest{
		Name: "Container Exec", Executable: "/bin/sh", OwnerUserID: "user-a",
	})
	if err != nil {
		t.Fatalf("CreateContainerExecSession() error = %v", err)
	}
	if !manager.markContainerExecAttached(created.ID) {
		t.Fatal("markContainerExecAttached() = false")
	}
	manager.markContainerExecDetached(created.ID)
	time.Sleep(10 * time.Millisecond)
	if !manager.isContainerExecSession(created.ID) {
		t.Fatal("container Exec session closed before reconnect window")
	}
	deadline := time.Now().Add(time.Second)
	for manager.isContainerExecSession(created.ID) && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if manager.isContainerExecSession(created.ID) {
		t.Fatal("container Exec session remained after reconnect window")
	}
}
