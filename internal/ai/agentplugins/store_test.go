package agentplugins

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func install(t *testing.T, m *Manager, root string) Install {
	t.Helper()
	op, e := m.Prepare(context.Background(), "owner", PrepareRequest{RequestID: filepath.Base(root) + "-request", Source: Source{Type: "local", Directory: root}})
	if e != nil || op.Status != "ready" {
		t.Fatal(op, e)
	}
	in, e := m.Commit("owner", CommitRequest{OperationID: op.ID, Digest: op.Digest, Enabled: true, Components: []string{"skill:review"}})
	if e != nil {
		t.Fatal(e)
	}
	return in
}
func TestInstallRecoveryAndRevocation(t *testing.T) {
	state := t.TempDir()
	m, e := Open(state)
	if e != nil {
		t.Fatal(e)
	}
	root := fixture(t)
	in := install(t, m, root)
	_, release, e := m.Acquire(in.ID, in.Revision, "skill:review")
	if e != nil {
		t.Fatal(e)
	}
	if e = m.Remove(in.ID, in.Revision, false); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	disabled := false
	next, e := m.Change(Change{ID: in.ID, Revision: in.Revision, Enabled: &disabled})
	if e != nil {
		t.Fatal(e)
	}
	if m.Current(in.ID, in.Revision, "skill:review") {
		t.Fatal("stale authority survived")
	}
	release()
	if _, _, e = m.Acquire(next.ID, next.Revision, "skill:review"); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	m, e = Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	items, _ := m.List()
	if len(items) != 1 || items[0].Enabled {
		t.Fatal(items)
	}
}
func TestRemoveRejectsUnregisteredPathsWithoutChangingState(t *testing.T) {
	m, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	in := install(t, m, fixture(t))
	put(t, m.Data(in.ID), "keep", "retained plugin data")
	outside := t.TempDir()
	put(t, outside, "keep", "outside data")
	_, revision := m.List()
	for _, id := range []string{"../..", outside, in.ID + "/../../..", "00000000-0000-0000-0000-000000000000"} {
		if err := m.Remove(id, in.Revision, true); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("unregistered path was not rejected: %q: %v", id, err)
		}
	}
	items, after := m.List()
	if len(items) != 1 || items[0].ID != in.ID || after != revision {
		t.Fatal("rejected removal changed the installation registry")
	}
	for path, expected := range map[string]string{filepath.Join(m.Data(in.ID), "keep"): "retained plugin data", filepath.Join(outside, "keep"): "outside data"} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != expected {
			t.Fatalf("rejected removal changed data: %s: %v", path, err)
		}
	}
}

func TestRemoveCannotFollowReplacedDataDirectory(t *testing.T) {
	m, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	in := install(t, m, fixture(t))
	outside := t.TempDir()
	put(t, outside, filepath.Join(in.ID, "keep"), "outside data")
	data := filepath.Join(m.root, "data")
	if err = os.RemoveAll(data); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, data); err != nil {
		t.Fatal(err)
	}
	if err = m.Remove(in.ID, in.Revision, true); err == nil {
		t.Fatal("escaped data removal accepted")
	}
	if items, _ := m.List(); len(items) != 1 || items[0].ID != in.ID {
		t.Fatal("rejected removal changed installation state")
	}
	got, err := os.ReadFile(filepath.Join(outside, in.ID, "keep"))
	if err != nil || string(got) != "outside data" {
		t.Fatalf("outside data changed: %v", err)
	}
}
func TestPrepareBindsBytesAndUpdatePreservesData(t *testing.T) {
	m, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	root := fixture(t)
	in := install(t, m, root)
	put(t, m.Data(in.ID), "keep", "user data")
	put(t, root, "skills/review/SKILL.md", "---\nname: review\ndescription: New description\n---\nNew instructions")
	op, e := m.Prepare(context.Background(), "owner", PrepareRequest{RequestID: "update-request", Source: in.Source, InstallID: in.ID, Revision: in.Revision})
	if e != nil {
		t.Fatal(e)
	}
	_, release, e := m.Acquire(in.ID, in.Revision, "skill:review")
	if e != nil {
		t.Fatal(e)
	}
	req := CommitRequest{OperationID: op.ID, Digest: op.Digest, Enabled: true, Components: []string{"skill:review"}}
	if _, e = m.Commit("owner", req); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	release()
	updated, e := m.Commit("owner", req)
	if e != nil || updated.Revision != in.Revision+1 {
		t.Fatal(updated, e)
	}
	again, e := m.Commit("owner", req)
	if e != nil || again.Revision != updated.Revision {
		t.Fatal(again, e)
	}
	b, e := os.ReadFile(filepath.Join(m.Data(in.ID), "keep"))
	if e != nil || string(b) != "user data" {
		t.Fatal(e)
	}
	if _, e = m.Change(Change{ID: in.ID, Revision: in.Revision, Enabled: &in.Enabled}); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	if e = m.Remove(updated.ID, updated.Revision, false); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(m.Data(in.ID), "keep")); e != nil {
		t.Fatal(e)
	}
}
func TestPreparationNeverExecutesAndRejectsChangedSnapshot(t *testing.T) {
	m, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	root := fixture(t)
	put(t, root, "mcp.json", `{"$schema":"`+MCPSchema+`","mcpServers":{"local":{"type":"stdio","command":"not-a-real-command"}}}`)
	req := PrepareRequest{RequestID: "prepare-request", Source: Source{Type: "local", Directory: root}}
	op, e := m.Prepare(context.Background(), "owner", req)
	if e != nil || op.Status != "ready" {
		t.Fatal(op, e)
	}
	same, e := m.Prepare(context.Background(), "owner", req)
	if e != nil || same.ID != op.ID {
		t.Fatal(e)
	}
	if _, e = m.Operation(op.ID, "stranger"); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
	put(t, filepath.Join(m.root, "staging", op.ID), "changed", "payload")
	if _, e = m.Commit("owner", CommitRequest{OperationID: op.ID, Digest: op.Digest}); e == nil {
		t.Fatal("changed snapshot installed")
	}
}
func TestDigestDetectsModeAndContent(t *testing.T) {
	r := fixture(t)
	a, e := Digest(r)
	if e != nil {
		t.Fatal(e)
	}
	p := filepath.Join(r, "plugin.json")
	if e = os.Chmod(p, 0700); e != nil {
		t.Fatal(e)
	}
	b, e := Digest(r)
	if e != nil || a == b {
		t.Fatal(a, b, e)
	}
}
func TestCatalogCannotInstallLocalPaths(t *testing.T) {
	if _, e := DecodeCatalog([]byte(`{"schema_version":"flower.agent_plugin_catalog.v1","id":"example","plugins":[{"id":"x","source":{"type":"local","directory":"/tmp"}}]}`)); e == nil {
		t.Fatal("remote catalog accepted local path")
	}
}

