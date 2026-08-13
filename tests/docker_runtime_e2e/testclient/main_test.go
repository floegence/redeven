package main

import (
	"crypto/x509"
	"errors"
	"net/url"
	"strings"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

func TestConnectorTrustRootsMatchLocalUITransport(t *testing.T) {
	roots := x509.NewCertPool()

	loopback, err := url.Parse("http://127.0.0.1:23998")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := connectorTrustRoots(loopback, func() (*x509.CertPool, error) { return roots, nil }); err != nil || got != nil {
		t.Fatalf("plaintext loopback trust roots = %v, %v; want nil, nil", got, err)
	}

	secure, err := url.Parse("https://redeven.example:23998")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := connectorTrustRoots(secure, func() (*x509.CertPool, error) { return roots, nil }); err != nil || got != roots {
		t.Fatalf("secure trust roots = %v, %v; want supplied pool", got, err)
	}

	network, err := url.Parse("http://192.0.2.10:23998")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := connectorTrustRoots(network, func() (*x509.CertPool, error) { return roots, nil }); err == nil {
		t.Fatal("plaintext non-loopback endpoint unexpectedly selected connector trust roots")
	}
}

func TestRPCActionErrorPreservesSanitizedApplicationMeaning(t *testing.T) {
	application := rpcActionError("sys.upgrade", &flowersec.RPCError{Code: 501, Message: "upgrade not supported"})
	if got := application.Error(); !strings.Contains(got, "upgrade not supported") || !strings.Contains(got, "code=501") {
		t.Fatalf("application error = %q, want sanitized message and code", got)
	}

	transport := rpcActionError("sys.upgrade", errors.New("transport unavailable"))
	if got := transport.Error(); got != "sys.upgrade: transport unavailable" {
		t.Fatalf("transport error = %q", got)
	}
}
