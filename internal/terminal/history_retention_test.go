package terminal

import (
	"errors"
	"testing"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestHistoryRetentionEnforcesProductPermissionsAndAttachment(t *testing.T) {
	manager := newQuietTestManager(t, t.TempDir())
	t.Cleanup(manager.Cleanup)
	shell, err := manager.createSession("retention", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := shell.LatestPresentation(); !ok {
		t.Skip("native lane required")
	}
	owner := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, UserPublicID: "owner"}
	denied := func(meta *session.Meta, id string, code uint32) {
		t.Helper()
		_, err := manager.SessionHistoryRetention(meta, id, "view", 1, &termgo.HistoryRetentionLimits{})
		var rpc *sessionrpc.Error
		if !errors.As(err, &rpc) || rpc.Code != code {
			t.Fatalf("permission error=%v, want %d", err, code)
		}
	}
	denied(&session.Meta{CanRead: true, CanExecute: true}, shell.ID, 403)
	denied(&session.Meta{CanRead: true, CanWrite: true}, shell.ID, 403)
	if err := shell.AttachSemanticView("view", "local", 1); err != nil {
		t.Fatal(err)
	}
	zero := uint64(0)
	state, err := manager.SessionHistoryRetention(owner, shell.ID, "view", 1, &termgo.HistoryRetentionLimits{MaxBytes: &zero})
	if err != nil || state.Configured.MaxBytes == nil || *state.Configured.MaxBytes != 0 {
		t.Fatalf("apply=%+v %v", state, err)
	}
	_, err = manager.SessionHistoryRetention(owner, shell.ID, "view", 2, &termgo.HistoryRetentionLimits{})
	var rpc *sessionrpc.Error
	if !errors.As(err, &rpc) || rpc.Code != 409 {
		t.Fatalf("stale attachment=%v", err)
	}
	exec, err := manager.CreateContainerExecSession(ContainerExecSessionRequest{Name: "Exec", Executable: "/bin/sh", OwnerUserID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	denied(&session.Meta{CanRead: true, CanWrite: true, CanExecute: true, UserPublicID: "other"}, exec.ID, 403)
	execSession, _ := manager.term.GetSession(exec.ID)
	if err := execSession.AttachSemanticView("exec", "local", 3); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SessionHistoryRetention(&session.Meta{CanRead: true, CanExecute: true, UserPublicID: "owner"}, exec.ID, "exec", 3, &termgo.HistoryRetentionLimits{MaxLines: &zero}); err != nil {
		t.Fatal(err)
	}
}
