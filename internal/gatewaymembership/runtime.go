package gatewaymembership

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"sort"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// RuntimeConfig is the sole local Gateway membership. Optional Cloud binding
// state must refer to this member instead of carrying a second Gateway route.
type RuntimeConfig struct {
	Revision         uint64               `json:"revision"`
	Leaving          bool                 `json:"leaving"`
	ProtocolVersion  string               `json:"protocol_version"`
	GatewayID        string               `json:"gateway_id"`
	GatewayEndpoints []gp.GatewayEndpoint `json:"gateway_endpoints,omitempty"`
	LastEndpointID   string               `json:"last_endpoint_id,omitempty"`
	// GatewayURL is read only during one-time v4 state migration.
	GatewayURL            string                `json:"gateway_url,omitempty"`
	GatewayPublicKey      string                `json:"gateway_public_key"`
	GatewayTLSRootPEM     string                `json:"gateway_tls_root_pem"`
	MemberID              string                `json:"member_id"`
	MemberVersion         int64                 `json:"member_version"`
	RuntimePublicID       string                `json:"runtime_public_id"`
	PrivateKeyB64u        string                `json:"private_key_b64u"`
	ClientPrivateKeyPEM   string                `json:"client_private_key_pem"`
	ClientCertificatePEM  string                `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS int64                 `json:"client_expires_at_unix_ms"`
	Service               gp.MemberService      `json:"service"`
	ServicePrivateKeyPEM  string                `json:"service_private_key_pem"`
	Delegation            gp.MemberDelegation   `json:"delegation"`
	PendingJoin           *gp.MemberJoinRequest `json:"pending_join,omitempty"`
	PendingRotation       *RuntimeRotation      `json:"pending_rotation,omitempty"`
	LastSpentChannelID    string                `json:"last_spent_channel_id,omitempty"`
}

type RuntimeRotation struct {
	Request              gp.MemberRotateRequest `json:"request"`
	ClientPrivateKeyPEM  string                 `json:"client_private_key_pem"`
	ServicePrivateKeyPEM string                 `json:"service_private_key_pem"`
}

func (RuntimeConfig) String() string     { return "Gateway.RuntimeMembership" }
func (RuntimeConfig) GoString() string   { return "Gateway.RuntimeMembership" }
func (RuntimeRotation) String() string   { return "Gateway.RuntimeRotation" }
func (RuntimeRotation) GoString() string { return "Gateway.RuntimeRotation" }

func (r *RuntimeConfig) Clone() *RuntimeConfig {
	if r == nil {
		return nil
	}
	next := *r
	next.GatewayEndpoints = append([]gp.GatewayEndpoint(nil), r.GatewayEndpoints...)
	if r.PendingJoin != nil {
		copy := *r.PendingJoin
		next.PendingJoin = &copy
	}
	if r.PendingRotation != nil {
		copy := *r.PendingRotation
		next.PendingRotation = &copy
	}
	return &next
}

func newClientCSR() (string, string, error) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	raw, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "Redeven Runtime member"}}, key)
	if err != nil {
		return "", "", err
	}
	private, err := keyPEM(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: raw})), private, err
}

// PrepareRuntime is invoked only after trusted local confirmation. Persist the
// returned state before Enroll so retries retain the same key and delivery ID.
func PrepareRuntime(invitation gp.MemberInvitation, runtimeID string, metadata gp.MemberMetadata) (*RuntimeConfig, error) {
	if err := VerifyInvitation(invitation, time.Now()); err != nil {
		return nil, err
	}
	if !validID(runtimeID) {
		return nil, ErrState
	}
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	publicB64 := base64.RawURLEncoding.EncodeToString(public)
	memberID := MemberID(invitation.InvitationID, publicB64)
	delegation := gp.MemberDelegation{ProtocolVersion: gp.Version, GatewayID: invitation.GatewayID, MemberID: memberID, RuntimePublicID: runtimeID, PublicKeyB64u: publicB64, InvitationID: invitation.InvitationID, ConsentedAtUnixMS: time.Now().UnixMilli(), ManageAccess: true, ManageCloudPublication: true}
	if err := SignDelegation(&delegation, key); err != nil {
		return nil, err
	}
	csr, clientKey, err := newClientCSR()
	if err != nil {
		return nil, err
	}
	service, serviceKey, err := NewServiceCertificate(runtimeID)
	if err != nil {
		return nil, err
	}
	if err := SignService(&service, delegation, key); err != nil {
		return nil, err
	}
	delivery, err := randomID("delivery_")
	if err != nil {
		return nil, err
	}
	request := gp.MemberJoinRequest{ProtocolVersion: gp.Version, InvitationID: invitation.InvitationID, Token: invitation.Token, DeliveryID: delivery, Delegation: delegation, ClientCSRPEM: csr, Service: service, Metadata: metadata}
	if err := SignJoin(&request, key); err != nil {
		return nil, err
	}
	return &RuntimeConfig{Revision: 1, ProtocolVersion: gp.Version, GatewayID: invitation.GatewayID, GatewayEndpoints: append([]gp.GatewayEndpoint(nil), invitation.Endpoints...), GatewayPublicKey: invitation.GatewayPublicKey, GatewayTLSRootPEM: invitation.GatewayTLSRootPEM, MemberID: memberID, RuntimePublicID: runtimeID, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), ClientPrivateKeyPEM: clientKey, Service: service, ServicePrivateKeyPEM: serviceKey, Delegation: delegation, PendingJoin: &request}, nil
}

// MigrateLegacyState converts one persisted v4 route into the v5 endpoint
// model without changing Gateway or Runtime identity. It runs only while
// loading durable Runtime configuration; new state never writes GatewayURL.
func (r *RuntimeConfig) MigrateLegacyState() bool {
	if r == nil {
		return false
	}
	changed := false
	if r.ProtocolVersion == "redeven-gateway-v4" {
		r.ProtocolVersion = gp.Version
		changed = true
	}
	if len(r.GatewayEndpoints) == 0 && validOrigin(r.GatewayURL) {
		r.GatewayEndpoints = []gp.GatewayEndpoint{{EndpointID: "endpoint_legacy", Address: r.GatewayURL, Scope: gp.GatewayEndpointLAN, Priority: 0}}
		changed = true
	}
	if r.GatewayURL != "" {
		r.GatewayURL = ""
		changed = true
	}
	return changed
}

func (r *RuntimeConfig) connectionEndpoints() []gp.GatewayEndpoint {
	if r == nil {
		return nil
	}
	if len(r.GatewayEndpoints) > 0 {
		return append([]gp.GatewayEndpoint(nil), r.GatewayEndpoints...)
	}
	return nil
}

func (r *RuntimeConfig) orderedEndpoints() []gp.GatewayEndpoint {
	endpoints := r.connectionEndpoints()
	sort.SliceStable(endpoints, func(left, right int) bool {
		if left == right {
			return false
		}
		if endpoints[left].EndpointID == r.LastEndpointID {
			return true
		}
		if endpoints[right].EndpointID == r.LastEndpointID {
			return false
		}
		if endpoints[left].Priority != endpoints[right].Priority {
			return endpoints[left].Priority < endpoints[right].Priority
		}
		return endpoints[left].EndpointID < endpoints[right].EndpointID
	})
	return endpoints
}

func (r *RuntimeConfig) ConnectionEndpoints() []gp.GatewayEndpoint {
	return r.orderedEndpoints()
}

func (r *RuntimeConfig) NewGatewayEndpointTransport(authenticated bool) (*http.Transport, error) {
	config, err := r.TLSConfig(authenticated)
	if err != nil {
		return nil, err
	}
	addresses := make([]string, 0, len(r.orderedEndpoints()))
	for _, endpoint := range r.orderedEndpoints() {
		addresses = append(addresses, endpoint.Address)
	}
	proxy, err := egress.NewHTTPSProxy(egress.HTTPSProxyOptions{URLs: addresses, TLSConfig: config})
	if err != nil {
		return nil, err
	}
	return proxy.HTTPTransport(), nil
}

// Validate checks durable identity without requiring the network or a currently
// usable credential. Expired access must not prevent local Runtime startup.
func (r *RuntimeConfig) Validate(runtimeID string) error {
	if r == nil || r.Revision == 0 || r.RuntimePublicID != runtimeID || r.Delegation.RuntimePublicID != runtimeID || r.Delegation.GatewayID != r.GatewayID || r.Delegation.MemberID != r.MemberID || VerifyDelegation(r.Delegation) != nil {
		return ErrState
	}
	if endpoints := r.connectionEndpoints(); len(endpoints) == 0 || validateGatewayEndpoints(endpoints) != nil {
		return ErrState
	}
	key, err := decodeKey(r.PrivateKeyB64u, ed25519.PrivateKeySize)
	if err != nil || base64.RawURLEncoding.EncodeToString(ed25519.PrivateKey(key).Public().(ed25519.PublicKey)) != r.Delegation.PublicKeyB64u {
		return ErrState
	}
	if _, err := r.TLSConfig(false); err != nil {
		return err
	}
	if _, err := decodeKey(r.GatewayPublicKey, ed25519.PublicKeySize); err != nil {
		return err
	}
	pair, err := tls.X509KeyPair([]byte(r.Service.CertificatePEM), []byte(r.ServicePrivateKeyPEM))
	if err != nil || pair.Leaf == nil || VerifyMemberService(r.Service, r.Delegation, pair.Leaf.NotBefore.Add(time.Second)) != nil {
		return ErrState
	}
	if r.PendingJoin != nil {
		if r.MemberVersion != 0 || r.PendingJoin.Delegation != r.Delegation || r.PendingJoin.Service != r.Service || r.PendingRotation != nil {
			return ErrState
		}
	} else if r.MemberVersion < 1 {
		return ErrState
	} else if _, err := tls.X509KeyPair([]byte(r.ClientCertificatePEM), []byte(r.ClientPrivateKeyPEM)); err != nil {
		return ErrState
	}
	return nil
}

func (r *RuntimeConfig) TLSConfig(authenticated bool) (*tls.Config, error) {
	if r == nil || r.ProtocolVersion != gp.Version || len(r.connectionEndpoints()) == 0 {
		return nil, ErrState
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(r.GatewayTLSRootPEM)) {
		return nil, ErrState
	}
	config := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}}
	if authenticated {
		certificate, err := tls.X509KeyPair([]byte(r.ClientCertificatePEM), []byte(r.ClientPrivateKeyPEM))
		if err != nil || certificate.Leaf == nil || !time.Now().Before(certificate.Leaf.NotAfter) {
			return nil, ErrDenied
		}
		config.Certificates = []tls.Certificate{certificate}
	}
	return config, nil
}

// Request only calls the enrolled Gateway. Environment proxy settings and HTTP
// redirects are excluded, and Gateway trust is isolated from system roots.
func (r *RuntimeConfig) Request(ctx context.Context, path string, body, out any, authenticated bool) error {
	endpoints := r.orderedEndpoints()
	if len(endpoints) == 0 {
		return ErrState
	}
	var last error
	for _, endpoint := range endpoints {
		err := r.requestEndpoint(ctx, endpoint, path, body, out, authenticated)
		if err == nil {
			r.LastEndpointID = endpoint.EndpointID
			return nil
		}
		last = err
		if !errors.Is(err, errGatewayUnavailable) {
			return err
		}
	}
	if last != nil {
		return last
	}
	return errors.New("GATEWAY_UNAVAILABLE")
}

var errGatewayUnavailable = errors.New("GATEWAY_UNAVAILABLE")

func (r *RuntimeConfig) requestEndpoint(ctx context.Context, endpoint gp.GatewayEndpoint, path string, body, out any, authenticated bool) error {
	config, err := r.TLSConfig(authenticated)
	if err != nil {
		return err
	}
	if connect, ok := body.(gp.MemberConnectRequest); ok {
		connect.Endpoint = endpoint
		body = connect
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSClientConfig: config, DisableKeepAlives: true, MaxResponseHeaderBytes: 16 << 10}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("gateway redirects are prohibited") }}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.Address+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return errGatewayUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return ErrDenied
		case http.StatusConflict:
			return ErrConflict
		case http.StatusTooManyRequests:
			return ErrCapacity
		default:
			return errGatewayUnavailable
		}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 128<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return ErrState
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ErrState
	}
	return nil
}

func (r *RuntimeConfig) Enroll(ctx context.Context, persist func(*RuntimeConfig) error) error {
	if r == nil || persist == nil {
		return ErrState
	}
	if r.PendingJoin == nil {
		_, err := r.TLSConfig(true)
		return err
	}
	var response gp.MemberJoinResponse
	if err := r.Request(ctx, "/v5/member/join", r.PendingJoin, &response, false); err != nil {
		return err
	}
	if response.ProtocolVersion != gp.Version || response.GatewayID != r.GatewayID || response.MemberID != r.MemberID || response.MemberVersion != 1 || response.DeliveryID != r.PendingJoin.DeliveryID {
		return ErrInvalidProof
	}
	next := r.Clone()
	next.MemberVersion, next.ClientCertificatePEM, next.ClientExpiresAtUnixMS = response.MemberVersion, response.ClientCertificatePEM, response.ClientExpiresAtUnixMS
	if err := next.validateClient(); err != nil {
		return err
	}
	next.PendingJoin = nil
	if err := persist(next); err != nil {
		return err
	}
	*r = *next
	return nil
}

func (r *RuntimeConfig) Leave(ctx context.Context) error {
	if r == nil || !r.Leaving {
		return ErrState
	}
	// Enrollment may have committed before its response was saved. The original
	// signed request can cancel that delivery without enrolling again.
	if r.PendingJoin != nil {
		var response gp.CatalogRequest
		return r.Request(ctx, "/v5/member/cancel-join", r.PendingJoin, &response, false)
	}
	var response gp.CatalogRequest
	return r.Request(ctx, "/v5/member/leave", gp.RemoveMemberRequest{ProtocolVersion: gp.Version, MemberID: r.MemberID, ExpectedMemberVersion: r.MemberVersion}, &response, true)
}

func (r *RuntimeConfig) validateClient() error {
	config, err := r.TLSConfig(true)
	if err != nil {
		return err
	}
	leaf := config.Certificates[0].Leaf
	if leaf.Subject.CommonName != r.MemberID || leaf.NotAfter.UnixMilli() != r.ClientExpiresAtUnixMS {
		return ErrInvalidProof
	}
	_, err = leaf.Verify(x509.VerifyOptions{Roots: config.RootCAs, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}})
	return err
}

func (r *RuntimeConfig) Rotate(ctx context.Context, persist func(*RuntimeConfig) error) error {
	if persist == nil || r == nil || r.PendingJoin != nil {
		return ErrState
	}
	if err := r.validateClient(); err != nil {
		return err
	}
	if r.PendingRotation == nil {
		key, err := decodeKey(r.PrivateKeyB64u, ed25519.PrivateKeySize)
		if err != nil {
			return err
		}
		csr, private, err := newClientCSR()
		if err != nil {
			return err
		}
		service, serviceKey, err := NewServiceCertificate(r.RuntimePublicID)
		if err != nil {
			return err
		}
		service.Revision = r.Service.Revision + 1
		if service.Revision < 1 {
			return ErrState
		}
		if err := SignService(&service, r.Delegation, ed25519.PrivateKey(key)); err != nil {
			return err
		}
		delivery, err := randomID("rotation_")
		if err != nil {
			return err
		}
		request := gp.MemberRotateRequest{ProtocolVersion: gp.Version, GatewayID: r.GatewayID, MemberID: r.MemberID, MemberVersion: r.MemberVersion, DeliveryID: delivery, ClientCSRPEM: csr, Service: service}
		if err := SignRotation(&request, ed25519.PrivateKey(key)); err != nil {
			return err
		}
		next := r.Clone()
		next.PendingRotation = &RuntimeRotation{Request: request, ClientPrivateKeyPEM: private, ServicePrivateKeyPEM: serviceKey}
		if err := persist(next); err != nil {
			return err
		}
		*r = *next
	}
	var response gp.MemberRotateResponse
	if err := r.Request(ctx, "/v5/member/rotate", r.PendingRotation.Request, &response, true); err != nil {
		return err
	}
	if response.ProtocolVersion != gp.Version || response.MemberID != r.MemberID || response.MemberVersion != r.MemberVersion || response.DeliveryID != r.PendingRotation.Request.DeliveryID {
		return ErrInvalidProof
	}
	next := r.Clone()
	next.ClientPrivateKeyPEM, next.ClientCertificatePEM, next.ClientExpiresAtUnixMS = next.PendingRotation.ClientPrivateKeyPEM, response.ClientCertificatePEM, response.ClientExpiresAtUnixMS
	next.Service, next.ServicePrivateKeyPEM = next.PendingRotation.Request.Service, next.PendingRotation.ServicePrivateKeyPEM
	next.PendingRotation = nil
	if err := next.validateClient(); err != nil {
		return err
	}
	if err := persist(next); err != nil {
		return err
	}
	*r = *next
	return nil
}
