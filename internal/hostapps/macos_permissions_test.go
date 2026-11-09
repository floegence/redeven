package hostapps

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
)

// Model the observed macOS behavior: the old process retains its denied result
// after the grant changes; only a new process observes the current grant.
func TestMacPermissionCheckRenewsIdleOwner(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native macOS adapter")
	}
	grant := filepath.Join(t.TempDir(), "granted")
	t.Setenv("REDEVEN_TEST_SCREEN_GRANT", grant)
	m := macFixtureScript(t, `#!/bin/sh
screen=false
test ! -f "$REDEVEN_TEST_SCREEN_GRANT" || screen=true
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"backend":"macos","supported":true,"native_ready":true,"permissions":{"screen_recording":'"$screen"',"accessibility":false}}}' ;;
 esac
done
`)
	before, err := m.macCatalog(context.Background(), "alice")
	if err != nil || before.Availability.Permissions["screen_recording"] {
		t.Fatal(before, err)
	}
	old := m.nativeHost
	if err := os.WriteFile(grant, []byte("granted"), 0600); err != nil {
		t.Fatal(err)
	}
	stale, err := m.macCatalog(context.Background(), "alice")
	if err != nil || stale.Availability.Permissions["screen_recording"] {
		t.Fatal(stale, err)
	}
	if err := m.Permissions(context.Background(), "check_permissions"); err != nil {
		t.Fatal(err)
	}
	after, err := m.macCatalog(context.Background(), "alice")
	if err != nil || !after.Availability.Permissions["screen_recording"] || after.Availability.Permissions["accessibility"] {
		t.Fatal(after, err)
	}
	if old == m.nativeHost {
		t.Fatal("idle permission owner was reused")
	}
	select {
	case <-old.done:
	default:
		t.Fatal("predecessor still running")
	}
	if m.closed || m.accessDisabled {
		t.Fatal("check changed runtime or feature intent")
	}
	if err := os.Remove(grant); err != nil {
		t.Fatal(err)
	}
	if err := m.Permissions(context.Background(), "check_permissions"); err != nil {
		t.Fatal(err)
	}
	revoked, err := m.macCatalog(context.Background(), "alice")
	if err != nil || revoked.Availability.Permissions["screen_recording"] {
		t.Fatal("revocation retained an old grant", revoked.Availability, err)
	}
}

func TestMacPermissionCheckPreservesActiveChannels(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native macOS adapter")
	}
	m := macFixture(t)
	client, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := m.Permissions(context.Background(), "check_permissions"); err != nil {
		t.Fatal(err)
	}
	if client.host != m.nativeHost {
		t.Fatal("check replaced active sharing owner")
	}
	select {
	case <-client.done:
		t.Fatal("check disconnected active channel")
	default:
	}
	old := client.host
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := m.macCatalog(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
	if m.nativeHost == old {
		t.Fatal("concurrent read lost the requested idle renewal")
	}
}

func TestCancelledPermissionCheckPreservesOwner(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native macOS adapter")
	}
	m := macFixture(t)
	if _, err := m.macCatalog(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
	old := m.nativeHost
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := m.Permissions(ctx, "check_permissions"); err != context.Canceled {
		t.Fatal(err)
	}
	if old != m.nativeHost {
		t.Fatal("cancelled check replaced owner")
	}
}

// Explicit acceptance against a signed, staged helper. This never requests or
// resets permissions, opens a user application, injects input or saves pixels.
func TestMacPermissionNativeRenewalAndCapture(t *testing.T) {
	helper := os.Getenv("REDEVEN_TEST_PERMISSION_HELPER")
	if runtime.GOOS != "darwin" || helper == "" {
		t.Skip("requires an explicit signed helper and existing screen grant")
	}
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", helper)
	root := t.TempDir()
	reg, err := registry.Open(filepath.Join(root, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	m := New(root, root, forwards)
	t.Cleanup(func() { _ = m.Close(); _ = forwards.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	before, err := m.macCatalog(ctx, "acceptance")
	if err != nil || !before.Availability.Permissions["screen_recording"] {
		t.Fatalf("existing screen grant required: %+v, %v", before.Availability, err)
	}
	old := m.nativeHost
	if err := m.Permissions(ctx, "check_permissions"); err != nil {
		t.Fatal(err)
	}
	after, err := m.macCatalog(ctx, "acceptance")
	if err != nil || !reflect.DeepEqual(before.Availability.Permissions, after.Availability.Permissions) || m.nativeHost == old {
		t.Fatal(after.Availability, err)
	}
	select {
	case <-old.done:
	default:
		t.Fatal("old native process survived renewal")
	}
	transport, err := m.OpenDesktop(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transport.Close()
	if err := transport.Send(nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "connect", Mode: "view", Picture: &nativeapps.HostDesktopPicture{Mode: "auto", MaxDimension: 1600, FrameRate: 15}}, false); err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case frame := <-transport.Media():
			if frame.Width <= 0 || frame.Height <= 0 || len(frame.Data) == 0 {
				continue
			}
			owner := m.nativeHost
			if err := m.Permissions(ctx, "check_permissions"); err != nil {
				t.Fatal(err)
			}
			if m.nativeHost != owner {
				t.Fatal("permission check interrupted actual capture")
			}
			select {
			case <-transport.Done():
				t.Fatal("capture channel ended")
			default:
			}
			t.Logf("signed helper renewed: relay %d -> %d; screen=%t accessibility=%t; actual frame=%dx%d codec=%s bytes=%d; active capture preserved", old.cmd.Process.Pid, owner.cmd.Process.Pid, after.Availability.Permissions["screen_recording"], after.Availability.Permissions["accessibility"], frame.Width, frame.Height, frame.Codec, len(frame.Data))
			return
		case message := <-transport.Control():
			if message.Type == "error" {
				t.Fatalf("native capture: %+v", message)
			}
		case <-transport.Done():
			t.Fatal("native capture ended before a frame")
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}
