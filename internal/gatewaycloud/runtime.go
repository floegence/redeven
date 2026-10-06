package gatewaycloud

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
	"net/http"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

// RuntimeConfig is the locally consented path. No other profile enables it.
type RuntimeConfig struct {
	NewEnvironment                    bool           `json:"new_environment,omitempty"`
	PendingClientPrivateKeyPEM        string         `json:"pending_client_private_key_pem,omitempty"`
	PendingClientCSRPEM               string         `json:"pending_client_csr_pem,omitempty"`
	PendingGenerationRenewal          bool           `json:"pending_generation_renewal,omitempty"`
	PendingPrivateKeyB64u             string         `json:"pending_private_key_b64u,omitempty"`
	KeyRotatedAtUnixMS                int64          `json:"key_rotated_at_unix_ms"`
	PreviousPath                      *RuntimeConfig `json:"previous_path,omitempty"`
	PendingCertificatePEM             string         `json:"pending_certificate_pem,omitempty"`
	PendingCertificateExpiresAtUnixMS int64          `json:"pending_certificate_expires_at_unix_ms,omitempty"`
	ProtocolVersion                   int            `json:"protocol_version"`
	CloudOrigin                       string         `json:"cloud_origin"`
	RegionOrigin                      string         `json:"region_origin"`
	NamespacePublicID                 string         `json:"namespace_public_id"`
	GatewayPublicID                   string         `json:"gateway_public_id"`
	RequestPublicID                   string         `json:"request_public_id"`
	RuntimePublicID                   string         `json:"runtime_public_id"`
	GatewayURL                        string         `json:"gateway_url"`
	GatewayTLSRootPEM                 string         `json:"gateway_tls_root_pem"`
	PrivateKeyB64u                    string         `json:"private_key_b64u"`
	ClientPrivateKeyPEM               string         `json:"client_private_key_pem"`
	ClientCSRPEM                      string         `json:"client_csr_pem,omitempty"`
	ClientCertificatePEM              string         `json:"client_certificate_pem"`
	ClientExpiresAtUnixMS             int64          `json:"client_expires_at_unix_ms"`
	LocalConsentAtUnixMS              int64          `json:"local_consent_at_unix_ms"`
	Binding                           *gc.Binding    `json:"binding,omitempty"`
	DeliveryRequestID                 string         `json:"delivery_request_id,omitempty"`
	JoinToken                         string         `json:"join_token,omitempty"`
	EnrollmentToken                   string         `json:"enrollment_token,omitempty"`
	Revoked                           bool           `json:"revoked"`
}

func (RuntimeConfig) String() string   { return "GatewayCloud.RuntimeConfig" }
func (RuntimeConfig) GoString() string { return "GatewayCloud.RuntimeConfig" }

// Clone separates mutable binding and previous-path state from readers.
func (r *RuntimeConfig) Clone() *RuntimeConfig {
	if r == nil {
		return nil
	}
	next := *r
	if r.Binding != nil {
		binding := *r.Binding
		next.Binding = &binding
	}
	next.PreviousPath = r.PreviousPath.Clone()
	return &next
}

