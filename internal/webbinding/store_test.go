package webbinding

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testCertificate(t *testing.T) *x509.Certificate {
	t.Helper()
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, public, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	return certificate
}

func TestCanonicalOrigin(t *testing.T) {
	for _, origin := range []string{"https://e.example.com", "https://e.example.com:8443", "https://127.0.0.1:12345", "https://[::1]:12345"} {
		if err := ValidateOrigin(origin); err != nil {
			t.Errorf("valid origin %q: %v", origin, err)
		}
	}
	for _, origin := range []string{"", "http://e.example.com", "https://E.example.com", "https://e.example.com/", "https://e.example.com?", "https://e.example.com#", "https://user@e.example.com", "https://*.example.com", "https://e.example.com:443", "https://e.example.com:0443", "https://e.example.com:0", "https://e.example.com:65536", "https://e.example.com:", "https://e..example.com", "https://-e.example.com", "https://e.example.com.", "https://0x7f000001", "https://127.1", "https://127.000.0.1", "https://[::ffff:127.0.0.1]", "https://[fe80::1%25en0]", "https://0.0.0.0", "https://例子.test"} {
		if ValidateOrigin(origin) == nil {
			t.Errorf("accepted invalid origin %q", origin)
		}
	}
}

func TestBindingPersistenceAndRevocation(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, "web-runtime")
	if err != nil {
		t.Fatal(err)
	}
	certificate := testCertificate(t)
	b, err := s.Put(Binding{RuntimeID: "web-runtime", AppScope: "envapp", ID: "entry", Origin: "https://e.example.com", PublicKeySHA256: PublicKeyFingerprint(certificate), Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	state := &tls.ConnectionState{Version: tls.VersionTLS13, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{certificate}}
	lease, err := s.Admit(t.Context(), state, "e.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Put(b, 0); !errors.Is(err, ErrConflict) {
		t.Fatal("stale update accepted", err)
	}
	select {
	case <-lease.Context.Done():
		t.Fatal("conflicting update revoked live binding")
	default:
	}
	b.Enabled = false
	b, err = s.Put(b, b.Revision)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-lease.Context.Done():
	case <-time.After(time.Second):
		t.Fatal("revocation did not cancel lease")
	}
	if _, err = s.Admit(t.Context(), state, "e.example.com"); !errors.Is(err, ErrDenied) {
		t.Fatal("revoked entry admitted", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir, "web-runtime")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rows, err := s.List()
	if err != nil || len(rows) != 1 || rows[0] != b {
		t.Fatalf("persistence: %+v %v", rows, err)
	}
	if _, err = s.Put(b, math.MaxInt64); !errors.Is(err, ErrDenied) {
		t.Fatal("revision overflow accepted")
	}
}

func TestAdmissionRejectsUnprovenOrDifferentPeer(t *testing.T) {
	s, err := Open(t.TempDir(), "web-runtime")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	certificate := testCertificate(t)
	_, err = s.Put(Binding{RuntimeID: "web-runtime", AppScope: "envapp", ID: "entry", Origin: "https://e.example.com", PublicKeySHA256: PublicKeyFingerprint(certificate), Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []*tls.ConnectionState{nil, {}, {Version: tls.VersionTLS12, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{certificate}}, {Version: tls.VersionTLS13, PeerCertificates: []*x509.Certificate{certificate}}, {Version: tls.VersionTLS13, HandshakeComplete: true, DidResume: true, PeerCertificates: []*x509.Certificate{certificate}}, {Version: tls.VersionTLS13, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{testCertificate(t)}}} {
		if l, err := s.Admit(t.Context(), state, "e.example.com"); err == nil {
			l.Close()
			t.Fatal("unproven peer admitted")
		}
	}
	state := &tls.ConnectionState{Version: tls.VersionTLS13, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{certificate}}
	if _, err = s.Admit(t.Context(), state, "other.example.com"); err == nil {
		t.Fatal("another origin admitted")
	}
}

func TestConcurrentAdmissionCannotEscapeRevocation(t *testing.T) {
	s, err := Open(t.TempDir(), "web-runtime")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	certificate := testCertificate(t)
	b, err := s.Put(Binding{RuntimeID: "web-runtime", AppScope: "envapp", ID: "entry", Origin: "https://e.example.com", PublicKeySHA256: PublicKeyFingerprint(certificate), Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	state := &tls.ConnectionState{Version: tls.VersionTLS13, HandshakeComplete: true, PeerCertificates: []*x509.Certificate{certificate}}
	var wg sync.WaitGroup
	leases := make(chan *Lease, 64)
	for range 64 {
		wg.Go(func() {
			if l, e := s.Admit(context.Background(), state, "e.example.com"); e == nil {
				leases <- l
			}
		})
	}
	b.Enabled = false
	if _, err = s.Put(b, b.Revision); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	close(leases)
	for l := range leases {
		select {
		case <-l.Context.Done():
		case <-time.After(time.Second):
			t.Fatal("late lease escaped revocation")
		}
		l.Close()
	}
}

func TestBindingStateLossAndIdentityFailClosed(t *testing.T) {
	for _, file := range []string{"web-bindings.sqlite", "web-bindings.owner"} {
		t.Run(file, func(t *testing.T) {
			dir := t.TempDir()
			s, err := Open(dir, "runtime-a")
			if err != nil {
				t.Fatal(err)
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			if err = os.Remove(filepath.Join(dir, "web-entry", file)); err != nil {
				t.Fatal(err)
			}
			if opened, err := Open(dir, "runtime-a"); err == nil {
				opened.Close()
				t.Fatal("missing committed state reopened")
			}
		})
	}
	dir := t.TempDir()
	s, err := Open(dir, "runtime-a")
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if opened, err := Open(dir, "runtime-b"); err == nil {
		opened.Close()
		t.Fatal("another Runtime opened consent")
	}
}

func TestBindingRejectsForeignRuntimeAndUnsafeStorage(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, "runtime-a")
	if err != nil {
		t.Fatal(err)
	}
	certificate := testCertificate(t)
	if _, err = s.Put(Binding{RuntimeID: "runtime-b", AppScope: "envapp", ID: "entry", Origin: "https://e.example.com", PublicKeySHA256: PublicKeyFingerprint(certificate), Enabled: true}, 0); err == nil {
		t.Fatal("foreign Runtime consent accepted")
	}
	s.Close()
	if err = os.Chmod(filepath.Join(dir, "web-entry", "web-bindings.owner"), 0644); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, "runtime-a"); err == nil {
		opened.Close()
		t.Fatal("public marker accepted")
	}
}
