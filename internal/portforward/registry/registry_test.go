package registry

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"testing"
)

func TestOpen_CreatesV1SchemaForFreshDB(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	var v int
	if err := r.db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if v != 1 {
		t.Fatalf("user_version = %d, want 1", v)
	}

	cols, err := tableColumns(r.db, "port_forwards")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	want := []string{
		"forward_id",
		"target_url",
		"name",
		"description",
		"health_path",
		"insecure_skip_verify",
		"created_at_unix_ms",
		"updated_at_unix_ms",
		"last_opened_at_unix_ms",
	}
	for _, c := range want {
		if !slices.Contains(cols, c) {
			t.Fatalf("missing column %q in %+v", c, cols)
		}
	}
}

func TestRegistry_CRUD(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	ctx := context.Background()

	if err := r.CreateForward(ctx, Forward{
		ForwardID:          "f1",
		TargetURL:          "http://127.0.0.1:3000",
		Name:               "Demo",
		Description:        "demo forward",
		HealthPath:         "",
		InsecureSkipVerify: false,
	}); err != nil {
		t.Fatalf("CreateForward: %v", err)
	}

	f, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward: %v", err)
	}
	if f == nil {
		t.Fatalf("GetForward returned nil")
	}
	if f.ForwardID != "f1" || f.TargetURL != "http://127.0.0.1:3000" {
		t.Fatalf("unexpected forward: %+v", *f)
	}
	if f.CreatedAtUnixMs <= 0 || f.UpdatedAtUnixMs <= 0 {
		t.Fatalf("expected timestamps to be set: %+v", *f)
	}

	// Update meta.
	newName := "Demo 2"
	if err := r.UpdateForward(ctx, "f1", UpdateForwardPatch{
		Name:            &newName,
		UpdatedAtUnixMs: 0,
	}); err != nil {
		t.Fatalf("UpdateForward: %v", err)
	}

	updated, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(updated): %v", err)
	}
	if updated == nil || updated.Name != newName {
		t.Fatalf("unexpected updated forward: %+v", updated)
	}

	// Touch last opened.
	if err := r.TouchLastOpened(ctx, "f1"); err != nil {
		t.Fatalf("TouchLastOpened: %v", err)
	}
	touched, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(touched): %v", err)
	}
	if touched == nil || touched.LastOpenedAtUnixMs <= 0 {
		t.Fatalf("expected last_opened_at_unix_ms to be set: %+v", touched)
	}

	// List.
	list, err := r.ListForwards(ctx)
	if err != nil {
		t.Fatalf("ListForwards: %v", err)
	}
	if len(list) != 1 || list[0].ForwardID != "f1" {
		t.Fatalf("unexpected list: %+v", list)
	}

	// Delete.
	if err := r.DeleteForward(ctx, "f1"); err != nil {
		t.Fatalf("DeleteForward: %v", err)
	}
	after, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(after delete): %v", err)
	}
	if after != nil {
		t.Fatalf("expected deleted forward to be nil, got %+v", after)
	}
}

func TestRegistry_MissingMutationsReturnNotFound(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	ctx := context.Background()
	name := "Missing"
	if err := r.UpdateForward(ctx, "missing", UpdateForwardPatch{Name: &name}); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("UpdateForward error = %v, want ErrForwardNotFound", err)
	}
	if err := r.TouchLastOpened(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("TouchLastOpened error = %v, want ErrForwardNotFound", err)
	}
	if err := r.DeleteForward(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("DeleteForward error = %v, want ErrForwardNotFound", err)
	}
}

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `);`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var (
			cid        int
			name       string
			typ        string
			notnull    int
			dfltValue  any
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &primaryKey); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}
