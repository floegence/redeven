package codeapp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/session"
)

func TestNewMigratesAutomationBeforeReadiness(t *testing.T) {
	for _, version := range []int{1, 2} {
		for _, changed := range []bool{false, true} {
			t.Run(fmt.Sprintf("v%d/changed=%t", version, changed), func(t *testing.T) {
				root := t.TempDir()
				path := filepath.Join(root, "apps", "automation", "workflows.sqlite")
				owner := automation.Owner{User: "migration-user", Environment: "migration-env"}
				store, err := automation.Open(path)
				if err != nil {
					t.Fatal(err)
				}
				definition := automation.Definition{Title: "Retained workflow", Goal: "Retain original publication", Model: "test/model", WorkingDirectory: root, MaxConcurrent: 1, TimeoutSeconds: 60, Nodes: []automation.Node{{ID: "analyze", Title: "Analyze", Kind: "agent", Instruction: "Read the shared context"}}}
				workflow, err := store.Create(t.Context(), owner, "migration", definition)
				if err != nil {
					t.Fatal(err)
				}
				grant := automation.Grant{Model: definition.Model, WorkingDirectory: root, Enabled: true, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: "namespace", App: "app", Read: true, Write: true, Execute: true}}
				publication, err := store.Publish(t.Context(), owner, workflow.ID, workflow.Revision, grant)
				if err != nil {
					t.Fatal(err)
				}
				grant, err = store.GrantVersion(t.Context(), owner, workflow.ID, publication.Version)
				if err != nil {
					t.Fatal(err)
				}
				workflow, err = store.Get(t.Context(), owner, workflow.ID)
				if err != nil {
					t.Fatal(err)
				}
				if changed {
					definition.Goal = "Keep an unpublished local edit"
					workflow, err = store.Save(t.Context(), owner, workflow.ID, workflow.Revision, definition)
					if err != nil {
						t.Fatal(err)
					}
				}
				if err = store.Close(); err != nil {
					t.Fatal(err)
				}
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				if version == 1 {
					_, err = db.Exec(`ALTER TABLE grants RENAME TO grants_new; CREATE TABLE grants(workflow_id TEXT PRIMARY KEY, body TEXT NOT NULL); INSERT INTO grants SELECT workflow_id,body FROM grants_new; DROP TABLE grants_new;`)
					if err != nil {
						t.Fatal(err)
					}
				}
				if _, err = db.Exec(fmt.Sprintf("UPDATE workflows SET body=json_remove(body,'$.published_revision'); PRAGMA user_version=%d", version)); err != nil {
					t.Fatal(err)
				}
				if err = db.Close(); err != nil {
					t.Fatal(err)
				}

				options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: root, StateRoot: root, ConfigPath: testCodeappConfigPath(t, root), PermissionPolicy: testCodeappPermissionPolicy(t), ReDevPluginRuntimePath: testReDevPluginRuntimePath(t, root), AgentHomeDir: root, Shell: "/bin/sh", ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false }}
				// A real service startup must migrate before the public readiness boundary;
				// reopening verifies idempotence without manually invoking migration helpers.
				for startup := range 2 {
					svc, err := New(t.Context(), options)
					if err != nil {
						t.Fatal(err)
					}
					func() {
						defer svc.Close()
						db, err := sql.Open("sqlite", path)
						if err != nil {
							t.Fatal(err)
						}
						defer db.Close()
						var actualVersion int
						if err := db.QueryRow("PRAGMA user_version").Scan(&actualVersion); err != nil || actualVersion != 3 {
							t.Fatalf("startup %d: version=%d error=%v", startup, actualVersion, err)
						}
						retained, err := svc.automationStore.Get(t.Context(), owner, workflow.ID)
						if err != nil || retained.Revision != workflow.Revision || !reflect.DeepEqual(retained.Definition, definition) {
							t.Fatalf("local draft changed: %+v %v", retained, err)
						}
						if (retained.PublishedRevision == retained.Revision) == changed {
							t.Fatalf("publication/draft identity lost: %+v", retained)
						}
						keptPublication, err := svc.automationStore.Publication(t.Context(), owner, workflow.ID, publication.Version)
						if err != nil || !reflect.DeepEqual(keptPublication, publication) {
							t.Fatalf("publication changed: %+v %v", keptPublication, err)
						}
						keptGrant, err := svc.automationStore.GrantVersion(t.Context(), owner, workflow.ID, publication.Version)
						if err != nil || !reflect.DeepEqual(keptGrant, grant) {
							t.Fatalf("grant changed: %+v %v", keptGrant, err)
						}
						waitForAIReadinessState(t, svc.aiReady, appserver.AIReadinessReady)
					}()
				}
			})
		}
	}
}

func TestNewRejectsUnsupportedAutomationWithoutChangingData(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "apps", "automation", "workflows.sqlite")
	store, err := automation.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	owner := automation.Owner{User: "user", Environment: "env"}
	definition := automation.Definition{Title: "Retained draft", Goal: "Preserve user data", Nodes: []automation.Node{{ID: "read", Title: "Read", Kind: "tool", Tool: "http_get", Parameters: json.RawMessage(`{"url":"https://example.test"}`)}}, MaxConcurrent: 1, TimeoutSeconds: 60}
	if _, err = store.Create(t.Context(), owner, "retained", definition); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("PRAGMA user_version=999"); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := New(t.Context(), Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: root, StateRoot: root, ConfigPath: testCodeappConfigPath(t, root), PermissionPolicy: testCodeappPermissionPolicy(t), ReDevPluginRuntimePath: testReDevPluginRuntimePath(t, root), AgentHomeDir: root, Shell: "/bin/sh", ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false }})
	if err == nil {
		svc.Close()
		t.Fatal("unsupported automation state reached service readiness")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatalf("unsupported user data changed: %v", err)
	}
}
