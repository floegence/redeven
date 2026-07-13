package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func ensureThreadstoreThreadForTest(t *testing.T, store *threadstore.Store, endpointID string, threadID string) {
	t.Helper()
	thread, err := store.GetThread(context.Background(), endpointID, threadID)
	if err != nil {
		t.Fatalf("GetThread(%s): %v", threadID, err)
	}
	if thread != nil {
		return
	}
	if err := store.CreateThread(context.Background(), threadstore.Thread{ThreadID: threadID, EndpointID: endpointID, Title: threadID}); err != nil {
		t.Fatalf("CreateThread(%s): %v", threadID, err)
	}
}