func TestAsyncPreparationRecoveryAndIsolation(t *testing.T) {
	state := t.TempDir()
	m, e := Open(state)
	if e != nil {
		t.Fatal(e)
	}
	req := PrepareRequest{RequestID: "async-request", Source: Source{Type: "local", Directory: fixture(t)}}
	op, e := m.Begin("owner", req)
	if e != nil || op.Status != "preparing" {
		t.Fatal(op, e)
	}
	for i := 0; i < 500; i++ {
		op, e = m.Operation(op.ID, "owner")
		if e != nil {
			t.Fatal(e)
		}
		if op.Status != "preparing" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if op.Status != "ready" {
		t.Fatal(op)
	}
	if len(m.Operations("owner")) != 1 || len(m.Operations("other")) != 0 {
		t.Fatal("operation ownership lost")
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	m, e = Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	recovered := m.Operations("owner")
	if len(recovered) != 1 || recovered[0].Digest != op.Digest {
		t.Fatal(recovered)
	}
	if _, e = m.Commit("owner", CommitRequest{OperationID: op.ID, Digest: op.Digest}); e != nil {
		t.Fatal(e)
	}
}
func TestRegistryRejectsFutureVersionAndUnsafeIdentityUnchanged(t *testing.T) {
	state := t.TempDir()
	m, e := Open(state)
	if e != nil {
		t.Fatal(e)
	}
	root := fixture(t)
	in := install(t, m, root)
	path := filepath.Join(m.root, "registry.sqlite")
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	db, e := sql.Open("sqlite", path)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("PRAGMA user_version=2"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	before, _ := os.ReadFile(path)
	if reopened, e := Open(state); e == nil {
		reopened.Close()
		t.Fatal("future schema accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected database changed")
	}
	next := State{Revision: 1, Installs: []Install{in}, Operations: []storedOperation{}, Sources: []CatalogSource{}}
	next.Installs[0].Digest = strings.Repeat("../", 21) + "x"
	if validateState(next, 1) == nil {
		t.Fatal("unsafe digest accepted")
	}
}

func TestRegistryRejectsMalformedStoredConfiguration(t *testing.T) {
	m, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	in := install(t, m, fixture(t))
	base := State{Revision: 1, Installs: []Install{in}, Operations: []storedOperation{}, Sources: []CatalogSource{}}
	for _, mutate := range []func(*State){
		func(s *State) { s.Installs[0].Source = Source{Type: "unexpected"} },
		func(s *State) { s.Installs[0].Package.MCP["bad"] = MCP{Type: "stdio", Command: "/external/program"} },
		func(s *State) {
			s.Installs[0].Package.Skills = append(s.Installs[0].Package.Skills, s.Installs[0].Package.Skills[0])
		},
		func(s *State) { delete(s.Installs[0].Components, "skill:review") },
	} {
		next := cloneState(base)
		mutate(&next)
		if validateState(next, 1) == nil {
			t.Fatal("malformed registry accepted")
		}
	}
}
