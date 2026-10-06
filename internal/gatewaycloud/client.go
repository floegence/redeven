package gatewaycloud

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

var ErrCloudRequest = errors.New("Gateway Cloud request failed")

type CloudError struct{ Code string }

func (e *CloudError) Error() string { return "Gateway Cloud: " + e.Code }

type Client struct {
	origin string
	http   *http.Client
}

func NewClient(origin string, transport http.RoundTripper) (*Client, error) {
	if !gc.ValidOrigin(origin) || transport == nil {
		return nil, ErrCloudRequest
	}
	return &Client{origin: origin, http: &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Close releases idle sockets owned by a short-lived client.
func (c *Client) Close() {
	if c != nil && c.http != nil {
		c.http.CloseIdleConnections()
	}
}

func cloudCall[In, Out any](c *Client, ctx context.Context, path string, input In) (*Out, error) {
	return cloudCallPath[In, Out](c, ctx, "/api/console/v1/gateway-cloud/v2/"+path, input)
}

func cloudCallPath[In, Out any](c *Client, ctx context.Context, path string, input In) (*Out, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, ErrCloudRequest
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.origin+path, bytes.NewReader(body))
	if err != nil {
		return nil, ErrCloudRequest
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrCloudRequest
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return nil, ErrCloudRequest
	}
	var envelope gc.Response[Out]
	if json.Unmarshal(raw, &envelope) != nil {
		return nil, ErrCloudRequest
	}
	if response.StatusCode != http.StatusOK || !envelope.Success {
		if envelope.Error != nil && validErrorCode(envelope.Error.Code) {
			return nil, &CloudError{Code: envelope.Error.Code}
		}
		return nil, ErrCloudRequest
	}
	return &envelope.Data, nil
}

func validErrorCode(code string) bool {
	if code == "" || len(code) > 80 {
		return false
	}
	return strings.IndexFunc(code, func(r rune) bool { return (r < 'A' || r > 'Z') && r != '_' && (r < '0' || r > '9') }) < 0
}

type Identity struct {
	GatewayKey        ed25519.PrivateKey
	MemberKey         ed25519.PrivateKey
	PrivateKey        ed25519.PrivateKey
	NamespacePublicID string
	GatewayPublicID   string
	RuntimePublicID   string
	BindingPublicID   string
	BindingGeneration int64
}

func (i Identity) String() string   { return "GatewayCloud.Identity" }
func (i Identity) GoString() string { return i.String() }

func (c *Client) Sign(ctx context.Context, identity Identity, purpose gc.Purpose, payload any) (gc.SignedRequest, error) {
	challenge, err := cloudCall[gc.ChallengeRequest, gc.ChallengeResponse](c, ctx, "challenges", gc.ChallengeRequest{Purpose: purpose, GatewayPublicID: identity.GatewayPublicID, RuntimePublicID: identity.RuntimePublicID, BindingPublicID: identity.BindingPublicID})
	if err != nil {
		return gc.SignedRequest{}, err
	}
	proof := challenge.Proof
	if proof.ProtocolVersion != gc.ProtocolVersion || proof.CloudOrigin != c.origin || proof.Purpose != purpose || proof.GatewayPublicID != identity.GatewayPublicID || proof.RuntimePublicID != identity.RuntimePublicID || proof.BindingPublicID != identity.BindingPublicID || proof.ExpiresAtUnixMS <= time.Now().UnixMilli() || proof.ExpiresAtUnixMS > time.Now().Add(5*time.Minute).UnixMilli() {
		return gc.SignedRequest{}, ErrCloudRequest
	}
	proof.NamespacePublicID, proof.BindingGeneration = identity.NamespacePublicID, identity.BindingGeneration
	switch value := payload.(type) {
	case gc.GatewayRegistration:
		if err := gc.SignGatewayMachineIdentity(proof, &value, identity.GatewayKey); err != nil {
			return gc.SignedRequest{}, err
		}
		payload = value
	case gc.RuntimeJoin:
		if err := gc.SignRuntimeMembership(proof, &value, identity.MemberKey); err != nil {
			return gc.SignedRequest{}, err
		}
		payload = value
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return gc.SignedRequest{}, err
	}
	if err := proof.Sign(identity.PrivateKey, body); err != nil {
		return gc.SignedRequest{}, err
	}
	return gc.SignedRequest{Proof: proof, Payload: body}, nil
}

func signedCloudCall[In, Out any](c *Client, ctx context.Context, identity Identity, purpose gc.Purpose, path string, input In) (*Out, error) {
	signed, err := c.Sign(ctx, identity, purpose, input)
	if err != nil {
		return nil, err
	}
	return cloudCall[gc.SignedRequest, Out](c, ctx, path, signed)
}

func (c *Client) Register(ctx context.Context, identity Identity, request gc.GatewayRegistration) (*gc.Gateway, error) {
	return signedCloudCall[gc.GatewayRegistration, gc.Gateway](c, ctx, identity, gc.PurposeGatewayRegister, "register", request)
}
func (c *Client) GatewayStatus(ctx context.Context, identity Identity) (*gc.GatewayStatus, error) {
	return c.GatewayStatusPage(ctx, identity, "")
}

func (c *Client) GatewayStatusPage(ctx context.Context, identity Identity, after string) (*gc.GatewayStatus, error) {
	return signedCloudCall[gc.GatewayStatusRequest, gc.GatewayStatus](c, ctx, identity, gc.PurposeGatewayStatus, "gateway-status", gc.GatewayStatusRequest{ClosureAfter: after})
}
func (c *Client) Directory(ctx context.Context, identity Identity, request gc.DirectorySync) (*gc.Gateway, error) {
	return signedCloudCall[gc.DirectorySync, gc.Gateway](c, ctx, identity, gc.PurposeGatewaySync, "directory", request)
}
func (c *Client) Join(ctx context.Context, identity Identity, request gc.RuntimeJoin) (*gc.Candidate, error) {
	// A resumed join authenticates the enrollment, even when publication was
	// already persisted before a credential-delivery interruption.
	identity.BindingPublicID, identity.BindingGeneration = "", 0
	return signedCloudCall[gc.RuntimeJoin, gc.Candidate](c, ctx, identity, gc.PurposeRuntimeJoin, "join", request)
}
func (c *Client) RuntimeStatus(ctx context.Context, identity Identity, requestID string) (*gc.RuntimeStatus, error) {
	return c.RuntimeStatusPage(ctx, identity, requestID, "")
}

func (c *Client) RuntimeStatusPage(ctx context.Context, identity Identity, requestID, after string) (*gc.RuntimeStatus, error) {
	return signedCloudCall[gc.RuntimeStatusRequest, gc.RuntimeStatus](c, ctx, identity, gc.PurposeRuntimeStatus, "runtime-status", gc.RuntimeStatusRequest{RequestPublicID: requestID, ClosureAfter: after})
}
func (c *Client) Acknowledge(ctx context.Context, identity Identity, request gc.ClosureAck) (*gc.Closure, error) {
	return signedCloudCall[gc.ClosureAck, gc.Closure](c, ctx, identity, gc.PurposeClosureAck, "closure-ack", request)
}

func (c *Client) RotateKey(ctx context.Context, identity Identity, newKey ed25519.PrivateKey) error {
	if len(newKey) != ed25519.PrivateKeySize {
		return ErrState
	}
	challenge, err := c.Sign(ctx, identity, gc.PurposeIdentityRotate, gc.EmptyRequest{})
	if err != nil {
		return err
	}
	public := base64.RawURLEncoding.EncodeToString(newKey.Public().(ed25519.PublicKey))
	message, err := gc.RotationSigningBytes(challenge.Proof, public)
	if err != nil {
		return err
	}
	request := gc.RotateIdentity{NewPublicKeyB64u: public, NewKeyProofB64u: base64.RawURLEncoding.EncodeToString(ed25519.Sign(newKey, message))}
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	challenge.Payload = body
	if err := challenge.Proof.Sign(identity.PrivateKey, body); err != nil {
		return err
	}
	_, err = cloudCall[gc.SignedRequest, gc.EmptyRequest](c, ctx, "rotate-identity", challenge)
	return err
}

func (c *Client) CompleteCommand(ctx context.Context, identity Identity, result gc.GatewayCommandResult) error {
	_, err := signedCloudCall[gc.GatewayCommandResult, gc.EmptyRequest](c, ctx, identity, gc.PurposeCommandResult, "command-result", result)
	return err
}
