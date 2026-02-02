package codeapp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/codeapp/codeserver"
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/codeapp/registry"
)

func TestService_CreateUpdateDeleteSpace_MetadataOnly(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	regPath := filepath.Join(stateDir, "apps", "code", "registry.sqlite")
	reg, err := registry.Open(regPath)
	if err != nil {
		t.Fatalf("registry.Open: %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })

	runner := codeserver.NewRunner(codeserver.RunnerOptions{
		StateDir: stateDir,
		PortMin:  20000,
		PortMax:  20010,
	})
	svc := &Service{
		stateDir: stateDir,
		reg:      reg,
		runner:   runner,
	}

	ws := t.TempDir()
	ctx := context.Background()

	created, err := svc.CreateSpace(ctx, gateway.CreateSpaceRequest{
		CodeSpaceID:   "dev1",
		WorkspacePath: ws,
		Name:          "  My Space  ",
		Description:   "  Desc  ",
	})
	if err != nil {
		t.Fatalf("CreateSpace: %v", err)
	}
	if created == nil {
		t.Fatalf("CreateSpace returned nil")
	}
	if created.CodeSpaceID != "dev1" {
		t.Fatalf("code_space_id = %q, want %q", created.CodeSpaceID, "dev1")
	}
	if created.CodePort != 0 || created.Running || created.PID != 0 {
		t.Fatalf("CreateSpace should not start runner: %+v", created)
	}
	if created.Name != "My Space" || created.Description != "Desc" {
		t.Fatalf("meta not trimmed: name=%q desc=%q", created.Name, created.Description)
	}
	if created.CreatedAtUnixMs <= 0 || created.UpdatedAtUnixMs <= 0 {
		t.Fatalf("timestamps should be set: %+v", created)
	}
	if created.LastOpenedAtUnixMs != 0 {
		t.Fatalf("last_opened_at_unix_ms = %d, want 0", created.LastOpenedAtUnixMs)
	}

	// Ensure the state dir is created under <state_dir>/apps/code/spaces/<id>/.
	spaceRoot := filepath.Join(stateDir, "apps", "code", "spaces", "dev1")
	if _, err := os.Stat(spaceRoot); err != nil {
		t.Fatalf("space root not created: %v", err)
	}

	sp, err := reg.GetSpace(ctx, "dev1")
	if err != nil {
		t.Fatalf("GetSpace: %v", err)
	}
	if sp == nil || sp.WorkspacePath == "" {
		t.Fatalf("GetSpace returned nil/empty: %+v", sp)
	}
	if filepath.Clean(sp.WorkspacePath) != filepath.Clean(ws) {
		t.Fatalf("workspace_path = %q, want %q", sp.WorkspacePath, ws)
	}

	prevUpdated := sp.UpdatedAtUnixMs
	time.Sleep(2 * time.Millisecond)

	newName := "New Name"
	newDesc := "New Desc"
	updated, err := svc.UpdateSpace(ctx, "dev1", gateway.UpdateSpaceRequest{
		Name:        &newName,
		Description: &newDesc,
	})
	if err != nil {
		t.Fatalf("UpdateSpace: %v", err)
	}
	if updated == nil || updated.Name != newName || updated.Description != newDesc {
		t.Fatalf("UpdateSpace meta mismatch: %+v", updated)
	}

	sp2, err := reg.GetSpace(ctx, "dev1")
	if err != nil {
		t.Fatalf("GetSpace(after update): %v", err)
	}
	if sp2 == nil {
		t.Fatalf("GetSpace(after update) returned nil")
	}
	if sp2.UpdatedAtUnixMs <= prevUpdated {
		t.Fatalf("updated_at_unix_ms did not increase: before=%d after=%d", prevUpdated, sp2.UpdatedAtUnixMs)
	}

	// Validation: name length (rune count) must be <= 64.
	tooLong := strings.Repeat("a", 65)
	if _, err := svc.UpdateSpace(ctx, "dev1", gateway.UpdateSpaceRequest{Name: &tooLong}); err == nil {
		t.Fatalf("UpdateSpace should reject long name")
	}

	// Delete should remove registry entry and space dir, but never touch workspace_path.
	dummy := filepath.Join(spaceRoot, "dummy.txt")
	if err := os.WriteFile(dummy, []byte("x"), 0o600); err != nil {
		t.Fatalf("write dummy: %v", err)
	}
	if err := svc.DeleteSpace(ctx, "dev1"); err != nil {
		t.Fatalf("DeleteSpace: %v", err)
	}
	if sp3, err := reg.GetSpace(ctx, "dev1"); err != nil || sp3 != nil {
		t.Fatalf("GetSpace(after delete) = %+v err=%v, want nil", sp3, err)
	}
	if _, err := os.Stat(spaceRoot); err == nil {
		t.Fatalf("space root should be deleted: %s", spaceRoot)
	}
	if _, err := os.Stat(ws); err != nil {
		t.Fatalf("workspace_path should remain: %v", err)
	}
}

func TestService_CreateSpace_GeneratesValidIDWhenMissing(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	regPath := filepath.Join(stateDir, "apps", "code", "registry.sqlite")
	reg, err := registry.Open(regPath)
	if err != nil {
		t.Fatalf("registry.Open: %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })

	svc := &Service{
		stateDir: stateDir,
		reg:      reg,
		runner: codeserver.NewRunner(codeserver.RunnerOptions{
			StateDir: stateDir,
			PortMin:  20000,
			PortMax:  20010,
		}),
	}
	ws := t.TempDir()

	created, err := svc.CreateSpace(context.Background(), gateway.CreateSpaceRequest{
		WorkspacePath: ws,
	})
	if err != nil {
		t.Fatalf("CreateSpace: %v", err)
	}
	if created == nil || strings.TrimSpace(created.CodeSpaceID) == "" {
		t.Fatalf("CreateSpace returned empty id: %+v", created)
	}
	if !IsValidCodeSpaceID(created.CodeSpaceID) {
		t.Fatalf("generated code_space_id is invalid: %q", created.CodeSpaceID)
	}
}
