package runtimemanagement

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestServerStartWithCanceledContextDoesNotPanic(t *testing.T) {
	for i := 0; i < 50; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		dir, err := os.MkdirTemp("/tmp", "redeven-rmgmt-")
		if err != nil {
			t.Fatalf("MkdirTemp() error = %v", err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(dir) })

		srv, err := NewServer(filepath.Join(dir, fmt.Sprintf("runtime-%d.sock", i)), func(context.Context) (RuntimeAttachStatus, error) {
			return RuntimeAttachStatus{State: AttachStateReady}, nil
		})
		if err != nil {
			t.Fatalf("NewServer() error = %v", err)
		}
		if err := srv.Start(ctx); err != nil {
			t.Fatalf("Start() error = %v", err)
		}
		time.Sleep(2 * time.Millisecond)
		if err := srv.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	}
}
