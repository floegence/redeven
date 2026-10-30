package gatewaymembership

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRuntimeServiceCertificateCoversOnlyItsPluginNamespace(t *testing.T) {
	service, _, err := NewServiceCertificate("plugin-runtime")
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode([]byte(service.CertificatePEM))
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	parent, _ := url.Parse(service.Origin)
	child := strings.Repeat("a", 48) + "." + parent.Hostname()
	if err = certificate.VerifyHostname(child); err != nil {
		t.Fatalf("allocated plugin origin is not in signed certificate: %v", err)
	}
	for _, host := range []string{"other.redeven.invalid", strings.Repeat("a", 48) + ".other.redeven.invalid", "nested." + child} {
		if certificate.VerifyHostname(host) == nil {
			t.Errorf("certificate escapes Runtime: %s", host)
		}
	}
}

func TestLegacyRuntimeServiceUsesExistingRotationTransaction(t *testing.T) {
	service, keyPEM, err := NewServiceCertificate("plugin-runtime")
	if err != nil {
		t.Fatal(err)
	}
	config := &RuntimeConfig{Service: service, ClientExpiresAtUnixMS: time.Now().Add(60 * 24 * time.Hour).UnixMilli()}
	if runtimeServiceNeedsRotation(config) {
		t.Fatal("current certificate unexpectedly rotates")
	}
	block, _ := pem.Decode([]byte(service.CertificatePEM))
	certificate, _ := x509.ParseCertificate(block.Bytes)
	keyBlock, _ := pem.Decode([]byte(keyPEM))
	key, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	certificate.DNSNames = certificate.DNSNames[:1]
	raw, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.(*ecdsa.PrivateKey).PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	config.Service.CertificatePEM = certPEM(raw)
	if !runtimeServiceNeedsRotation(config) {
		t.Fatal("parent-only certificate skips published rotation transaction")
	}
}
