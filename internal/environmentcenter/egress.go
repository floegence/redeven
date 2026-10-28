package environmentcenter

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// endpointEgress constrains opaque SDK artifacts to the verified Gateway's
// endpoint authorities through the published HTTPSProxy extension. It never
// parses or rewrites private Flowersec artifact fields or peer TLS policy.
type endpointEgress struct {
	server   *http.Server
	listener net.Listener
	cancel   context.CancelFunc
	once     sync.Once
}

func endpointAuthorities(endpoints []gp.GatewayEndpoint) (map[string]bool, error) {
	allowed := map[string]bool{}
	if len(endpoints) == 0 || len(endpoints) > 16 {
		return nil, ErrDenied
	}
	for _, endpoint := range endpoints {
		u, err := url.Parse(endpoint.Address)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, ErrDenied
		}
		port := u.Port()
		if port == "" {
			port = "443"
		}
		allowed[net.JoinHostPort(u.Hostname(), port)] = true
	}
	return allowed, nil
}
func newEndpointEgress(parent context.Context, endpoints []gp.GatewayEndpoint) (*endpointEgress, *egress.HTTPSProxy, error) {
	allowed, err := endpointAuthorities(endpoints)
	if err != nil {
		return nil, nil, err
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	leaf := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Center private endpoint egress"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(SessionAbsolute + time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, leaf, public, private)
	if err != nil {
		return nil, nil, err
	}
	certificate := tls.Certificate{Certificate: [][]byte{der}, PrivateKey: private}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, nil, err
	}
	life, cancel := context.WithCancel(parent)
	owner := &endpointEgress{listener: listener, cancel: cancel}
	permits := make(chan struct{}, 8)
	owner.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 8192, TLSConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, NextProtos: []string{"http/1.1"}}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" || r.RequestURI != r.Host || !allowed[r.Host] || life.Err() != nil {
			http.Error(w, "Endpoint denied", 403)
			return
		}
		select {
		case permits <- struct{}{}:
			defer func() { <-permits }()
		default:
			http.Error(w, "Busy", 429)
			return
		}
		dial, stop := context.WithTimeout(life, 10*time.Second)
		target, err := (&net.Dialer{}).DialContext(dial, "tcp", r.Host)
		stop()
		if err != nil {
			http.Error(w, "Endpoint unavailable", 502)
			return
		}
		defer target.Close()
		client, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer client.Close()
		detach := context.AfterFunc(life, func() { client.Close(); target.Close() })
		defer detach()
		if _, err = buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			return
		}
		if err = buffer.Flush(); err != nil {
			return
		}
		done := make(chan struct{})
		go func() {
			_, _ = io.CopyBuffer(target, buffer, make([]byte, 32<<10))
			target.Close()
			client.Close()
			close(done)
		}()
		_, _ = io.CopyBuffer(client, target, make([]byte, 32<<10))
		target.Close()
		client.Close()
		<-done
	})}
	proxy, err := egress.NewHTTPSProxy(egress.HTTPSProxyOptions{URL: "https://" + listener.Addr().String(), TLSConfig: &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{certificate}}})
	if err != nil {
		owner.Close()
		return nil, nil, fmt.Errorf("private egress: %w", err)
	}
	go func() { _ = owner.server.Serve(tls.NewListener(listener, owner.server.TLSConfig)) }()
	context.AfterFunc(life, owner.Close)
	return owner, proxy, nil
}
func (e *endpointEgress) Close() {
	if e != nil {
		e.once.Do(func() {
			e.cancel()
			if e.server != nil {
				_ = e.server.Close()
			}
			_ = e.listener.Close()
		})
	}
}
