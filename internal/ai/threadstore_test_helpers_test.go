package ai

import (
	"context"
	"errors"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

type floretMaintenanceHost interface {
	floretThreadReadHost
	ThreadDeleteHost
}

type floretMaintenanceTestFacade struct {
	floretThreadReadHost
	ThreadDeleteHost
}

func (s *Service) openFloretMaintenanceHost(ctx context.Context, threadID string) (floretMaintenanceHost, error) {
	read, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return nil, err
	}
	if s.threadDeleteFloret == nil {
		return nil, errors.New("Floret test delete authority is unavailable")
	}
	deleteHost := testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, threadID flruntime.ThreadID) error {
		return s.threadDeleteFloret.delete(ctx, string(threadID))
	})
	return floretMaintenanceTestFacade{floretThreadReadHost: read, ThreadDeleteHost: deleteHost}, nil
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
