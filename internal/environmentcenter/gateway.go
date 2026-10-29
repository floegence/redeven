package environmentcenter

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/webbinding"
)

type gatewayClient struct {
	record GatewayRecord
	http   *http.Client
}
type gatewayError struct {
	Code      string
	Retryable bool
}

func (e *gatewayError) Error() string { return e.Code }
func newGatewayClient(record GatewayRecord) *gatewayClient {
	// Gateway destinations are explicitly authorized by the sole administrator's
	// action-bound step-up grant (or the UID-authenticated Connector channel).
	// Private network Gateways are supported; redirects and proxies are denied.
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13}, MaxConnsPerHost: 4, MaxIdleConns: 4, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 15 * time.Second, MaxResponseHeaderBytes: 32 << 10}
	return &gatewayClient{record: record, http: &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrDenied }}}
}
func (g *gatewayClient) close() { g.http.CloseIdleConnections() }
func (g *gatewayClient) request(ctx context.Context, route string, body, out any, signed bool) error {
	switch route {
	case "identity", "pairing/challenge", "pairing/complete", "catalog", "access/open", "access/service":
	default:
		return ErrDenied
	}
	origin, err := webbinding.CanonicalOrigin(g.record.URL)
	if err != nil {
		return ErrDenied
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	if len(raw) > 64<<10 {
		return ErrDenied
	}
	path := "/gateway/v6/" + route
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Redeven-Gateway-Binding-Audience", g.record.URL)
	if signed {
		nonce := randomID()
		now := time.Now().UnixMilli()
		bodyDigest, err := security.CanonicalJSONDigestFromBytes(raw)
		if err != nil {
			return err
		}
		payload, err := security.CanonicalJSON(map[string]any{"binding_audience": g.record.URL, "body_digest": bodyDigest, "gateway_id": g.record.GatewayID, "method": "POST", "nonce": nonce, "protocol_version": gp.Version, "route": path, "timestamp_unix_ms": now})
		if err != nil {
			return err
		}
		signature, err := security.SignPayload(g.record.ClientPrivateKey, payload)
		if err != nil {
			return err
		}
		for k, v := range map[string]string{"X-Redeven-Gateway-ID": g.record.GatewayID, "X-Redeven-Client-Key-ID": g.record.ClientKeyID, "X-Redeven-Client-Nonce": nonce, "X-Redeven-Request-TS": strconv.FormatInt(now, 10), "X-Redeven-Request-Signature": signature} {
			req.Header.Set(k, v)
		}
	}
	response, err := g.http.Do(req)
	if err != nil {
		return &gatewayError{Code: "GATEWAY_UNREACHABLE", Retryable: true}
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return ErrDenied
	}
	var envelope struct {
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return &gatewayError{Code: "GATEWAY_INVALID_RESPONSE"}
	}
	if response.StatusCode != 200 || !envelope.OK {
		code := envelope.Error.Code
		if len(code) == 0 || len(code) > 80 {
			code = "GATEWAY_REQUEST_FAILED"
		}
		retry := response.StatusCode >= 500 || response.StatusCode == http.StatusTooManyRequests
		// Gateway commits can conflict with simultaneous transport admission.
		// Retry only its explicit transient codes; authorization remains terminal.
		if response.StatusCode == http.StatusConflict {
			switch code {
			case "MEMBER_VERSION_CONFLICT", "MEMBER_OFFLINE", "MEMBER_CAPACITY", "GATEWAY_UNAVAILABLE":
				retry = true
			}
		}
		return &gatewayError{Code: code, Retryable: retry}
	}
	return json.Unmarshal(envelope.Data, out)
}
func (g *gatewayClient) verify(ctx context.Context) error {
	nonce := randomID()
	var proof gp.IdentityResponse
	if err := g.request(ctx, "identity", gp.IdentityRequest{ProtocolVersion: gp.Version, Nonce: nonce}, &proof, true); err != nil {
		return err
	}
	if proof.ProtocolVersion != gp.Version || proof.CompatibilityEpoch != gp.CompatibilityEpoch || proof.BindingAudience != g.record.URL || proof.GatewayID != g.record.GatewayID || proof.Nonce != nonce || proof.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return ErrDenied
	}
	signature := proof.Signature
	proof.Signature = ""
	payload, err := security.CanonicalJSON(proof)
	if err != nil || !security.VerifySignature(g.record.PublicKey, payload, signature) {
		return ErrDenied
	}
	return nil
}
func (g *gatewayClient) catalog(ctx context.Context) (gp.CatalogResponse, error) {
	var catalog gp.CatalogResponse
	if err := g.verify(ctx); err != nil {
		return catalog, err
	}
	if err := g.request(ctx, "catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog, true); err != nil {
		return catalog, err
	}
	fingerprint, _ := security.PublicKeyFingerprint(g.record.PublicKey)
	if catalog.ProtocolVersion != gp.Version || catalog.Gateway.GatewayID != g.record.GatewayID || catalog.Gateway.GatewayPublicKeyFingerprint != fingerprint || !catalog.Gateway.Permissions.Access || catalog.Gateway.Permissions.ManageMembers || catalog.Gateway.Permissions.ConfigureCloud || len(catalog.Members) > gp.MaxMembers || len(catalog.Gateway.MemberEndpoints) > 16 || len(catalog.Gateway.MemberTLSRootPEM) > 16384 {
		return gp.CatalogResponse{}, ErrDenied
	}
	seen := map[string]bool{}
	for _, member := range catalog.Members {
		if member.MemberID == "" || member.RuntimePublicID == "" || member.MemberVersion < 1 || seen[member.MemberID] {
			return gp.CatalogResponse{}, ErrDenied
		}
		seen[member.MemberID] = true
	}
	for _, endpoint := range catalog.Gateway.MemberEndpoints {
		if webbinding.ValidateOrigin(endpoint.Address) != nil {
			return gp.CatalogResponse{}, ErrDenied
		}
	}
	return catalog, nil
}

