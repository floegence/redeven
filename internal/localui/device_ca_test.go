package localui

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHTTPSRejectsExpiredAndMismatchedIdentityWithoutHTTPFallback(t *testing.T) {
	for _, expired := range []bool{true, false} {
		name := "mismatched_key"
		if expired {
			name = "expired"
		}
		t.Run(name, func(t *testing.T) {
			stateDir := t.TempDir()
			if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
				t.Fatal(err)
			}
			ca, err := loadLocalUIDeviceCA(stateDir)
			if err != nil {
				t.Fatal(err)
			}
			if expired {
				certificate := *ca.certificate
				certificate.NotBefore = time.Now().Add(-48 * time.Hour)
				certificate.NotAfter = time.Now().Add(-24 * time.Hour)
				der, err := x509.CreateCertificate(rand.Reader, &certificate, &certificate, &ca.key.PublicKey, ca.key)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(localUIDeviceCADir(stateDir), localUIDeviceCACertName), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
					t.Fatal(err)
				}
			} else {
				key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				if err != nil {
					t.Fatal(err)
				}
				der, err := x509.MarshalPKCS8PrivateKey(key)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(localUIDeviceCADir(stateDir), localUIDeviceCAKeyName), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			s := newTestServer(t, nil)
			s.stateDir, s.deviceCA = stateDir, nil
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			s.bind, err = ParseBind(listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			err = s.StartOnListeners(t.Context(), []net.Listener{listener}, nil)
			defer s.Close()
			want := ErrLocalUIDeviceCAInvalid
			if expired {
				want = ErrLocalUIDeviceCAExpired
			}
			if !errors.Is(err, want) {
				t.Fatalf("startup = %v, want %v", err, want)
			}
			if s.protocol != "https" || len(s.networkServers) != 0 {
				t.Fatal("invalid HTTPS identity started a public listener or changed protocol")
			}
		})
	}
}

func TestLocalUIDeviceCALifecycle(t *testing.T) {
	stateDir := t.TempDir()
	generated, err := GenerateLocalUIDeviceCA(stateDir)
	if err != nil {
		t.Fatalf("GenerateLocalUIDeviceCA() error = %v", err)
	}
	if generated.Identity != "ready" || generated.Trust != "unknown" {
		t.Fatalf("generated status = %#v", generated)
	}
	if _, err := GenerateLocalUIDeviceCA(stateDir); !errors.Is(err, ErrLocalUIDeviceCAExists) {
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

func TestInspectLocalUIDeviceCASeparatesIdentityFromClientTrust(t *testing.T) {
	stateDir := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
		t.Fatal(err)
	}
	status, err := InspectLocalUIDeviceCA(stateDir)
	if err != nil {
		t.Fatalf("querying an untrusted certificate must succeed: %v", err)
	}
	if status.Identity != "ready" || (status.Trust != "untrusted" && status.Trust != "manual_required") {
		t.Fatalf("fresh certificate status = %#v", status)
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
	if err := s.prepareNetwork([]net.Listener{listener}); err != nil {
		t.Fatalf("prepareNetwork() rejected a valid serving identity: %v", err)
	}
	if s.deviceCA == nil || s.tlsConfig == nil || len(s.tlsConfig.Certificates) != 1 {
		t.Fatal("prepareNetwork() did not retain the validated CA-backed serving identity")
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

func TestDeviceCAIncompleteAndFutureIdentityAreNotReportedAsMissingOrExpired(t *testing.T) {
	t.Run("incomplete", func(t *testing.T) {
		stateDir := t.TempDir()
		if err := os.Mkdir(filepath.Join(stateDir, localUIDeviceCADirName), 0o700); err != nil {
			t.Fatal(err)
		}
		status, err := InspectLocalUIDeviceCA(stateDir)
		if !errors.Is(err, ErrLocalUIDeviceCAInvalid) || status.Identity != "invalid" {
			t.Fatalf("status=%#v err=%v", status, err)
		}
	})
	t.Run("future", func(t *testing.T) {
		stateDir := t.TempDir()
		if _, err := GenerateLocalUIDeviceCA(stateDir); err != nil {
			t.Fatal(err)
		}
		ca, err := loadLocalUIDeviceCA(stateDir)
		if err != nil {
			t.Fatal(err)
		}
		certificate := *ca.certificate
		certificate.NotBefore = time.Now().Add(time.Hour)
		der, err := x509.CreateCertificate(rand.Reader, &certificate, &certificate, &ca.key.PublicKey, ca.key)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(LocalUIDeviceCACertificatePath(stateDir), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
			t.Fatal(err)
		}
		status, err := InspectLocalUIDeviceCA(stateDir)
		if !errors.Is(err, ErrLocalUIDeviceCANotYetValid) || status.Identity != "not_yet_valid" {
			t.Fatalf("status=%#v err=%v", status, err)
		}
	})
}

func TestDeviceCATrustInstallErrorsKeepPlatformCancellationDistinct(t *testing.T) {
	for _, test := range []struct {
		platform, output string
		want             error
	}{
		{"darwin", "OSStatus (-128)", ErrLocalUIDeviceCAInstallCanceled},
		{"darwin", "OSStatus (-60006)", ErrLocalUIDeviceCAInstallCanceled},
		{"darwin", "SecTrustSettingsSetTrustSettings: The authorization was canceled by the user.", ErrLocalUIDeviceCAInstallCanceled},
		{"darwin", "SecTrustSettingsSetTrustSettings: The authorization was denied.", ErrLocalUIDeviceCAInstallFailed},
		{"windows", "SecTrustSettingsSetTrustSettings: The authorization was canceled by the user.", ErrLocalUIDeviceCAInstallFailed},
		{"windows", "0x800704c7", ErrLocalUIDeviceCAInstallCanceled},
		{"darwin", "access denied", ErrLocalUIDeviceCAInstallFailed},
	} {
		err := deviceCATrustInstallError(test.platform, []byte(test.output), errors.New("exit status 1"))
		if !errors.Is(err, test.want) {
			t.Fatalf("%s: %v", test.platform, err)
		}
	}
}
