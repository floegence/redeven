package runtimemanagement

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNormalizeLocalUIBridgeURL(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "ipv4", raw: " http://127.0.0.1:43123 ", want: "http://127.0.0.1:43123/"},
		{name: "ipv6", raw: "http://[::1]:43123/", want: "http://[::1]:43123/"},
		{name: "missing", raw: "", wantErr: true},
		{name: "https", raw: "https://127.0.0.1:43123/", wantErr: true},
		{name: "localhost", raw: "http://localhost:43123/", wantErr: true},
		{name: "network", raw: "http://100.126.191.114:43123/", wantErr: true},
		{name: "missing port", raw: "http://127.0.0.1/", wantErr: true},
		{name: "non-root path", raw: "http://127.0.0.1:43123/env", wantErr: true},
		{name: "credentials", raw: "http://user:pass@127.0.0.1:43123/", wantErr: true},
		{name: "query", raw: "http://127.0.0.1:43123/?token=secret", wantErr: true},
		{name: "fragment", raw: "http://127.0.0.1:43123/#fragment", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeLocalUIBridgeURL(test.raw)
			if test.wantErr {
				if err == nil {
					t.Fatalf("NormalizeLocalUIBridgeURL(%q) = %q, want error", test.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeLocalUIBridgeURL(%q) error = %v", test.raw, err)
			}
			if got != test.want {
				t.Fatalf("NormalizeLocalUIBridgeURL(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}

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
