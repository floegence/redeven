package automation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreReopenPreservesLocalDefinitionsAndRejectsFutureUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "automation.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	d := Definition{Title: "Saved", Goal: "Retain local work", Nodes: []Node{agent("one")}, MaxConcurrent: 1, TimeoutSeconds: 60}
	w, err := s.Create(t.Context(), testOwner, "one", d)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := s.Get(t.Context(), testOwner, w.ID)
	if err != nil || actual.ID != w.ID || actual.Definition.Title != "Saved" {
		t.Fatal(actual, err)
	}
	_ = s.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("PRAGMA user_version=999")
	if err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err == nil {
		_ = s.Close()
		t.Fatal("future store accepted")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("unsupported store mutated")
	}
}
func TestContributionAuthorityAndIdempotence(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("one")})
	r = step(t, e, r.ID)
	ctx := context.Background()
	a := r.Attempts[0]
	c := Contribution{ID: "fact", Kind: "finding", NodeID: a.NodeID, AttemptID: a.ID, Basis: r.ContextRevision, Text: "Observed fact"}
	r, err := s.Contribute(ctx, testOwner, r.ID, c)
	if err != nil {
		t.Fatal(err)
	}
	before := r.ContextRevision
	r, err = s.Contribute(ctx, testOwner, r.ID, c)
	if err != nil || r.ContextRevision != before {
		t.Fatal("duplicate contribution", err)
	}
	c.Kind = "result"
	if _, err = s.Contribute(ctx, testOwner, r.ID, c); !errors.Is(err, ErrInvalid) {
		t.Fatal("forged result accepted", err)
	}
	c.Kind = "finding"
	c.ID = "future"
	c.Basis = r.ContextRevision + 1
	if _, err = s.Contribute(ctx, testOwner, r.ID, c); !errors.Is(err, ErrInvalid) {
		t.Fatal("future basis accepted", err)
	}
	c.Basis = 1
	c.AttemptID = "foreign"
	if _, err = s.Contribute(ctx, testOwner, r.ID, c); !errors.Is(err, ErrConflict) {
		t.Fatal("foreign attempt accepted", err)
	}
	_, err = s.UpdateRun(ctx, testOwner, r.ID, func(r *Run) error { r.DeadlineAt = time.Now().Add(-time.Minute); return nil })
	if err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	if !r.CancelRequested {
		t.Fatal("deadline ignored")
	}
}

func TestPublicationKeepsRunningVersionGrant(t *testing.T) {
	s, _, r := fixture(t, []Node{agent("one")})
	ctx := t.Context()
	w, _ := s.Get(ctx, testOwner, r.WorkflowID)
	g, _ := s.Grant(ctx, testOwner, w.ID)
	if _, err := s.Publish(ctx, testOwner, w.ID, w.Revision, g); err != nil {
		t.Fatal(err)
	}
	old, err := s.GrantVersion(ctx, testOwner, w.ID, r.DefinitionVersion)
	if err != nil || !old.Enabled {
		t.Fatal("running grant replaced", err)
	}
	if err := s.Revoke(ctx, testOwner, w.ID); err != nil {
		t.Fatal(err)
	}
	for _, version := range []int64{1, 2} {
		g, err = s.GrantVersion(ctx, testOwner, w.ID, version)
		if err != nil || g.Enabled {
			t.Fatal("revocation missed publication", version, err)
		}
	}
}

