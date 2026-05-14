package portforward

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/portforward/registry"
)

func TestService_MissingForwardReturnsSharedNotFound(t *testing.T) {
	t.Parallel()

	reg, err := registry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatalf("registry.Open: %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })

	svc, err := New(reg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	name := "missing"
	if _, err := svc.UpdateForward(ctx, "missing", UpdateForwardRequest{Name: &name}); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("UpdateForward error = %v, want ErrForwardNotFound", err)
	}
	if _, err := svc.TouchLastOpened(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("TouchLastOpened error = %v, want ErrForwardNotFound", err)
	}
	if err := svc.DeleteForward(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("DeleteForward error = %v, want ErrForwardNotFound", err)
	}
}
