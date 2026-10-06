package gatewaymembership

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/url"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func serialNumber() (*big.Int, error) {
	return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
}
func keyPEM(key any) (string, error) {
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})), nil
}
func certPEM(raw []byte) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}))
}

func newEndpoint(origin, listen string) (Endpoint, error) {
	origin, err := canonicalOrigin(origin)
	if err != nil {
		return Endpoint{}, err
	}
	if _, _, err := net.SplitHostPort(listen); err != nil {
		return Endpoint{}, ErrState
	}
	now := time.Now()
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Endpoint{}, err
	}
	serial, err := serialNumber()
	if err != nil {
		return Endpoint{}, err
	}
	rootTemplate := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Gateway member authority"}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign, MaxPathLenZero: true}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	if err != nil {
		return Endpoint{}, err
	}
	root, err := x509.ParseCertificate(rootDER)
	if err != nil {
		return Endpoint{}, err
	}
	rootPrivate, err := keyPEM(rootKey)
	if err != nil {
		return Endpoint{}, err
	}
	return renewEndpoint(Endpoint{URL: origin, ListenAddress: listen, RootPEM: certPEM(root.Raw), RootKeyPEM: rootPrivate})
}

func renewEndpoint(endpoint Endpoint) (Endpoint, error) {
	rootBlock, _ := pem.Decode([]byte(endpoint.RootPEM))
	keyBlock, _ := pem.Decode([]byte(endpoint.RootKeyPEM))
	if rootBlock == nil || keyBlock == nil || !validOrigin(endpoint.URL) {
		return Endpoint{}, ErrState
	}
	root, err := x509.ParseCertificate(rootBlock.Bytes)
	if err != nil || !root.IsCA {
		return Endpoint{}, ErrState
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return Endpoint{}, ErrState
	}
	signer, ok := parsedKey.(crypto.Signer)
	if !ok {
		return Endpoint{}, ErrState
	}
	now := time.Now()
	expires := now.AddDate(0, 3, 0).Truncate(time.Second)
	if now.Before(root.NotBefore) || !now.Before(root.NotAfter) {
		return Endpoint{}, ErrDenied
	}
	if expires.After(root.NotAfter) {
		expires = root.NotAfter
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Endpoint{}, err
	}
	serial, err := serialNumber()
	if err != nil {
		return Endpoint{}, err
	}
	parsed, _ := url.Parse(endpoint.URL)
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Gateway"}, NotBefore: now.Add(-time.Minute), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil {
		template.IPAddresses = []net.IP{ip}
	} else {
		template.DNSNames = []string{parsed.Hostname()}
	}
	raw, err := x509.CreateCertificate(rand.Reader, template, root, &key.PublicKey, signer)
	if err != nil {
		return Endpoint{}, err
	}
	endpoint.CertificatePEM = certPEM(raw)
	endpoint.PrivateKeyPEM, err = keyPEM(key)
	if err != nil {
		return Endpoint{}, err
	}
	if _, err := endpointTLS(endpoint); err != nil {
		return Endpoint{}, err
	}
	return endpoint, nil
}

// The still-valid member authority can renew its serving leaf after a long
// offline interval. An expired authority never receives an implicit new trust root.
func (s *Store) ensureEndpoint() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	block, _ := pem.Decode([]byte(s.state.Endpoint.CertificatePEM))
	if block == nil {
		return ErrState
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return ErrState
	}
	if time.Until(leaf.NotAfter) > 30*24*time.Hour {
		_, err := endpointTLS(s.state.Endpoint)
		return err
	}
	endpoint, err := renewEndpoint(s.state.Endpoint)
	if err != nil {
		return err
	}
	next := s.clone()
	next.Endpoint = endpoint
	return s.commit(next)
}

func endpointTLS(endpoint Endpoint) (*tls.Config, error) {
	pair, err := tls.X509KeyPair([]byte(endpoint.CertificatePEM), []byte(endpoint.PrivateKeyPEM))
	if err != nil {
		return nil, ErrState
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(endpoint.RootPEM)) {
		return nil, ErrState
	}
	if !validOrigin(endpoint.URL) {
		return nil, ErrState
	}
	u, _ := url.Parse(endpoint.URL)
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, ErrState
	}
	if _, err := leaf.Verify(x509.VerifyOptions{DNSName: u.Hostname(), Roots: roots, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}); err != nil {
		return nil, ErrState
	}
	return &tls.Config{Certificates: []tls.Certificate{pair}, ClientCAs: roots, ClientAuth: tls.VerifyClientCertIfGiven, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}, SessionTicketsDisabled: true}, nil
}

