package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
)

func newEnrollmentFixture(t *testing.T) (*Gateway, *RuntimeConfig) {
	t.Helper()
	cfg := GatewayConfig{SchemaVersion: 1, ListenerURL: "https://127.0.0.1", GatewayPublicID: "gateway", NamespacePublicID: "namespace", Members: map[string]LocalMember{}}
	if err := createGatewayTLS(&cfg); err != nil {
		t.Fatal(err)
	}
	forwarding, err := gatewayegress.New(gatewayegress.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = forwarding.Close() })
	g := &Gateway{path: filepath.Join(t.TempDir(), "gateway.json"), config: cfg, egress: forwarding, status: &gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway", NamespacePublicID: "namespace", State: "active"}, JoinPermits: []gc.JoinPermit{{RequestPublicID: "request", TokenSHA256: digestBytes([]byte("enrollment-secret")), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}, EnrollmentDestinations: []string{"cloud.example:443"}}}
	material := gc.JoinMaterial{ProtocolVersion: gc.ProtocolVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", GatewayURL: cfg.ListenerURL, GatewayTLSRootPEM: cfg.RootPEM, GatewayPublicID: "gateway", NamespacePublicID: "namespace", RequestPublicID: "request", JoinToken: "cloud-secret", GatewayEnrollmentToken: "enrollment-secret", ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	runtime, err := PrepareRuntime(material, "runtime")
	if err != nil {
		t.Fatal(err)
	}
	return g, runtime
}

func TestEnrollmentSeparatesCloudIdentityAndResumesExactCertificate(t *testing.T) {
	g, r := newEnrollmentFixture(t)
	request := gc.LocalEnrollment{RequestPublicID: r.RequestPublicID, EnrollmentToken: r.EnrollmentToken, RuntimePublicID: r.RuntimePublicID, CSRPEM: r.ClientCSRPEM}
	first, err := g.enroll(request)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := g.enroll(request)
	if err != nil {
		t.Fatal(err)
	}
	if *first != *replay {
		t.Fatal("retry returned a different certificate")
	}
	r.ClientCertificatePEM = first.ClientCertificatePEM
	r.ClientExpiresAtUnixMS = first.ExpiresAtUnixMS
	if _, err := r.Proxy(); err != nil {
		t.Fatal(err)
	}
	changed := request
	changed.RuntimePublicID = "other"
	if _, err := g.enroll(changed); err == nil {
		t.Fatal("consumed token admitted another runtime")
	}
	changed = request
	changed.EnrollmentToken = r.JoinToken
	if _, err := g.enroll(changed); err == nil {
		t.Fatal("Cloud token accepted by Gateway")
	}
	identity, err := r.Identity()
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.X509KeyPair([]byte(r.ClientCertificatePEM), []byte(r.ClientPrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	if identity.PrivateKey.Equal(certificate.PrivateKey) {
		t.Fatal("Cloud access and mTLS shared a key")
	}
	r.Revoked = true
	if _, err := r.Proxy(); err == nil {
		t.Fatal("revoked route accepted")
	}
}

func TestLocalCertificateRenewalRequiresCurrentCertificateAndKeepsPendingStable(t *testing.T) {
	g, r := newEnrollmentFixture(t)
	first, err := g.enroll(gc.LocalEnrollment{RequestPublicID: r.RequestPublicID, EnrollmentToken: r.EnrollmentToken, RuntimePublicID: r.RuntimePublicID, CSRPEM: r.ClientCSRPEM})
	if err != nil {
		t.Fatal(err)
	}
	local := g.config.Members[r.RequestPublicID]
	g.status.Members = []gc.EgressMember{{RequestPublicID: r.RequestPublicID, RuntimePublicID: r.RuntimePublicID, ClientCertificateSHA256: local.Fingerprint, Generation: 1, Destinations: []string{"cloud.example:443"}}}
	server := httptest.NewUnstartedServer(g)
	roots, err := r.proxyTLS(false)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.X509KeyPair([]byte(g.config.ServerCertificatePEM), []byte(g.config.ServerKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	server.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, ClientCAs: roots.RootCAs, ClientAuth: tls.VerifyClientCertIfGiven, MinVersion: tls.VersionTLS13}
	server.StartTLS()
	defer server.Close()
	r.GatewayURL = server.URL
	r.ClientCertificatePEM = first.ClientCertificatePEM
	r.ClientExpiresAtUnixMS = first.ExpiresAtUnixMS
	cfg, err := r.proxyTLS(true)
	if err != nil {
		t.Fatal(err)
	}
	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = cfg
	defer transport.CloseIdleConnections()
	client, err := NewClient(server.URL, transport)
	if err != nil {
		t.Fatal(err)
	}
	_, replacement := newEnrollmentFixture(t)
	request := gc.LocalCertificateRenewal{RequestPublicID: r.RequestPublicID, CSRPEM: replacement.ClientCSRPEM}
	renewed, err := cloudCallPath[gc.LocalCertificateRenewal, gc.LocalEnrollmentResponse](client, context.Background(), "/gateway/cloud/v1/renew", request)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := cloudCallPath[gc.LocalCertificateRenewal, gc.LocalEnrollmentResponse](client, context.Background(), "/gateway/cloud/v1/renew", request)
	if err != nil {
		t.Fatal(err)
	}
	if *renewed != *replay || renewed.ClientCertificatePEM == first.ClientCertificatePEM {
		t.Fatal("replacement certificate was not durable and distinct")
	}
	if _, err := tls.X509KeyPair([]byte(renewed.ClientCertificatePEM), []byte(replacement.ClientPrivateKeyPEM)); err != nil {
		t.Fatal("renewed certificate did not use the staged private key", err)
	}
	if _, err := tls.X509KeyPair([]byte(renewed.ClientCertificatePEM), []byte(r.ClientPrivateKeyPEM)); err == nil {
		t.Fatal("renewed certificate still uses the old private key")
	}
	conflicting := gc.LocalCertificateRenewal{RequestPublicID: r.RequestPublicID, CSRPEM: r.ClientCSRPEM}
	if _, err := cloudCallPath[gc.LocalCertificateRenewal, gc.LocalEnrollmentResponse](client, context.Background(), "/gateway/cloud/v1/renew", conflicting); err == nil {
		t.Fatal("different CSR replaced a pending renewal")
	}
	var saved GatewayConfig
	if err := ReadState(g.path, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Members[r.RequestPublicID].PendingCertificatePEM != renewed.ClientCertificatePEM || saved.Members[r.RequestPublicID].PendingCSRHash == "" {
		t.Fatal("pending renewal cannot survive Gateway restart")
	}
	if g.config.Members[r.RequestPublicID].CertificatePEM != first.ClientCertificatePEM {
		t.Fatal("Gateway promoted a certificate without Cloud proof")
	}
	anonymous := server.Client().Transport.(*http.Transport).Clone()
	anonymous.TLSClientConfig = roots
	defer anonymous.CloseIdleConnections()
	unauthenticated, _ := NewClient(server.URL, anonymous)
	if _, err := cloudCallPath[gc.LocalCertificateRenewal, gc.LocalEnrollmentResponse](unauthenticated, context.Background(), "/gateway/cloud/v1/renew", request); err == nil {
		t.Fatal("unauthenticated renewal succeeded")
	}
}

func TestMachineRotationSigningContextIsNotReusable(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	proof := gc.Proof{ProtocolVersion: gc.ProtocolVersion, Purpose: gc.PurposeIdentityRotate, CloudOrigin: "https://cloud.example", NamespacePublicID: "namespace", GatewayPublicID: "gateway", ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	message, err := gc.RotationSigningBytes(proof, public)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(key, message)
	proof.NamespacePublicID = "other"
	other, err := gc.RotationSigningBytes(proof, public)
	if err != nil {
		t.Fatal(err)
	}
	if ed25519.Verify(key.Public().(ed25519.PublicKey), other, signature) {
		t.Fatal("rotation replayed across namespaces")
	}
}

func TestExpiredDeliveryRequiresAuthoritativeRejection(t *testing.T) {
	r := &RuntimeConfig{DeliveryRequestID: "same-request"}
	for _, err := range []error{nil, ErrCloudRequest, &CloudError{Code: "GATEWAY_BINDING_REJECTED"}} {
		if r.ForgetExpiredDelivery(err) || r.DeliveryRequestID != "same-request" {
			t.Fatal("ambiguous failure discarded the durable delivery request")
		}
	}
	if !r.ForgetExpiredDelivery(&CloudError{Code: "GATEWAY_DELIVERY_EXPIRED"}) || r.DeliveryRequestID != "" {
		t.Fatal("expired delivery was not retired")
	}
}

func TestRuntimeGatewayIdentityRejectsMismatchedBinding(t *testing.T) {
	_, runtime := newEnrollmentFixture(t)
	binding := gc.Binding{PublicID: "binding", EnvPublicID: "env", Region: "sg", NamespacePublicID: runtime.NamespacePublicID, GatewayPublicID: runtime.GatewayPublicID, RuntimePublicID: runtime.RuntimePublicID, Generation: 1, State: "active"}
	runtime.Binding = &binding
	if _, err := runtime.Identity(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*gc.Binding){
		func(b *gc.Binding) { b.NamespacePublicID = "other" },
		func(b *gc.Binding) { b.GatewayPublicID = "other" },
		func(b *gc.Binding) { b.RuntimePublicID = "other" },
		func(b *gc.Binding) { b.Generation = 0 },
		func(b *gc.Binding) { b.State = "revoked" },
		func(b *gc.Binding) { b.EnvPublicID = "" },
	} {
		changed := binding
		mutate(&changed)
		runtime.Binding = &changed
		if _, err := runtime.Identity(); err == nil {
			t.Fatalf("accepted inconsistent binding: %+v", changed)
		}
	}
}

func TestGatewayPruningRetainsEnrollmentAndReceiptPaths(t *testing.T) {
	cfg := GatewayConfig{Members: map[string]LocalMember{"active": {}, "joining": {}, "receipt": {}, "retired": {}}}
	pruneGatewayMembers(&cfg, &gc.GatewayStatus{
		Members:           []gc.EgressMember{{RequestPublicID: "active"}},
		ManagementMembers: []gc.EgressMember{{RequestPublicID: "receipt"}},
		JoinPermits:       []gc.JoinPermit{{RequestPublicID: "joining"}},
	})
	if len(cfg.Members) != 3 {
		t.Fatal("complete policy pruned a retained member")
	}
	if _, ok := cfg.Members["retired"]; ok {
		t.Fatal("retired membership still consumes capacity")
	}
}
