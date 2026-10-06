package gatewayegress

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEgressRequiresCertificateAndApprovedDestination(t *testing.T) {
	server, err := New(Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	for _, target := range []string{"cloud.example:443", "127.0.0.1:443"} {
		request := httptest.NewRequest(http.MethodConnect, "https://"+target, nil)
		request.Host = target
		out := httptest.NewRecorder()
		server.ServeHTTP(out, request)
		if out.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated request status=%d", out.Code)
		}
	}
}

func TestEgressForwardsAuthenticatedBytesAndRevokesMember(t *testing.T) {
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	go func() {
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.Copy(conn, conn)
	}()
	server, err := New(Options{AllowPrivateDestinations: true, MaxConnectionsPerMember: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	roots, serverCertificate, certificate := testCertificates(t)
	proxy := httptest.NewUnstartedServer(server)
	proxy.TLS, err = TLSConfig(serverCertificate, roots)
	if err != nil {
		t.Fatal(err)
	}
	proxy.StartTLS()
	defer proxy.Close()
	sum := sha256.Sum256(certificate.Certificate[0])
	member := Member{ID: "member-a", Generation: 1, CertificateSHA256: hex.EncodeToString(sum[:]), Destinations: []string{target.Addr().String()}}
	if err := server.ReplaceMembers([]Member{member}); err != nil {
		t.Fatal(err)
	}
	dial := func(destination string) (net.Conn, *http.Response) {
		t.Helper()
		conn, err := tls.Dial("tcp", proxy.Listener.Addr().String(), &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13})
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		_, err = io.WriteString(conn, "CONNECT "+destination+" HTTP/1.1\r\nHost: "+destination+"\r\n\r\n")
		if err != nil {
			conn.Close()
			t.Fatal(err)
		}
		response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodConnect})
		if err != nil {
			conn.Close()
			t.Fatal(err)
		}
		return conn, response
	}
	denied, response := dial("other.invalid:443")
	denied.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unapproved destination status=%d", response.StatusCode)
	}
	conn, response := dial(target.Addr().String())
	defer conn.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("CONNECT status=%d", response.StatusCode)
	}
	_, _ = io.WriteString(conn, "secret application bytes")
	body := make([]byte, len("secret application bytes"))
	if _, err := io.ReadFull(conn, body); err != nil || string(body) != "secret application bytes" {
		t.Fatalf("echo=%q err=%v", body, err)
	}
	limited, response := dial(target.Addr().String())
	limited.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("limit status=%d", response.StatusCode)
	}
	if err := server.ReplaceMembers(nil); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("revoked member stream remains live")
	}
}

func testCertificates(t *testing.T) (*x509.CertPool, tls.Certificate, tls.Certificate) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	issue := func(serial int64, usage x509.ExtKeyUsage) tls.Certificate {
		leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		leaf := &x509.Certificate{SerialNumber: big.NewInt(serial), NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
		der, err := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, key)
		if err != nil {
			t.Fatal(err)
		}
		return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: leafKey}
	}
	return roots, issue(2, x509.ExtKeyUsageServerAuth), issue(3, x509.ExtKeyUsageClientAuth)
}

func TestEgressRejectsUnsafeDestinationsBeforeDial(t *testing.T) {
	for _, address := range []string{"127.0.0.1:443", "[::1]:443", "169.254.169.254:80", "10.0.0.1:443", "example.com:0", "example.com:443\r\nInjected: value"} {
		server, err := New(Options{})
		if err != nil {
			t.Fatal(err)
		}
		_, err = server.dialDestination(context.Background(), address)
		server.Close()
		if err == nil {
			t.Fatalf("unsafe destination accepted: %q", address)
		}
	}
}

func TestEgressRejectsDuplicateOrMalformedMembersWithoutChangingPolicy(t *testing.T) {
	server, err := New(Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	valid := Member{ID: "a", Generation: 1, CertificateSHA256: strings.Repeat("a", 64), Destinations: []string{"cloud.example:443"}}
	if err := server.ReplaceMembers([]Member{valid}); err != nil {
		t.Fatal(err)
	}
	if err := server.ReplaceMembers([]Member{valid, valid}); err == nil {
		t.Fatal("duplicate member accepted")
	}
	if server.MemberCount() != 1 {
		t.Fatal("failed update replaced existing policy")
	}
	valid.Destinations = []string{"cloud.example:443/path"}
	if err := server.ReplaceMembers([]Member{valid}); err == nil {
		t.Fatal("malformed destination accepted")
	}
}
