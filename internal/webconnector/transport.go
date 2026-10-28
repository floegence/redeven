// Package webconnector adapts an authorized Gateway session to one verified
// Runtime HTTPS service. Flowersec owns the encrypted stream lifecycle.
package webconnector

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/webbinding"
)

var ErrDenied = errors.New("Web connector target is not authorized")

// Transport pins the signed Runtime service independently from the registered
// browser origin. It has no arbitrary URL, direct-network, or proxy fallback.
type Transport struct {
	transport *http.Transport
	origin    string
	browser   string
	device    string
	cancel    context.CancelFunc
}

type Options struct {
	Session           flowersec.Session
	Service           gp.MemberService
	Delegation        gp.MemberDelegation
	GatewayID         string
	MemberID          string
	RuntimeID         string
	BrowserOrigin     string
	DeviceReference   string
	ClientCertificate tls.Certificate
}

func New(ctx context.Context, options Options) (*Transport, error) {
	if ctx == nil || options.Session == nil || ctx.Err() != nil || webbinding.ValidateOrigin(options.BrowserOrigin) != nil || options.GatewayID == "" || options.MemberID == "" || options.RuntimeID == "" || options.Delegation.GatewayID != options.GatewayID || options.Delegation.MemberID != options.MemberID || options.Delegation.RuntimePublicID != options.RuntimeID || len(options.ClientCertificate.Certificate) != 1 || options.ClientCertificate.PrivateKey == nil {
		return nil, ErrDenied
	}
	if err := gatewaymembership.VerifyMemberService(options.Service, options.Delegation, time.Now()); err != nil {
		return nil, ErrDenied
	}
	device, err := base64.RawURLEncoding.DecodeString(options.DeviceReference)
	if err != nil || len(device) != 32 || base64.RawURLEncoding.EncodeToString(device) != options.DeviceReference {
		return nil, ErrDenied
	}
	service, err := url.Parse(options.Service.Origin)
	if err != nil {
		return nil, ErrDenied
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(options.Service.CertificatePEM)) {
		return nil, ErrDenied
	}
	lifetime, cancel := context.WithCancel(ctx)
	transport := &http.Transport{
		Proxy: nil, MaxConnsPerHost: 6, MaxIdleConns: 6, MaxIdleConnsPerHost: 2,
		IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 30 * time.Second, TLSHandshakeTimeout: 10 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		TLSClientConfig:        &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{options.ClientCertificate}, MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}},
		DialContext: func(request context.Context, network, target string) (net.Conn, error) {
			if network != "tcp" || target != net.JoinHostPort(service.Hostname(), "443") || lifetime.Err() != nil {
				return nil, ErrDenied
			}
			attempt, stop := context.WithCancel(request)
			detach := context.AfterFunc(lifetime, stop)
			defer detach()
			defer stop()
			stream, err := options.Session.OpenStream(attempt, gp.MemberAccessStream, flowersec.EmptyStreamMetadata())
			if err != nil {
				return nil, err
			}
			connection, err := flowersec.NewByteStreamConn(lifetime, stream)
			if err != nil {
				_ = stream.Close()
				return nil, err
			}
			return connection, nil
		},
	}
	return &Transport{transport: transport, origin: options.Service.Origin, browser: options.BrowserOrigin, device: options.DeviceReference, cancel: cancel}, nil
}

func (t *Transport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil || request.URL == nil || request.URL.Scheme+"://"+request.URL.Host != t.origin || request.URL.User != nil || request.Host != t.browser[len("https://"):] {
		return nil, ErrDenied
	}
	out := request.Clone(request.Context())
	out.Header.Set("X-Redeven-Web-Device", t.device)
	return t.transport.RoundTrip(out)
}

func (t *Transport) Close() {
	if t == nil {
		return
	}
	t.cancel()
	t.transport.CloseIdleConnections()
}