func PrepareRuntime(material gc.JoinMaterial, runtimeID string) (*RuntimeConfig, error) {
	if material.ProtocolVersion != gc.ProtocolVersion || !gc.ValidOrigin(material.CloudOrigin) || !gc.ValidOrigin(material.RegionOrigin) || !gc.ValidOrigin(material.GatewayURL) || material.GatewayPublicID == "" || material.NamespacePublicID == "" || material.RequestPublicID == "" || runtimeID == "" || material.JoinToken == "" || material.GatewayEnrollmentToken == "" || material.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return nil, ErrState
	}
	_, identity, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	_, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	keyPEM, err := privateKeyPEM(clientKey)
	if err != nil {
		return nil, err
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: runtimeID}}, clientKey)
	if err != nil {
		return nil, err
	}
	result := &RuntimeConfig{KeyRotatedAtUnixMS: time.Now().UnixMilli(), ProtocolVersion: gc.ProtocolVersion, CloudOrigin: material.CloudOrigin, RegionOrigin: material.RegionOrigin, NamespacePublicID: material.NamespacePublicID, GatewayPublicID: material.GatewayPublicID, RequestPublicID: material.RequestPublicID, RuntimePublicID: runtimeID, GatewayURL: material.GatewayURL, GatewayTLSRootPEM: material.GatewayTLSRootPEM, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(identity), ClientPrivateKeyPEM: keyPEM, ClientCSRPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr})), LocalConsentAtUnixMS: time.Now().UnixMilli(), JoinToken: material.JoinToken, EnrollmentToken: material.GatewayEnrollmentToken}
	if _, err := result.proxyTLS(false); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *RuntimeConfig) Identity() (Identity, error) {
	if r == nil || r.ProtocolVersion != gc.ProtocolVersion || r.LocalConsentAtUnixMS <= 0 || !gc.ValidOrigin(r.CloudOrigin) || !gc.ValidOrigin(r.RegionOrigin) || r.NamespacePublicID == "" || r.GatewayPublicID == "" || r.RuntimePublicID == "" || r.RequestPublicID == "" {
		return Identity{}, ErrState
	}
	key, err := gc.DecodeKey(r.PrivateKeyB64u)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return Identity{}, ErrState
	}
	id := Identity{PrivateKey: ed25519.PrivateKey(key), NamespacePublicID: r.NamespacePublicID, GatewayPublicID: r.GatewayPublicID, RuntimePublicID: r.RuntimePublicID}
	if r.Binding != nil {
		b := r.Binding
		if b.PublicID == "" || b.EnvPublicID == "" || b.Region == "" || b.Generation <= 0 || b.State != "active" || b.NamespacePublicID != r.NamespacePublicID || b.GatewayPublicID != r.GatewayPublicID || b.RuntimePublicID != r.RuntimePublicID {
			return Identity{}, ErrState
		}
		id.BindingPublicID = r.Binding.PublicID
		id.BindingGeneration = r.Binding.Generation
	}
	return id, nil
}

func (r *RuntimeConfig) Fence() *gc.BindingFence {
	if r == nil || r.Binding == nil {
		return nil
	}
	b := r.Binding
	return &gc.BindingFence{ProtocolVersion: gc.ProtocolVersion, PublicID: b.PublicID, NamespacePublicID: b.NamespacePublicID, GatewayPublicID: b.GatewayPublicID, RuntimePublicID: b.RuntimePublicID, Generation: b.Generation}
}

func (r *RuntimeConfig) proxyTLS(requireClient bool) (*tls.Config, error) {
	if r == nil || !gc.ValidOrigin(r.GatewayURL) {
		return nil, ErrState
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(r.GatewayTLSRootPEM)) {
		return nil, ErrState
	}
	cfg := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}
	if requireClient {
		cert, err := tls.X509KeyPair([]byte(r.ClientCertificatePEM), []byte(r.ClientPrivateKeyPEM))
		if err != nil {
			return nil, ErrState
		}
		leaf, err := x509.ParseCertificate(cert.Certificate[0])
		if err != nil || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
			return nil, ErrState
		}
		cfg.Certificates = []tls.Certificate{cert}
	}
	return cfg, nil
}

func (r *RuntimeConfig) Proxy() (*egress.HTTPSProxy, error) {
	if _, err := r.Identity(); err != nil {
		return nil, err
	}
	if r.Revoked {
		return nil, ErrState
	}
	cfg, err := r.proxyTLS(true)
	if err != nil {
		return nil, err
	}
	return egress.NewHTTPSProxy(egress.HTTPSProxyOptions{URL: r.GatewayURL, TLSConfig: cfg, ConnectTimeout: 15 * time.Second})
}

func (r *RuntimeConfig) Client() (*Client, error) {
	p, err := r.Proxy()
	if err != nil {
		return nil, err
	}
	return NewClient(r.CloudOrigin, p.HTTPTransport())
}

// Enroll sends only the Gateway enrollment token. The Cloud token stays inside inner TLS.
func (r *RuntimeConfig) Enroll(ctx context.Context) error {
	tlsConfig, err := r.proxyTLS(false)
	if err != nil {
		return err
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 15 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	body, err := json.Marshal(gc.LocalEnrollment{RequestPublicID: r.RequestPublicID, EnrollmentToken: r.EnrollmentToken, RuntimePublicID: r.RuntimePublicID, CSRPEM: r.ClientCSRPEM})
	if err != nil {
		return ErrState
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.GatewayURL+"/gateway/cloud/v1/enroll", bytes.NewReader(body))
	if err != nil {
		return ErrState
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return ErrCloudRequest
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<10))
	if err != nil {
		return ErrCloudRequest
	}
	var result gc.Response[gc.LocalEnrollmentResponse]
	if resp.StatusCode != 200 || json.Unmarshal(raw, &result) != nil || !result.Success {
		return ErrCloudRequest
	}
	r.ClientCertificatePEM = result.Data.ClientCertificatePEM
	r.ClientExpiresAtUnixMS = result.Data.ExpiresAtUnixMS
	if _, err := r.proxyTLS(true); err != nil {
		r.ClientCertificatePEM = ""
		return err
	}
	return nil
}

