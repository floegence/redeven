package localui

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLocalUIDeviceCALifecycle(t *testing.T) {
	stateDir := t.TempDir()
	generated, err := GenerateLocalUIDeviceCA(stateDir)
	if err != nil {
		t.Fatalf("GenerateLocalUIDeviceCA() error = %v", err)
	}
	if generated.Identity != "ready" || generated.Trust != "unknown" {
		t.Fatalf("generated status = %#v", generated)
	}
	if _, err := GenerateLocalUIDeviceCA(stateDir); !errors.Is(err, ErrLocalUIDeviceCAInvalid) {
		t.Fatalf("duplicate GenerateLocalUIDeviceCA() error = %v", err)
	}

	ca, err := loadLocalUIDeviceCA(stateDir)
	if err != nil {
		t.Fatalf("loadLocalUIDeviceCA() error = %v", err)
	}
	serverCertificate, _, err := newLocalUIServerCertificate(ca, []string{"localhost", "127.0.0.1", "::1"})
	if err != nil || serverCertificate.Leaf == nil {
		t.Fatalf("newLocalUIServerCertificate() error = %v", err)
	}
	if err := serverCertificate.Leaf.VerifyHostname("localhost"); err != nil {
		t.Fatalf("leaf does not cover localhost: %v", err)
	}
	if err := serverCertificate.Leaf.VerifyHostname("127.0.0.1"); err != nil {
		t.Fatalf("leaf does not cover IPv4 loopback: %v", err)
	}
	if err := serverCertificate.Leaf.VerifyHostname("::1"); err != nil {
		t.Fatalf("leaf does not cover IPv6 loopback: %v", err)
	}

	exportPath := filepath.Join(t.TempDir(), "redeven-local-ui-ca.pem")
	if err := ExportLocalUIDeviceCA(stateDir, exportPath); err != nil {
		t.Fatalf("ExportLocalUIDeviceCA() error = %v", err)
	}
	exported, err := os.ReadFile(exportPath)
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	block, rest := pem.Decode(exported)
	if block == nil || block.Type != "CERTIFICATE" || len(rest) != 0 {
		t.Fatal("export is not one public certificate")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !certificate.Equal(ca.certificate) {
		t.Fatalf("exported certificate mismatch: %v", err)
	}
	if string(exported) == string(mustReadTestFile(t, filepath.Join(localUIDeviceCADir(stateDir), localUIDeviceCAKeyName))) {
		t.Fatal("public export contains the private key")
	}
}

func TestPrepareSecureNetworkRequiresServingIdentityWithoutClaimingClientTrust(t *testing.T) {
	stateDir := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
		t.Fatalf("GenerateLocalUIDeviceCA() error = %v", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	defer listener.Close()
	bind, err := ParseBind(listener.Addr().String())
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	s := newTestServer(t, nil)
	s.bind = bind
	s.stateDir = stateDir
	s.deviceCA = nil
	if err := s.prepareSecureNetwork([]net.Listener{listener}); err != nil {
		t.Fatalf("prepareSecureNetwork() rejected a valid serving identity: %v", err)
	}
	t.Cleanup(s.closePreparedDirectListeners)
	if s.deviceCA == nil || s.tlsConfig == nil || len(s.tlsConfig.Certificates) != 1 {
		t.Fatal("prepareSecureNetwork() did not retain the validated CA-backed serving identity")
	}
}

func TestInspectLocalUIDeviceCAReportsManualClientTrustOnLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-specific trust projection")
	}
	stateDir := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
		t.Fatalf("GenerateLocalUIDeviceCA() error = %v", err)
	}
	status, err := InspectLocalUIDeviceCA(stateDir)
	if err != nil {
		t.Fatalf("InspectLocalUIDeviceCA() error = %v", err)
	}
	if status.Identity != "ready" || status.Trust != "manual_required" {
		t.Fatalf("status = %#v", status)
	}
	if !strings.Contains(status.Remedy, "every browser or client trust store") {
		t.Fatalf("remedy = %q", status.Remedy)
	}
}

func TestLoadLocalUIDeviceCARejectsBroadPrivateKeyPermissions(t *testing.T) {
	stateDir := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
		t.Fatalf("GenerateLocalUIDeviceCA() error = %v", err)
	}
	keyPath := filepath.Join(localUIDeviceCADir(stateDir), localUIDeviceCAKeyName)
	if err := os.Chmod(keyPath, 0o644); err != nil {
		t.Fatalf("chmod key: %v", err)
	}
	if _, err := loadLocalUIDeviceCA(stateDir); !errors.Is(err, ErrLocalUIDeviceCAInvalid) {
		t.Fatalf("loadLocalUIDeviceCA() error = %v", err)
	}
}

func mustReadTestFile(t *testing.T, path string) []byte {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return body
}