func TestLocalV1MigrationPreservesVersionedGrants(t *testing.T) {
	path := filepath.Join(t.TempDir(), "automation.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	d := Definition{Title: "Local", Goal: "Keep data", Model: "test/model", WorkingDirectory: "/work", Nodes: []Node{agent("one")}, MaxConcurrent: 1, TimeoutSeconds: 60}
	w, err := s.Create(t.Context(), testOwner, "local", d)
	if err != nil {
		t.Fatal(err)
	}
	g := Grant{Model: d.Model, WorkingDirectory: d.WorkingDirectory, Enabled: true, Authority: GrantAuthority{Namespace: "n", App: "a", Read: true, Write: true, Execute: true}, ExpiresAt: time.Now().Add(time.Hour)}
	p, err := s.Publish(t.Context(), testOwner, w.ID, w.Revision, g)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`ALTER TABLE grants RENAME TO grants_new; CREATE TABLE grants(workflow_id TEXT PRIMARY KEY, body TEXT NOT NULL); INSERT INTO grants SELECT workflow_id,body FROM grants_new; DROP TABLE grants_new; PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	kept, err := s.GrantVersion(t.Context(), testOwner, w.ID, p.Version)
	if err != nil || !kept.Enabled || kept.Model != g.Model {
		t.Fatal(kept, err)
	}
	if _, err = s.Get(t.Context(), testOwner, w.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStoreExcludesCompetingController(t *testing.T) {
	path := filepath.Join(t.TempDir(), "automation.sqlite")
	first, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := Open(path); err == nil {
		second.Close()
		t.Fatal("second controller admitted")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := Open(path)
	if err != nil {
		t.Fatal("restart lock retained", err)
	}
	next.Close()
}

func TestLocalV2MigrationDistinguishesPublishedAndChangedDrafts(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "published", true: "changed"}[changed], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "workflows.sqlite")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			d := Definition{Title: "Retained", Goal: "Preserve publication identity", Model: "test/model", WorkingDirectory: "/work", Nodes: []Node{agent("one")}, MaxConcurrent: 1, TimeoutSeconds: 60}
			w, err := s.Create(t.Context(), testOwner, "retained", d)
			if err != nil {
				t.Fatal(err)
			}
			g := Grant{Model: d.Model, WorkingDirectory: d.WorkingDirectory, Enabled: true, Authority: GrantAuthority{Namespace: "n", App: "a", Read: true, Write: true, Execute: true}, ExpiresAt: time.Now().Add(time.Hour)}
			if _, err = s.Publish(t.Context(), testOwner, w.ID, w.Revision, g); err != nil {
				t.Fatal(err)
			}
			w, err = s.Get(t.Context(), testOwner, w.ID)
			if err != nil {
				t.Fatal(err)
			}
			if changed {
				d.Goal = "Unpublished change"
				w, err = s.Save(t.Context(), testOwner, w.ID, w.Revision, d)
				if err != nil {
					t.Fatal(err)
				}
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec("UPDATE workflows SET body=json_remove(body,'$.published_revision'); PRAGMA user_version=2")
			if err != nil {
				t.Fatal(err)
			}
			if err = db.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			retained, err := s.Get(t.Context(), testOwner, w.ID)
			if err != nil || retained.Revision != w.Revision || jsonText(retained.Definition) != jsonText(d) {
				t.Fatal(retained, err)
			}
			if (retained.PublishedRevision == retained.Revision) == changed {
				t.Fatal("publication identity lost", retained)
			}
			p, err := s.Publication(t.Context(), testOwner, w.ID, 1)
			if err != nil || p.Definition.Goal != "Preserve publication identity" {
				t.Fatal(p, err)
			}
		})
	}
}

func TestSharedContextPaginationDoesNotSkipUnseenEvidence(t *testing.T) {
	s, _, r := fixture(t, []Node{agent("one")})
	for i := range 5 {
		var err error
		r, err = s.Contribute(t.Context(), testOwner, r.ID, Contribution{ID: fmt.Sprintf("fact_%d", i), Kind: "finding", Text: "Observed material", Data: json.RawMessage(`{"body":"` + strings.Repeat("x", 60000) + `"}`), Basis: r.ContextRevision})
		if err != nil {
			t.Fatal(err)
		}
	}
	cursor := int64(0)
	ids := map[string]bool{}
	for {
		page, err := s.ReadContext(t.Context(), testOwner, r.ID, cursor, 100)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Contributions) == 0 || len(page.Contributions) > 2 || page.Revision != r.ContextRevision {
			t.Fatal("page bounds or snapshot", page.Revision, len(page.Contributions))
		}
		for _, c := range page.Contributions {
			if ids[c.ID] {
				t.Fatal("duplicate evidence", c.ID)
			}
			ids[c.ID] = true
		}
		if page.NextAfterRevision <= cursor {
			t.Fatal("cursor did not advance")
		}
		cursor = page.NextAfterRevision
		if !page.HasMore {
			break
		}
	}
	if len(ids) != 5 {
		t.Fatal("unseen evidence skipped", len(ids))
	}
}

func TestIncompleteDraftRemainsEditableButCannotPublish(t *testing.T) {
	path := filepath.Join(t.TempDir(), "automation.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	d := Definition{Title: "Draft", Goal: "Configure targets", Nodes: []Node{{ID: "targets", Title: "Targets", Kind: "parallel", Concurrency: 2}}, MaxConcurrent: 2, TimeoutSeconds: 60}
	w, err := s.Create(t.Context(), testOwner, "draft", d)
	if err != nil {
		t.Fatal("draft rejected", err)
	}
	if _, err = s.Publish(t.Context(), testOwner, w.ID, w.Revision, Grant{}); err == nil {
		t.Fatal("incomplete publication accepted")
	}
	d.Nodes[0].Instruction = "Inspect targets"
	if _, err = s.Save(t.Context(), testOwner, w.ID, w.Revision, d); err != nil {
		t.Fatal("incremental edit blocked", err)
	}
}

func TestDuplicateContributionRemainsQueryableAfterCompletion(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("one")})
	r = step(t, e, r.ID)
	a := r.Attempts[0]
	c := Contribution{ID: "fact", Kind: "finding", NodeID: a.NodeID, AttemptID: a.ID, Basis: r.ContextRevision, Text: "Observed"}
	if _, err := s.Contribute(t.Context(), testOwner, r.ID, c); err != nil {
		t.Fatal(err)
	}
	e.Executor.(*testExecutor).states[a.ID] = ExecutionStatus{Terminal: true, Outcome: "completed", Result: []byte(`{"ok":true}`)}
	r = step(t, e, r.ID)
	if r.Status != "completed" {
		t.Fatal(r.Status)
	}
	got, err := s.Contribute(t.Context(), testOwner, r.ID, c)
	if err != nil || got.ContextRevision != r.ContextRevision {
		t.Fatal("lost receipt after completion", err)
	}
	c.Text = "Changed"
	if _, err = s.Contribute(t.Context(), testOwner, r.ID, c); !errors.Is(err, ErrConflict) {
		t.Fatal("changed request accepted", err)
	}
}