func (r *RuntimeConfig) Join(ctx context.Context, metadata gc.RuntimeMetadata) (*gc.Candidate, error) {
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	client, err := r.Client()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	block, _ := pem.Decode([]byte(r.ClientCertificatePEM))
	if block == nil {
		return nil, ErrState
	}
	// Enrollment proof is deliberately separate from both public health identity and mTLS.
	return client.Join(ctx, identity, gc.RuntimeJoin{NewEnvironment: r.NewEnvironment, RequestPublicID: r.RequestPublicID, JoinToken: r.JoinToken, RuntimePublicID: r.RuntimePublicID, PublicKeyB64u: base64.RawURLEncoding.EncodeToString(identity.PrivateKey.Public().(ed25519.PublicKey)), ClientCertificateSHA256: digestBytes(block.Bytes), LocalConsent: true, Metadata: metadata})
}

func (r *RuntimeConfig) Status(ctx context.Context) (*gc.RuntimeStatus, error) {
	return r.StatusPage(ctx, "")
}

func (r *RuntimeConfig) StatusPage(ctx context.Context, after string) (*gc.RuntimeStatus, error) {
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	client, err := r.Client()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	// Status follows the locally enrolled identity even while the canonical binding changes.
	identity.BindingPublicID = ""
	identity.BindingGeneration = 0
	return client.RuntimeStatusPage(ctx, identity, r.RequestPublicID, after)
}

type CredentialDelivery struct {
	ProtocolVersion     int             `json:"protocol_version"`
	CloudOrigin         string          `json:"cloud_origin"`
	RegionOrigin        string          `json:"region_origin"`
	Binding             gc.Binding      `json:"binding"`
	DeliveryRequestID   string          `json:"delivery_request_id"`
	ControlArtifactPool json.RawMessage `json:"control_artifact_pool"`
}

func NewDeliveryID() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (r *RuntimeConfig) Recover(ctx context.Context) (*CredentialDelivery, error) {
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	fence := r.Fence()
	if fence == nil || !fence.Valid() || r.DeliveryRequestID == "" {
		return nil, ErrState
	}
	proxy, err := r.Proxy()
	if err != nil {
		return nil, err
	}
	transport := proxy.HTTPTransport()
	defer transport.CloseIdleConnections()
	client, err := NewClient(r.CloudOrigin, transport)
	if err != nil {
		return nil, err
	}
	signed, err := client.Sign(ctx, identity, gc.PurposeRuntimeRecover, gc.RecoverRequest{Binding: *fence, DeliveryRequestID: r.DeliveryRequestID})
	if err != nil {
		return nil, err
	}
	region, err := NewClient(r.RegionOrigin, transport)
	if err != nil {
		return nil, err
	}
	delivery, err := cloudCallPath[gc.SignedRequest, CredentialDelivery](region, ctx, "/api/gateway-cloud/v1/credentials", signed)
	if err != nil {
		return nil, err
	}
	if delivery.ProtocolVersion != gc.ProtocolVersion || delivery.CloudOrigin != r.CloudOrigin || delivery.RegionOrigin != r.RegionOrigin || delivery.DeliveryRequestID != r.DeliveryRequestID || delivery.Binding != *r.Binding {
		return nil, errors.New("Gateway credential binding mismatch")
	}
	return delivery, nil
}

