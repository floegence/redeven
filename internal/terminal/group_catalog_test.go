package terminal

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	_ "modernc.org/sqlite"
)

func TestPersistentGroupCatalogCreatesAndRetainsDefault(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(t.TempDir(), "apps", "terminal", "groups.sqlite")
	catalog, err := openPersistentGroupCatalog(path, home)
	if err != nil {
		t.Fatalf("openPersistentGroupCatalog() error = %v", err)
	}
	snapshot := catalog.Snapshot()
	if snapshot.Revision != 1 || len(snapshot.Groups) != 1 {
		t.Fatalf("initial snapshot = %#v, want revision 1 with Default", snapshot)
	}
	if group := snapshot.Groups[0]; group.ID != DefaultTerminalGroupID || group.Name != "Default" || group.DefaultWorkingDir != home || !group.IsDefault {
		t.Fatalf("default group = %#v", group)
	}
	createdSnapshot, created, err := catalog.Create("Services", home)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if createdSnapshot.Revision != 2 || created.ID == "" {
		t.Fatalf("created snapshot = %#v, group = %#v", createdSnapshot, created)
	}
	if err := catalog.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	reopened, err := openPersistentGroupCatalog(path, filepath.Join(home, "ignored"))
	if err != nil {
		t.Fatalf("reopen catalog error = %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	restarted := reopened.Snapshot()
	if restarted.Revision != 2 || len(restarted.Groups) != 2 {
		t.Fatalf("restarted snapshot = %#v", restarted)
	}
	defaultGroup, ok := reopened.Group(DefaultTerminalGroupID)
	if !ok || defaultGroup.DefaultWorkingDir != home {
		t.Fatalf("persisted Default = %#v, %v", defaultGroup, ok)
	}
}

func TestPersistentGroupCatalogRejectsFutureVersionAndDrift(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*sql.DB) error
		check  func(error) bool
	}{
		{
			name: "future version",
			mutate: func(db *sql.DB) error {
				_, err := db.Exec(`PRAGMA user_version = 2`)
				return err
			},
			check: func(err error) bool {
				var target *sqliteutil.DatabaseTooNewError
				return errors.As(err, &target)
			},
		},
		{
			name: "schema drift",
			mutate: func(db *sql.DB) error {
				_, err := db.Exec(`ALTER TABLE terminal_groups ADD COLUMN drift TEXT`)
				return err
			},
			check: func(err error) bool {
				var target *sqliteutil.SchemaVerifyError
				return errors.As(err, &target)
			},
		},
		{
			name: "default data drift",
			mutate: func(db *sql.DB) error {
				_, err := db.Exec(`UPDATE terminal_groups SET name = 'Legacy' WHERE group_id = 'default'`)
				return err
			},
			check: func(err error) bool {
				var target *sqliteutil.SchemaVerifyError
				return errors.As(err, &target)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "groups.sqlite")
			catalog, err := openPersistentGroupCatalog(path, t.TempDir())
			if err != nil {
				t.Fatalf("initialize catalog: %v", err)
			}
			if err := catalog.Close(); err != nil {
				t.Fatalf("close catalog: %v", err)
			}
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatalf("open raw sqlite: %v", err)
			}
			if err := test.mutate(raw); err != nil {
				t.Fatalf("mutate catalog: %v", err)
			}
			if err := raw.Close(); err != nil {
				t.Fatalf("close raw sqlite: %v", err)
			}
			_, err = openPersistentGroupCatalog(path, t.TempDir())
			if !test.check(err) {
				t.Fatalf("reopen error = %T %v", err, err)
			}
		})
	}
}