type pendingPair struct {
	mu        sync.Mutex
	committed bool
	completed bool
	record    GatewayRecord
	material  gp.PairingChallengeRequest
	challenge gp.PairingChallengeResponse
	expires   time.Time
	session   string
}

func beginPair(ctx context.Context, address, name, accessCode, session string) (*pendingPair, error) {
	if webbinding.ValidateOrigin(address) != nil || len(name) > 120 || len(accessCode) > 128 {
		return nil, ErrDenied
	}
	keys, err := security.GenerateKeyPair()
	if err != nil {
		return nil, err
	}
	public := strings.TrimSpace(keys.PublicKeyPEM)
	record := GatewayRecord{ID: randomID(), Name: name, URL: address, ClientPrivateKey: keys.PrivateKeyPEM, ClientKeyID: security.ClientKeyID(public)}
	material := gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: randomID(), ClientPublicKey: public, BindingAudience: address, AccessCode: accessCode, ClientName: "Redeven Web Center"}
	g := newGatewayClient(record)
	defer g.close()
	var challenge gp.PairingChallengeResponse
	if err = g.request(ctx, "pairing/challenge", material, &challenge, false); err != nil {
		return nil, err
	}
	material.AccessCode = ""
	fingerprint, err := security.PublicKeyFingerprint(challenge.GatewayPublicKey)
	if err != nil || fingerprint != challenge.GatewayPublicKeyFingerprint || challenge.ProtocolVersion != gp.Version || challenge.CompatibilityEpoch != gp.CompatibilityEpoch || challenge.GatewayID == "" || challenge.GatewayNonce == "" || challenge.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return nil, ErrDenied
	}
	payload, err := security.CanonicalJSON(map[string]any{"protocol_version": gp.Version, "client_nonce": material.ClientNonce, "gateway_nonce": challenge.GatewayNonce, "gateway_id": challenge.GatewayID, "binding_audience": address, "client_public_key": public, "gateway_public_key": challenge.GatewayPublicKey, "expires_at_unix_ms": challenge.ExpiresAtUnixMS, "compatibility_epoch": challenge.CompatibilityEpoch})
	if err != nil || !security.VerifySignature(challenge.GatewayPublicKey, payload, challenge.Signature) {
		return nil, ErrDenied
	}
	record.GatewayID = challenge.GatewayID
	record.PublicKey = challenge.GatewayPublicKey
	return &pendingPair{record: record, material: material, challenge: challenge, expires: time.UnixMilli(challenge.ExpiresAtUnixMS), session: session}, nil
}
func (p *pendingPair) complete(ctx context.Context) (GatewayRecord, error) {
	if !time.Now().Before(p.expires) {
		return GatewayRecord{}, ErrExpired
	}
	req := gp.PairingCompleteRequest{ProtocolVersion: gp.Version, ClientNonce: p.material.ClientNonce, GatewayNonce: p.challenge.GatewayNonce, GatewayID: p.record.GatewayID, BindingAudience: p.record.URL, ClientKeyID: p.record.ClientKeyID}
	payload, err := security.CanonicalJSON(map[string]any{"protocol_version": req.ProtocolVersion, "client_nonce": req.ClientNonce, "gateway_nonce": req.GatewayNonce, "gateway_id": req.GatewayID, "binding_audience": req.BindingAudience, "client_key_id": req.ClientKeyID})
	if err != nil {
		return GatewayRecord{}, err
	}
	req.Proof, err = security.SignPayload(p.record.ClientPrivateKey, payload)
	if err != nil {
		return GatewayRecord{}, err
	}
	g := newGatewayClient(p.record)
	defer g.close()
	var response gp.PairingCompleteResponse
	if err = g.request(ctx, "pairing/complete", req, &response, false); err != nil {
		return GatewayRecord{}, err
	}
	if response.ProtocolVersion != gp.Version || response.GatewayID != p.record.GatewayID || response.ClientKeyID != p.record.ClientKeyID || !response.Permissions.Access || response.Permissions.ManageMembers || response.Permissions.ConfigureCloud || response.PairedAtUnixMS <= 0 {
		return GatewayRecord{}, ErrDenied
	}
	payload, err = security.CanonicalJSON(map[string]any{"protocol_version": response.ProtocolVersion, "client_nonce": req.ClientNonce, "gateway_nonce": req.GatewayNonce, "gateway_id": response.GatewayID, "binding_audience": req.BindingAudience, "client_key_id": response.ClientKeyID, "permissions": response.Permissions, "paired_at_unix_ms": response.PairedAtUnixMS})
	if err != nil || !security.VerifySignature(p.record.PublicKey, payload, response.Proof) {
		return GatewayRecord{}, ErrDenied
	}
	return p.record, nil
}
func (g *gatewayClient) offer(ctx context.Context, route Route, version int64) (gatewaymembership.ConnectionOffer, error) {
	var offer gatewaymembership.ConnectionOffer
	if err := g.request(ctx, "access/open", gp.OpenSessionRequest{ProtocolVersion: gp.Version, MemberID: route.MemberID}, &offer, true); err != nil {
		return offer, err
	}
	if offer.ProtocolVersion != gp.Version || offer.MemberID != route.MemberID || offer.MemberVersion != version || offer.Delegation.GatewayID != g.record.GatewayID || offer.Delegation.RuntimePublicID != route.RuntimeID || offer.Delegation.MemberID != route.MemberID || offer.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return offer, ErrDenied
	}
	if err := gatewaymembership.VerifyMemberService(offer.Service, offer.Delegation, time.Now()); err != nil {
		return offer, ErrDenied
	}
	return offer, nil
}
func retryable(err error) bool {
	var gateway *gatewayError
	return errors.As(err, &gateway) && gateway.Retryable
}