// RenewCertificate persists the replacement before promoting Cloud policy. A
// lost response resumes using the same replacement certificate and proof key.
func (r *RuntimeConfig) RenewCertificate(ctx context.Context, persist func(*RuntimeConfig) error) error {
	if r == nil || r.Revoked || persist == nil {
		return ErrState
	}
	if r.PendingClientPrivateKeyPEM == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		keyPEM, err := privateKeyPEM(key)
		if err != nil {
			return err
		}
		csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: r.RuntimePublicID}}, key)
		if err != nil {
			return err
		}
		r.PendingClientPrivateKeyPEM, r.PendingClientCSRPEM = keyPEM, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))
		if err := persist(r); err != nil {
			return err
		}
	}
	if r.PendingCertificatePEM == "" {
		tlsConfig, err := r.proxyTLS(true)
		if err != nil {
			return err
		}
		transport := &http.Transport{TLSClientConfig: tlsConfig, TLSHandshakeTimeout: 10 * time.Second}
		defer transport.CloseIdleConnections()
		client, err := NewClient(r.GatewayURL, transport)
		if err != nil {
			return err
		}
		issued, err := cloudCallPath[gc.LocalCertificateRenewal, gc.LocalEnrollmentResponse](client, ctx, "/gateway/cloud/v1/renew", gc.LocalCertificateRenewal{RequestPublicID: r.RequestPublicID, CSRPEM: r.PendingClientCSRPEM})
		if err != nil {
			return err
		}
		r.PendingCertificatePEM = issued.ClientCertificatePEM
		r.PendingCertificateExpiresAtUnixMS = issued.ExpiresAtUnixMS
		next := *r
		next.ClientCertificatePEM = issued.ClientCertificatePEM
		next.ClientPrivateKeyPEM = r.PendingClientPrivateKeyPEM
		if _, err := next.proxyTLS(true); err != nil {
			return err
		}
		if err := persist(r); err != nil {
			return err
		}
	}
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	old, _ := pem.Decode([]byte(r.ClientCertificatePEM))
	next, _ := pem.Decode([]byte(r.PendingCertificatePEM))
	if old == nil || next == nil {
		return ErrState
	}
	request := gc.CertificateRotation{RequestPublicID: r.RequestPublicID, PreviousCertificateSHA256: digestBytes(old.Bytes), ClientCertificateSHA256: digestBytes(next.Bytes)}
	client, err := r.Client()
	if err == nil {
		defer client.Close()
		_, err = signedCloudCall[gc.CertificateRotation, gc.EmptyRequest](client, ctx, identity, gc.PurposeCertificateRotate, "rotate-certificate", request)
	}
	if err != nil {
		// Only the explicitly staged new credential is retried after a lost commit response.
		staged := *r
		staged.ClientCertificatePEM = r.PendingCertificatePEM
		staged.ClientPrivateKeyPEM = r.PendingClientPrivateKeyPEM
		staged.ClientExpiresAtUnixMS = r.PendingCertificateExpiresAtUnixMS
		client, err = staged.Client()
		if err != nil {
			return err
		}
		defer client.Close()
		if _, err = signedCloudCall[gc.CertificateRotation, gc.EmptyRequest](client, ctx, identity, gc.PurposeCertificateRotate, "rotate-certificate", request); err != nil {
			return err
		}
	}
	r.ClientCertificatePEM = r.PendingCertificatePEM
	r.ClientPrivateKeyPEM, r.ClientCSRPEM = r.PendingClientPrivateKeyPEM, r.PendingClientCSRPEM
	r.PendingClientPrivateKeyPEM, r.PendingClientCSRPEM = "", ""
	r.ClientExpiresAtUnixMS = r.PendingCertificateExpiresAtUnixMS
	r.PendingCertificatePEM = ""
	r.PendingCertificateExpiresAtUnixMS = 0
	return persist(r)
}

// ForgetExpiredDelivery changes the idempotency key only after the authority
// explicitly rejects its replay. Network failures must retain the same key.
func (r *RuntimeConfig) ForgetExpiredDelivery(err error) bool {
	var cloud *CloudError
	if r == nil || !errors.As(err, &cloud) || cloud.Code != "GATEWAY_DELIVERY_EXPIRED" {
		return false
	}
	r.DeliveryRequestID = ""
	return true
}

// ConsentMigration sends the old path proof through the new path. Losing the
// old Gateway does not invalidate the Runtime's independently held identity.
func (r *RuntimeConfig) ConsentMigration(ctx context.Context, target *RuntimeConfig) error {
	return r.consentPathChange(ctx, target, false)
}

// ConsentReauthorization proves ownership through the new route without
// restoring the removed membership or using its forwarding credentials.
func (r *RuntimeConfig) ConsentReauthorization(ctx context.Context, target *RuntimeConfig) error {
	return r.consentPathChange(ctx, target, true)
}

