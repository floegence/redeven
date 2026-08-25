package localui

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
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
