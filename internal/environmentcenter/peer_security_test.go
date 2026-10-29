//go:build darwin || linux

package environmentcenter

import (
	"math"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestConnectorPeerRejectsWrappedUID(t *testing.T) {
	directory, err := os.MkdirTemp("/tmp", "center-peer-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(directory, "peer.sock"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if !connectorPeer(server, os.Geteuid()) {
		t.Fatal("current peer rejected")
	}
	wrapped := uint64(os.Geteuid()) + uint64(math.MaxUint32) + 1
	for _, uid := range []int{-1, int(wrapped)} {
		if connectorPeer(server, uid) {
			t.Fatalf("invalid UID accepted: %d", uid)
		}
	}
}