func TestManagerGroupDefaultsMoveAndProtection(t *testing.T) {
	home := t.TempDir()
	groupDir := filepath.Join(home, "services")
	if err := os.MkdirAll(groupDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	m := newQuietTestManager(t, home)
	t.Cleanup(m.Cleanup)
	if _, _, err := m.CreateGroup("Missing path", ""); err == nil {
		t.Fatal("CreateGroup() accepted an empty default path")
	}
	if _, _, err := m.CreateGroup("Relative path", "services"); err == nil {
		t.Fatal("CreateGroup() accepted a relative default path")
	}

	_, group, err := m.CreateGroup("Services", groupDir)
	if err != nil {
		t.Fatalf("CreateGroup() error = %v", err)
	}
	if _, _, err := m.CreateGroup("services", groupDir); !errors.Is(err, ErrTerminalGroupNameConflict) {
		t.Fatalf("case-insensitive duplicate error = %v", err)
	}
	session, err := m.CreateSessionInGroup(group.ID, "api", "")
	if err != nil {
		t.Fatalf("CreateSessionInGroup() error = %v", err)
	}
	if session.GroupID != group.ID || mustEvalPath(t, session.WorkingDir) != mustEvalPath(t, groupDir) {
		t.Fatalf("created session = %#v", session)
	}
	(&eventHandler{m: m}).OnTerminalNameChanged(session.ID, "api", "api", home)
	if got := m.sessionGroupID(session.ID); got != group.ID {
		t.Fatalf("group after working directory update = %q, want %q", got, group.ID)
	}
	revision, err := m.MoveSessionToGroup(session.ID, DefaultTerminalGroupID)
	if err != nil || revision <= 2 {
		t.Fatalf("MoveSessionToGroup() = (%d, %v)", revision, err)
	}
	if got := m.sessionGroupID(session.ID); got != DefaultTerminalGroupID {
		t.Fatalf("moved group = %q", got)
	}
	updatedSnapshot, updatedDefault, err := m.UpdateGroup(DefaultTerminalGroupID, nil, &groupDir)
	if err != nil {
		t.Fatalf("UpdateGroup(Default path) error = %v", err)
	}
	if updatedSnapshot.Revision <= revision || updatedDefault.Name != "Default" || mustEvalPath(t, updatedDefault.DefaultWorkingDir) != mustEvalPath(t, groupDir) {
		t.Fatalf("updated Default group = %#v at revision %d", updatedDefault, updatedSnapshot.Revision)
	}
	name := "Renamed"
	if _, _, err := m.UpdateGroup(DefaultTerminalGroupID, &name, nil); !errors.Is(err, ErrDefaultTerminalGroupLocked) {
		t.Fatalf("rename Default error = %v", err)
	}
	if _, err := m.DeleteGroup(DefaultTerminalGroupID); !errors.Is(err, ErrDefaultTerminalGroupLocked) {
		t.Fatalf("delete Default error = %v", err)
	}
}

func TestDeleteGroupSerializesMovesAndLimitsCloseConcurrency(t *testing.T) {
	home := t.TempDir()
	m := newQuietTestManager(t, home)
	t.Cleanup(m.Cleanup)
	_, group, err := m.CreateGroup("Concurrent", home)
	if err != nil {
		t.Fatalf("CreateGroup() error = %v", err)
	}
	const sessionCount = 8
	for index := 0; index < sessionCount; index++ {
		_, createErr := m.CreateSessionInGroup(group.ID, "worker", "")
		if createErr != nil {
			t.Fatalf("CreateSessionInGroup(%d) error = %v", index, createErr)
		}
	}
	outsideSession, err := m.CreateSessionInGroup(DefaultTerminalGroupID, "outside", "")
	if err != nil {
		t.Fatalf("create outside session: %v", err)
	}

	started := make(chan struct{}, sessionCount)
	release := make(chan struct{})
	var active atomic.Int32
	var maximum atomic.Int32
	m.deleteSessionFunc = func(sessionID string) error {
		current := active.Add(1)
		for {
			observed := maximum.Load()
			if current <= observed || maximum.CompareAndSwap(observed, current) {
				break
			}
		}
		started <- struct{}{}
		<-release
		active.Add(-1)
		return m.deleteSessionNow(sessionID)
	}

	deleteDone := make(chan error, 1)
	go func() {
		_, deleteErr := m.DeleteGroup(group.ID)
		deleteDone <- deleteErr
	}()
	for index := 0; index < 4; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for bounded group closes")
		}
	}

	moveDone := make(chan error, 1)
	go func() {
		_, moveErr := m.MoveSessionToGroup(outsideSession.ID, group.ID)
		moveDone <- moveErr
	}()
	select {
	case moveErr := <-moveDone:
		t.Fatalf("move completed while group deletion was active: %v", moveErr)
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	if deleteErr := <-deleteDone; deleteErr != nil {
		t.Fatalf("DeleteGroup() error = %v", deleteErr)
	}
	if moveErr := <-moveDone; !errors.Is(moveErr, ErrTerminalGroupNotFound) {
		t.Fatalf("MoveSessionToGroup() after delete error = %v, want missing group", moveErr)
	}
	if maximum.Load() > 4 {
		t.Fatalf("maximum concurrent closes = %d, want at most 4", maximum.Load())
	}
}

func TestDeleteGroupClosesMembersAndReportsHiddenFailures(t *testing.T) {
	home := t.TempDir()
	m := newQuietTestManager(t, home)
	t.Cleanup(m.Cleanup)
	_, group, err := m.CreateGroup("Batch", home)
	if err != nil {
		t.Fatalf("CreateGroup() error = %v", err)
	}
	first, err := m.CreateSessionInGroup(group.ID, "first", "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := m.CreateSessionInGroup(group.ID, "second", "")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	m.deleteSessionFunc = func(sessionID string) error {
		if sessionID == second.ID {
			return errors.New("synthetic close failure")
		}
		return m.deleteSessionNow(sessionID)
	}
	result, err := m.DeleteGroup(group.ID)
	if err != nil {
		t.Fatalf("DeleteGroup() error = %v", err)
	}
	if len(result.FailedSessionIDs) != 1 || result.FailedSessionIDs[0] != second.ID {
		t.Fatalf("failed sessions = %v", result.FailedSessionIDs)
	}
	if _, ok := m.groupCatalog.Group(group.ID); ok {
		t.Fatal("deleted group remains in catalog")
	}
	if !m.sessionHidden(second.ID) || m.sessionGroupID(second.ID) != "" {
		t.Fatalf("failed session hidden=%v group=%q", m.sessionHidden(second.ID), m.sessionGroupID(second.ID))
	}
	if _, ok := m.term.GetSession(first.ID); ok {
		t.Fatal("successfully closed group session remains")
	}
}
