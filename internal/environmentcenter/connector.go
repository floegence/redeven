package environmentcenter

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net/http"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/webconnector"
)

type connectorSource struct {
	mu      sync.Mutex
	client  *gatewayClient
	route   Route
	version int64
	offer   gatewaymembership.ConnectionOffer
}

func (s *connectorSource) Acquire(ctx context.Context) (flowersec.ArtifactLease, *flowersec.ArtifactSourceError) {
	offer, err := s.client.offer(ctx, s.route, s.version)
	if err != nil {
		if retryable(err) {
			return flowersec.ArtifactLease{}, flowersec.NewRetryableArtifactSourceError(err)
		}
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.offer.Service.Revision > offer.Service.Revision || s.offer.Service.Revision == offer.Service.Revision && s.offer.Service.CertificateSHA256 != "" && s.offer.Service.CertificateSHA256 != offer.Service.CertificateSHA256 {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(ErrDenied)
	}
	artifact, err := flowersec.ParseArtifact(offer.Artifact)
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	s.offer = offer
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	return lease, nil
}

// connection owns one device/route transport. The SDK owns retry timing and
// single-use artifacts; business HTTP requests are never replayed by this owner.
type connection struct {
	mu          sync.Mutex
	source      *connectorSource
	controller  *flowersec.ConnectionController
	ctx         context.Context
	cancel      context.CancelFunc
	certificate tls.Certificate
	device      string
	transport   *webconnector.Transport
	session     flowersec.Session
	fingerprint string
	closed      bool
	egress      *endpointEgress
}

func connect(ctx context.Context, record GatewayRecord, route Route, device string) (*connection, error) {
	client := newGatewayClient(record)
	catalog, err := client.catalog(ctx)
	if err != nil {
		client.close()
		return nil, err
	}
	var member *gp.Member
	for _, candidate := range catalog.Members {
		if candidate.MemberID == route.MemberID && candidate.RuntimePublicID == route.RuntimeID && candidate.State == "active" {
			copy := candidate
			member = &copy
			break
		}
	}
	if member == nil {
		client.close()
		return nil, &gatewayError{Code: "MEMBER_REMOVED"}
	}
	if !member.Connected {
		client.close()
		return nil, &gatewayError{Code: "MEMBER_OFFLINE", Retryable: true}
	}
	if len(catalog.Gateway.MemberEndpoints) == 0 {
		client.close()
		return nil, &gatewayError{Code: "GATEWAY_NO_ENDPOINTS"}
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(catalog.Gateway.MemberTLSRootPEM)) {
		client.close()
		return nil, ErrDenied
	}
	certificate, err := tls.X509KeyPair([]byte(route.Certificate), []byte(route.PrivateKey))
	if err != nil {
		client.close()
		return nil, err
	}
	network, proxy, err := newEndpointEgress(ctx, catalog.Gateway.MemberEndpoints)
	if err != nil {
		client.close()
		return nil, err
	}
	source := &connectorSource{client: client, route: route, version: member.MemberVersion}
	controller, err := flowersec.NewConnectionController(source, flowersec.ConnectionControllerOptions{Connector: flowersec.ConnectorOptions{HTTPSProxy: proxy, TrustRoots: roots, Origin: catalog.Gateway.MemberEndpoints[0].Address}, MaximumAttempts: 12})
	if err != nil {
		network.Close()
		client.close()
		return nil, err
	}
	life, cancel := context.WithCancel(ctx)
	owner := &connection{source: source, egress: network, controller: controller, ctx: life, cancel: cancel, certificate: certificate, device: device}
	controller.Start(life)
	context.AfterFunc(life, owner.Close)
	return owner, nil
}
func (c *connection) RoundTrip(request *http.Request) (*http.Response, error) {
	if c.ctx.Err() != nil {
		return nil, ErrDenied
	}
	ctx, cancel := context.WithTimeout(request.Context(), 20*time.Second)
	defer cancel()
	detach := context.AfterFunc(c.ctx, cancel)
	defer detach()
	session, err := c.controller.WaitForSession(ctx)
	if err != nil {
		return nil, err
	}
	// Refresh signed service identity before opening an HTTP connection. A valid
	// rotation replaces the pool, while rollback and identity changes fail closed.
	var service gp.MemberServiceResponse
	if err = c.source.client.request(ctx, "access/service", gp.MemberServiceRequest{ProtocolVersion: gp.Version, MemberID: c.source.route.MemberID, ExpectedMemberVersion: c.source.version}, &service, true); err != nil {
		return nil, err
	}
	if service.ProtocolVersion != gp.Version || service.MemberID != c.source.route.MemberID || service.MemberVersion != c.source.version || service.Delegation.GatewayID != c.source.client.record.GatewayID || service.Delegation.MemberID != c.source.route.MemberID || service.Delegation.RuntimePublicID != c.source.route.RuntimeID {
		return nil, ErrDenied
	}
	if err = gatewaymembership.VerifyMemberService(service.Service, service.Delegation, time.Now()); err != nil {
		return nil, ErrDenied
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, ErrDenied
	}
	c.source.mu.Lock()
	previous := c.source.offer.Service
	if service.Service.Revision < previous.Revision || service.Service.Revision == previous.Revision && service.Service.CertificateSHA256 != previous.CertificateSHA256 {
		c.source.mu.Unlock()
		c.mu.Unlock()
		return nil, ErrDenied
	}
	c.source.offer.Service = service.Service
	c.source.mu.Unlock()
	if c.transport == nil || c.session != session || c.fingerprint != service.Service.CertificateSHA256 {
		next, err := webconnector.New(c.ctx, webconnector.Options{Session: session, Service: service.Service, Delegation: service.Delegation, GatewayID: c.source.client.record.GatewayID, MemberID: c.source.route.MemberID, RuntimeID: c.source.route.RuntimeID, BrowserOrigin: c.source.route.Origin, DeviceReference: c.device, ClientCertificate: c.certificate})
		if err != nil {
			c.mu.Unlock()
			return nil, err
		}
		if c.transport != nil {
			c.transport.Close()
		}
		c.transport = next
		c.session = session
		c.fingerprint = service.Service.CertificateSHA256
	}
	transport := c.transport
	c.mu.Unlock()
	return transport.RoundTrip(request)
}
func (c *connection) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.cancel()
	if c.transport != nil {
		c.transport.Close()
	}
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.controller.Close(ctx)
	c.source.client.close()
	c.egress.Close()
}
func connectionCode(err error) string {
	var gateway *gatewayError
	if errors.As(err, &gateway) {
		if len(gateway.Code) > 0 && len(gateway.Code) <= 80 {
			valid := true
			for _, ch := range gateway.Code {
				if !(ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '_') {
					valid = false
					break
				}
			}
			if valid {
				return gateway.Code
			}
		}
	}
	if errors.Is(err, ErrDenied) {
		return ErrDenied.Error()
	}
	if errors.Is(err, ErrBusy) {
		return ErrBusy.Error()
	}
	if errors.Is(err, context.Canceled) {
		return "CENTER_OPERATION_CANCELED"
	}
	return "CENTER_CONNECTION_FAILED"
}
