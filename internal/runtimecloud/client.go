package runtimecloud

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

type Client struct {
	origin string
	http   *http.Client
}
type ProtocolError struct{ Message string }

func (e *ProtocolError) Error() string { return e.Message }

// Only temporary service or transport failures may retry. Invalid machine
// identity and protocol contracts require an explicit user action.
func Terminal(err error) bool {
	if DeliveryExpired(err) {
		return false
	}
	var protocol *ProtocolError
	if errors.As(err, &protocol) {
		return true
	}
	var remote *Error
	return errors.As(err, &remote) && remote.Status >= 400 && remote.Status < 500 && remote.Status != 408 && remote.Status != 429
}

// DeliveryExpired is a definitive result for this delivery ID. Unknown
// transport failures never permit rotating an idempotency ID.
func DeliveryExpired(err error) bool {
	var remote *Error
	return errors.As(err, &remote) && remote.Status == http.StatusGone && remote.Code == "DELIVERY_EXPIRED"
}

type Error struct {
	Code   string
	Status int
}

func (e *Error) Error() string { return "Runtime Cloud: " + e.Code }

func NewClient(origin string, transport http.RoundTripper) (*Client, error) {
	u, parseErr := url.Parse(origin)
	if parseErr != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || transport == nil {
		return nil, errors.New("runtime Cloud transport is missing")
	}
	return &Client{origin: origin, http: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Close() {
	if c != nil {
		c.http.CloseIdleConnections()
	}
}

func NewOperationID() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func call[In, Out any](c *Client, ctx context.Context, path string, input In) (*Out, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.origin+"/api/console/v1/runtime-cloud/v5/"+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return nil, &ProtocolError{Message: "Runtime Cloud response exceeds its bound"}
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    Out  `json:"data"`
		Error   *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return nil, &ProtocolError{Message: "Runtime Cloud response violates the protocol"}
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, &ProtocolError{Message: "Runtime Cloud response violates the protocol"}
	}
	if response.StatusCode != http.StatusOK || !envelope.Success {
		code := "SERVICE_UNAVAILABLE"
		if envelope.Error != nil {
			code = envelope.Error.Code
		}
		return nil, &Error{Code: code, Status: response.StatusCode}
	}
	return &envelope.Data, nil
}

func (c *Client) Sign(ctx context.Context, namespace, runtimeID, bindingID string, key ed25519.PrivateKey, purpose rc.Purpose, payload any) (rc.SignedRequest, error) {
	challenge, err := call[rc.ChallengeRequest, rc.ChallengeResponse](c, ctx, "challenges", rc.ChallengeRequest{ProtocolVersion: rc.ProtocolVersion, NamespacePublicID: namespace, RuntimePublicID: runtimeID, BindingPublicID: bindingID, Purpose: purpose})
	if err != nil {
		return rc.SignedRequest{}, err
	}
	proof := challenge.Proof
	if proof.ProtocolVersion != rc.ProtocolVersion || proof.CloudOrigin != c.origin || proof.NamespacePublicID != namespace || proof.RuntimePublicID != runtimeID || proof.BindingPublicID != bindingID || proof.Purpose != purpose || proof.ExpiresAtUnixMS <= time.Now().UnixMilli() || proof.ExpiresAtUnixMS > time.Now().Add(5*time.Minute).UnixMilli() {
		return rc.SignedRequest{}, &ProtocolError{Message: "Runtime Cloud challenge does not match its request"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return rc.SignedRequest{}, err
	}
	if err := proof.Sign(key, body); err != nil {
		return rc.SignedRequest{}, err
	}
	return rc.SignedRequest{Proof: proof, Payload: body}, nil
}

func (c *Client) Recover(ctx context.Context, namespace, runtimeID, bindingID string, key ed25519.PrivateKey, request rc.RecoverRequest) (*rc.RecoverResponse, error) {
	signed, err := c.Sign(ctx, namespace, runtimeID, bindingID, key, rc.PurposeRecover, request)
	if err != nil {
		return nil, err
	}
	result, err := call[rc.SignedRequest, rc.RecoverResponse](c, ctx, "recover", signed)
	if err == nil && (!result.Valid() || result.Binding != nil && (result.Binding.RuntimePublicID != runtimeID || result.Binding.NamespacePublicID != namespace || bindingID != "" && result.Binding.PublicID != bindingID)) {
		return nil, &ProtocolError{Message: "Runtime Cloud recovery violates the protocol"}
	}
	return result, err
}
func (c *Client) Enroll(ctx context.Context, namespace string, key, memberKey ed25519.PrivateKey, request rc.EnrollRequest) (*rc.RecoverResponse, error) {
	challenge, err := call[rc.ChallengeRequest, rc.ChallengeResponse](c, ctx, "challenges", rc.ChallengeRequest{ProtocolVersion: rc.ProtocolVersion, NamespacePublicID: namespace, RuntimePublicID: request.RuntimePublicID, Purpose: rc.PurposeEnroll})
	if err != nil {
		return nil, err
	}
	proof := challenge.Proof
	if proof.CloudOrigin != c.origin || proof.NamespacePublicID != namespace || proof.RuntimePublicID != request.RuntimePublicID || proof.Purpose != rc.PurposeEnroll || proof.ProtocolVersion != rc.ProtocolVersion || proof.BindingPublicID != "" || proof.ExpiresAtUnixMS <= time.Now().UnixMilli() || proof.ExpiresAtUnixMS > time.Now().Add(5*time.Minute).UnixMilli() {
		return nil, &ProtocolError{Message: "Runtime Cloud challenge does not match enrollment"}
	}
	if len(memberKey) > 0 {
		if err := rc.SignEnrollmentMembership(proof, &request, memberKey); err != nil {
			return nil, err
		}
	}
	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if err := proof.Sign(key, body); err != nil {
		return nil, err
	}
	result, err := call[rc.SignedRequest, rc.RecoverResponse](c, ctx, "enroll", rc.SignedRequest{Proof: proof, Payload: body})
	if err == nil && (!result.Valid() || result.Binding != nil && (result.Binding.RuntimePublicID != request.RuntimePublicID || result.Binding.NamespacePublicID != namespace || result.Binding.PublicKeyB64u != request.PublicKeyB64u)) {
		return nil, &ProtocolError{Message: "Runtime Cloud enrollment violates the protocol"}
	}
	return result, err
}

func (c *Client) Acknowledge(ctx context.Context, namespace, runtimeID string, key ed25519.PrivateKey, closure rc.ClosureAck) (*rc.Closure, error) {
	signed, err := c.Sign(ctx, namespace, runtimeID, closure.BindingPublicID, key, rc.PurposeClosureAck, closure)
	if err != nil {
		return nil, err
	}
	return call[rc.SignedRequest, rc.Closure](c, ctx, "closure-ack", signed)
}