func (s *Store) TLSConfig() (*tls.Config, error) {
	if err := s.ensureEndpoint(); err != nil {
		return nil, err
	}
	config, err := endpointTLS(s.Endpoint())
	if err != nil {
		return nil, err
	}
	config.Certificates = nil
	config.GetCertificate = func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
		if err := s.ensureEndpoint(); err != nil {
			return nil, err
		}
		endpoint := s.Endpoint()
		pair, err := tls.X509KeyPair([]byte(endpoint.CertificatePEM), []byte(endpoint.PrivateKeyPEM))
		return &pair, err
	}
	return config, nil
}

func issueClientCertificate(endpoint Endpoint, csrPEM, memberID string) (string, string, int64, error) {
	block, rest := pem.Decode([]byte(csrPEM))
	if block == nil || block.Type != "CERTIFICATE REQUEST" || len(rest) != 0 {
		return "", "", 0, ErrInvalidProof
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil || csr.CheckSignature() != nil {
		return "", "", 0, ErrInvalidProof
	}
	switch key := csr.PublicKey.(type) {
	case ed25519.PublicKey:
	case *ecdsa.PublicKey:
		if key.Curve != elliptic.P256() {
			return "", "", 0, ErrInvalidProof
		}
	default:
		return "", "", 0, ErrInvalidProof
	}
	rootBlock, _ := pem.Decode([]byte(endpoint.RootPEM))
	keyBlock, _ := pem.Decode([]byte(endpoint.RootKeyPEM))
	if rootBlock == nil || keyBlock == nil {
		return "", "", 0, ErrState
	}
	root, err := x509.ParseCertificate(rootBlock.Bytes)
	if err != nil {
		return "", "", 0, ErrState
	}
	key, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return "", "", 0, ErrState
	}
	now := time.Now()
	expires := now.AddDate(0, 6, 0).Truncate(time.Second)
	if expires.After(root.NotAfter) || now.Before(root.NotBefore) {
		return "", "", 0, ErrState
	}
	serial, err := serialNumber()
	if err != nil {
		return "", "", 0, err
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: memberID}, NotBefore: now.Add(-time.Minute), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	raw, err := x509.CreateCertificate(rand.Reader, template, root, csr.PublicKey, key)
	if err != nil {
		return "", "", 0, err
	}
	return certPEM(raw), digest(raw), expires.UnixMilli(), nil
}

// NewServiceCertificate creates only the fixed application origin. It never
// exposes a machine hostname, private management endpoint or routable address.
func NewServiceCertificate(runtimeID string) (gp.MemberService, string, error) {
	if !validID(runtimeID) {
		return gp.MemberService{}, "", ErrState
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return gp.MemberService{}, "", err
	}
	serial, err := serialNumber()
	if err != nil {
		return gp.MemberService{}, "", err
	}
	origin := ServiceOrigin(runtimeID)
	u, _ := url.Parse(origin)
	now := time.Now()
	expires := now.AddDate(0, 3, 0).Truncate(time.Second)
	// This self-signed identity is the trust anchor of one isolated application
	// session. BoringSSL requires explicit CA constraints for an anchor; Desktop
	// still pins the exact certificate and permits only this logical hostname.
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Runtime application"}, DNSNames: []string{u.Hostname()}, NotBefore: now.Add(-time.Minute), NotAfter: expires, BasicConstraintsValid: true, IsCA: true, MaxPathLenZero: true, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return gp.MemberService{}, "", err
	}
	private, err := keyPEM(key)
	if err != nil {
		return gp.MemberService{}, "", err
	}
	return gp.MemberService{Revision: 1, Origin: origin, CertificatePEM: certPEM(raw), CertificateSHA256: digest(raw), ExpiresAtUnixMS: expires.UnixMilli()}, private, nil
}
