package localui

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
)

func importedIdentityFixture(t *testing.T, change func(*x509.Certificate)) CertificateImport {
	t.Helper()
	root := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(root); err != nil {
		t.Fatal(err)
	}
	ca, err := loadLocalUIDeviceCA(root)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Local UI"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	if change != nil {
		change(cert)
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, ca.certificate, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return CertificateImport{CertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})) + string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.certificate.Raw})), PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}))}
}

func TestCertificateImportRejectsInvalidInputWithoutReplacingIdentity(t *testing.T) {
	valid := importedIdentityFixture(t, nil)
	for _, name := range []string{"mismatch", "expired", "future", "client_only", "no_san", "secret_in_certificate", "trailing_junk", "extra_key", "wrong_usage"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			original, err := GenerateLocalUIDeviceCA(dir)
			if err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(filepath.Join(localUIDeviceCADir(dir), localUIDeviceCAKeyName))
			input := valid
			switch name {
			case "mismatch":
				input.PrivateKeyPEM = importedIdentityFixture(t, nil).PrivateKeyPEM
			case "expired":
				input = importedIdentityFixture(t, func(c *x509.Certificate) { c.NotAfter = time.Now().Add(-time.Minute) })
			case "future":
				input = importedIdentityFixture(t, func(c *x509.Certificate) { c.NotBefore = time.Now().Add(time.Minute) })
			case "client_only":
				input = importedIdentityFixture(t, func(c *x509.Certificate) { c.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth} })
			case "no_san":
				input = importedIdentityFixture(t, func(c *x509.Certificate) { c.DNSNames = nil; c.IPAddresses = nil })
			case "secret_in_certificate":
				input.CertificatePEM += input.PrivateKeyPEM
			case "trailing_junk":
				input.CertificatePEM += "secret-junk"
			case "extra_key":
				input.PrivateKeyPEM += input.PrivateKeyPEM
			case "wrong_usage":
				input = importedIdentityFixture(t, func(c *x509.Certificate) { c.KeyUsage = x509.KeyUsageCertSign })
			}
			if _, err := ImportLocalUICertificate(dir, input); err == nil {
				t.Fatal("invalid import succeeded")
			}
			after, _ := os.ReadFile(filepath.Join(localUIDeviceCADir(dir), localUIDeviceCAKeyName))
			current, err := InspectLocalUIDeviceCA(dir)
			if err != nil || current.Fingerprint != original.Fingerprint || string(before) != string(after) {
				t.Fatalf("original identity changed: %+v, %v", current, err)
			}
		})
	}
}

func TestImportedCertificateServesTLSAndSurvivesSavedRemoval(t *testing.T) {
	dir := t.TempDir()
	input := importedIdentityFixture(t, nil)
	status, err := ImportLocalUICertificate(dir, input)
	if err != nil || status.Kind != "server" {
		t.Fatalf("import: %+v %v", status, err)
	}
	ca, err := loadLocalUIDeviceCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	pair, _, err := newLocalUIServerCertificate(ca, []string{"localhost", "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := newLocalUIServerCertificate(ca, []string{"192.0.2.2"}); err == nil {
		t.Fatal("uncovered host accepted")
	}
	if err := InstallLocalUIDeviceCAForCurrentUser(dir); !errors.Is(err, ErrLocalUIDeviceCAManual) {
		t.Fatalf("server leaf offered as root: %v", err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	server.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}}
	server.StartTLS()
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(input.CertificatePEM))
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}}, Timeout: time.Second}
	defer client.CloseIdleConnections()
	check := func() {
		t.Helper()
		res, err := client.Get(server.URL)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 204 {
			t.Fatal(res.Status)
		}
	}
	check()
	export := filepath.Join(t.TempDir(), "public.pem")
	if err := ExportLocalUIDeviceCA(dir, export); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(export)
	if strings.Contains(string(body), "PRIVATE KEY") {
		t.Fatal("secret exported")
	}
	if _, err := RemoveLocalUICertificate(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLocalUIDeviceCA(dir); !errors.Is(err, ErrLocalUIDeviceCAMissing) {
		t.Fatal(err)
	}
	client.CloseIdleConnections()
	check()
	fresh, err := GenerateLocalUIDeviceCA(dir)
	if err != nil || fresh.Fingerprint == status.Fingerprint {
		t.Fatalf("fresh identity: %+v %v", fresh, err)
	}
}

