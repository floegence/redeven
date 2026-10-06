package gatewaycloud

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"math/big"
	"net"
	"net/url"
	"time"
)

// renewServerCertificate only uses an unexpired local trust root. Root expiry
// requires reauthorization instead of disabling certificate verification.
func renewServerCertificate(config *GatewayConfig) error {
	block, _ := pem.Decode([]byte(config.ServerCertificatePEM))
	if block != nil {
		leaf, err := x509.ParseCertificate(block.Bytes)
		if err == nil && leaf.NotAfter.After(time.Now().Add(30*24*time.Hour)) {
			return nil
		}
	}
	rootBlock, _ := pem.Decode([]byte(config.RootPEM))
	keyBlock, _ := pem.Decode([]byte(config.RootKeyPEM))
	if rootBlock == nil || keyBlock == nil {
		return ErrState
	}
	root, err := x509.ParseCertificate(rootBlock.Bytes)
	if err != nil || !time.Now().Before(root.NotAfter) || time.Now().Before(root.NotBefore) {
		return ErrState
	}
	rootKey, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return ErrState
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	expiry := time.Now().Add(90 * 24 * time.Hour)
	if expiry.After(root.NotAfter) {
		expiry = root.NotAfter
	}
	leaf := &x509.Certificate{SerialNumber: serial, NotBefore: time.Now().Add(-time.Minute), NotAfter: expiry, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	origin, err := url.Parse(config.ListenerURL)
	if err != nil {
		return ErrState
	}
	if ip := net.ParseIP(origin.Hostname()); ip != nil {
		leaf.IPAddresses = []net.IP{ip}
	} else {
		leaf.DNSNames = []string{origin.Hostname()}
	}
	der, err := x509.CreateCertificate(rand.Reader, leaf, root, key.Public(), rootKey)
	if err != nil {
		return err
	}
	private, err := privateKeyPEM(key)
	if err != nil {
		return err
	}
	config.ServerCertificatePEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	config.ServerKeyPEM = private
	return nil
}

func (g *Gateway) serverCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	old := g.config.ServerCertificatePEM
	next := g.config
	if err := renewServerCertificate(&next); err != nil {
		return nil, err
	}
	if old != next.ServerCertificatePEM {
		if err := WriteState(g.path, next); err != nil {
			return nil, err
		}
		g.config = next
	}
	certificate, err := tls.X509KeyPair([]byte(g.config.ServerCertificatePEM), []byte(g.config.ServerKeyPEM))
	return &certificate, err
}
