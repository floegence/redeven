package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

type floretMaintenanceHost interface {
	floretThreadReadHost
	Delete(context.Context) error
}

type floretMaintenanceTestFacade struct {
	floretThreadReadHost
	delete func(context.Context) error
}

func (host floretMaintenanceTestFacade) Delete(ctx context.Context) error {
	return host.delete(ctx)
}

func (s *Service) openFloretMaintenanceHost(ctx context.Context, threadID string) (floretMaintenanceHost, error) {
	read, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return nil, err
	}
	if s.threadDeleteFloret == nil {
		return nil, errors.New("Floret test delete authority is unavailable")
	}
	return floretMaintenanceTestFacade{
		floretThreadReadHost: read,
		delete:               func(ctx context.Context) error { return s.threadDeleteFloret.delete(ctx, threadID) },
	}, nil
}

func ensureThreadstoreThreadForTest(t *testing.T, store *threadstore.Store, endpointID string, threadID string) {
	t.Helper()
	thread, err := store.GetThreadSettings(context.Background(), endpointID, threadID)
	if err != nil {
		t.Fatalf("GetThread(%s): %v", threadID, err)
	}
	if thread != nil {
		return
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: threadID, EndpointID: endpointID, PermissionType: config.AIPermissionFullAccess, WorkingDir: t.TempDir(),
	}); err != nil {
		t.Fatalf("CreateThread(%s): %v", threadID, err)
	}
}