func TestCertificateReplacementRollbackAndRecovery(t *testing.T) {
	dir := t.TempDir()
	original, err := GenerateLocalUIDeviceCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	staging := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(staging); err != nil {
		t.Fatal(err)
	}
	injected := errors.New("commit failure")
	calls := 0
	err = replaceDeviceIdentity(dir, localUIDeviceCADir(staging), func(a, b string) error {
		calls++
		if calls == 2 {
			return injected
		}
		return os.Rename(a, b)
	})
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	status, err := InspectLocalUIDeviceCA(dir)
	if err != nil || status.Fingerprint != original.Fingerprint {
		t.Fatalf("rollback: %+v %v", status, err)
	}
	if err := os.Rename(localUIDeviceCADir(dir), localUIDeviceCADir(dir)+".previous"); err != nil {
		t.Fatal(err)
	}
	status, err = InspectLocalUIDeviceCA(dir)
	if err != nil || status.Fingerprint != original.Fingerprint {
		t.Fatalf("recovery: %+v %v", status, err)
	}
	fresh, err := RegenerateLocalUIDeviceCA(dir)
	if err != nil || fresh.Fingerprint == original.Fingerprint {
		t.Fatalf("regenerate: %+v %v", fresh, err)
	}
}

func TestCertificateBindPreflightAndLegacyCAImport(t *testing.T) {
	dir := t.TempDir()
	input := importedIdentityFixture(t, nil)
	if _, err := ImportLocalUICertificate(dir, input); err != nil {
		t.Fatal(err)
	}
	if err := ValidateLocalUICertificateForBind(dir, "localhost:23998"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateLocalUICertificateForBind(dir, "192.0.2.1:23998"); err == nil {
		t.Fatal("missing IP SAN accepted")
	}
	source := t.TempDir()
	original, err := GenerateLocalUIDeviceCA(source)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := os.ReadFile(localUIDeviceCACertificatePath(source))
	key, _ := os.ReadFile(filepath.Join(localUIDeviceCADir(source), localUIDeviceCAKeyName))
	status, err := ImportLocalUICertificate(dir, CertificateImport{CertificatePEM: string(cert), PrivateKeyPEM: string(key)})
	if err != nil || status.Kind != "device_ca" || status.Fingerprint != original.Fingerprint {
		t.Fatalf("legacy import: %+v %v", status, err)
	}
}

func TestCertificateCommittedRemovalWinsDuringRecovery(t *testing.T) {
	dir := t.TempDir()
	if _, err := GenerateLocalUIDeviceCA(dir); err != nil {
		t.Fatal(err)
	}
	previous := localUIDeviceCADir(dir) + ".previous"
	if err := os.Rename(localUIDeviceCADir(dir), previous); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(localUIDeviceCADir(dir), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localUIDeviceCADir(dir), "identity-kind"), []byte("removed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectLocalUIDeviceCA(dir); !errors.Is(err, ErrLocalUIDeviceCAMissing) {
		t.Fatalf("removed identity resurrected: %v", err)
	}
	if _, err := os.Lstat(previous); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("previous identity retained: %v", err)
	}
}

func TestCertificateOperationsRejectConcurrentMutationAndUnsafeTargets(t *testing.T) {
	dir := t.TempDir()
	original, err := GenerateLocalUIDeviceCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := lockfile.Acquire(filepath.Join(dir, "device-ca.lock"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RegenerateLocalUIDeviceCA(dir); !errors.Is(err, lockfile.ErrAlreadyLocked) {
		t.Fatalf("concurrent mutation: %v", err)
	}
	lock.Release()
	current, err := InspectLocalUIDeviceCA(dir)
	if err != nil || current.Fingerprint != original.Fingerprint {
		t.Fatal("concurrent mutation changed identity")
	}
	other := t.TempDir()
	if err := os.Symlink(localUIDeviceCADir(dir), localUIDeviceCADir(other)); err != nil {
		t.Fatal(err)
	}
	if _, err := RemoveLocalUICertificate(other); !errors.Is(err, ErrLocalUIDeviceCAInvalid) {
		t.Fatalf("unsafe removal: %v", err)
	}
	current, err = InspectLocalUIDeviceCA(dir)
	if err != nil || current.Fingerprint != original.Fingerprint {
		t.Fatal("symlink target changed")
	}
}

func TestCertificateServingFingerprintIncludesChain(t *testing.T) {
	dir := t.TempDir()
	input := importedIdentityFixture(t, nil)
	if _, err := ImportLocalUICertificate(dir, input); err != nil {
		t.Fatal(err)
	}
	before, err := loadLocalUIDeviceCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := pem.Decode([]byte(input.CertificatePEM))
	input.CertificatePEM = string(pem.EncodeToMemory(leaf))
	if _, err := ImportLocalUICertificate(dir, input); err != nil {
		t.Fatal(err)
	}
	after, err := loadLocalUIDeviceCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	if deviceIdentityFingerprint(before) != deviceIdentityFingerprint(after) {
		t.Fatal("leaf changed")
	}
	if deviceIdentityServingFingerprint(before) == deviceIdentityServingFingerprint(after) {
		t.Fatal("chain change did not require restart")
	}
}