func (r *RuntimeConfig) consentPathChange(ctx context.Context, target *RuntimeConfig, reauthorize bool) error {
	if r == nil || target == nil || (!reauthorize && r.Revoked) || r.Fence() == nil || r.CloudOrigin != target.CloudOrigin || r.NamespacePublicID != target.NamespacePublicID || r.RegionOrigin != target.RegionOrigin || r.RuntimePublicID != target.RuntimePublicID || (!reauthorize && r.GatewayPublicID == target.GatewayPublicID) || r.RequestPublicID == target.RequestPublicID {
		return ErrState
	}
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	client, err := target.Client()
	if err != nil {
		return err
	}
	defer client.Close()
	purpose := gc.PurposeRuntimeMigrate
	if reauthorize {
		purpose = gc.PurposeRuntimeReauthorize
	}
	_, err = signedCloudCall[gc.MigrationConsent, gc.Candidate](client, ctx, identity, purpose, "migration-consent", gc.MigrationConsent{Current: *r.Fence(), TargetRequestPublicID: target.RequestPublicID, Reauthorize: reauthorize})
	return err
}

// AcknowledgePreviousPath runs after the old Runtime process has stopped. The
// target route carries acknowledgements only; the old identity cannot recover.
func (r *RuntimeConfig) AcknowledgePreviousPath(ctx context.Context) error {
	if r == nil || r.PreviousPath == nil {
		return nil
	}
	old := r.PreviousPath
	identity, err := old.Identity()
	if err != nil {
		return err
	}
	client, err := r.Client()
	if err != nil {
		return err
	}
	defer client.Close()
	identity.BindingPublicID = ""
	identity.BindingGeneration = 0
	after := ""
	for {
		identity.BindingPublicID, identity.BindingGeneration = "", 0
		status, err := client.RuntimeStatusPage(ctx, identity, old.RequestPublicID, after)
		if err != nil {
			return err
		}
		for _, closure := range status.Closures {
			if old.Binding == nil || closure.BindingPublicID != old.Binding.PublicID || closure.GatewayPublicID != old.GatewayPublicID || closure.RuntimePublicID != old.RuntimePublicID || closure.Generation > old.Binding.Generation {
				continue
			}
			identity.BindingPublicID, identity.BindingGeneration = closure.BindingPublicID, closure.Generation
			if _, err := client.Acknowledge(ctx, identity, gc.ClosureAck{ClosurePublicID: closure.PublicID, Generation: closure.Generation, Side: "runtime"}); err != nil {
				return err
			}
		}
		if status.NextClosureCursor == "" {
			break
		}
		if status.NextClosureCursor == after {
			return ErrCloudRequest
		}
		after = status.NextClosureCursor
	}
	return nil
}

// RotateIdentity stages the next private key before submitting either proof.
// A lost response is resolved by testing only that staged key against Cloud.
func (r *RuntimeConfig) RotateIdentity(ctx context.Context, persist func(*RuntimeConfig) error) error {
	if r == nil || r.Revoked || r.Binding == nil || persist == nil {
		return ErrState
	}
	if r.PendingPrivateKeyB64u == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		r.PendingPrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
		if err := persist(r); err != nil {
			return err
		}
	}
	encoded := r.PendingPrivateKeyB64u
	pending, err := gc.DecodeKey(encoded)
	if err != nil || len(pending) != ed25519.PrivateKeySize {
		return ErrState
	}
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	client, err := r.Client()
	if err != nil {
		return err
	}
	defer client.Close()
	if err := client.RotateKey(ctx, identity, ed25519.PrivateKey(pending)); err != nil {
		next := *r
		next.PrivateKeyB64u = encoded
		if _, statusErr := next.Status(ctx); statusErr != nil {
			return err
		}
	}
	r.PrivateKeyB64u = encoded
	r.PendingPrivateKeyB64u = ""
	r.KeyRotatedAtUnixMS = time.Now().UnixMilli()
	return persist(r)
}

// RenewGeneration advances only an exhausted, still-authorized binding. The
// old fence remains durable until the exact new generation is accepted locally.
func (r *RuntimeConfig) RenewGeneration(ctx context.Context) (*gc.Binding, error) {
	identity, err := r.Identity()
	if err != nil || r.Binding == nil || r.Revoked {
		return nil, ErrState
	}
	client, err := r.Client()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	binding, err := signedCloudCall[gc.GenerationRenewal, gc.Binding](client, ctx, identity, gc.PurposeGenerationRenew, "renew-generation", gc.GenerationRenewal{Current: *r.Fence()})
	if err != nil {
		return nil, err
	}
	expected := *r.Binding
	if expected.Generation >= 1<<63-1 {
		return nil, ErrState
	}
	expected.Generation++
	if *binding != expected {
		return nil, ErrState
	}
	return binding, nil
}
