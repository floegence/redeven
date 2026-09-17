package localui

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

func TestRuntimeChildrenCloseConcurrentlyWithCancellation(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "rdv-shutdown-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	control := &runtimeControlServer{token: "test"}
	if err := control.Start(ctx); err != nil {
		t.Fatal(err)
	}
	status, err := runtimemanagement.NewServer(filepath.Join(root, "status.sock"), func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{State: runtimemanagement.AttachStateReady}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := status.Start(ctx); err != nil {
		t.Fatal(err)
	}
	owner := &Server{runtimeControl: control, runtimeStatus: status}
	t.Cleanup(func() { _ = owner.Close() })
	var workers sync.WaitGroup
	start := make(chan struct{})
	for range 24 {
		workers.Go(func() {
			<-start
			_ = control.Endpoint()
			_ = owner.Close()
		})
	}
	workers.Go(func() { <-start; cancel() })
	close(start)
	workers.Wait()
	// Join the children's cancellation shutdown as well as the owner's calls.
	_ = control.Close()
	_ = status.Close()
	if control.Endpoint() != nil {
		t.Fatal("closed control endpoint is still advertised")
	}
	if _, err := os.Stat(filepath.Join(root, "status.sock")); !os.IsNotExist(err) {
		t.Fatalf("status socket remains after shutdown: %v", err)
	}
}
