package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/runtimegateway/trust"
)

const maxClockSkew = 5 * time.Minute

type Verifier struct {
	mu    sync.Mutex
	seen  map[string]int64
	store *trust.Store
}

type VerifiedRequest struct {
	GatewayID       string
	ClientKeyID     string
	BindingAudience string
	Nonce           string
	TimestampUnixMS int64
}

func NewVerifier(store *trust.Store) *Verifier {
	return &Verifier{
		store: store,
		seen:  map[string]int64{},
	}
}

func (v *Verifier) Verify(ctx context.Context, r *http.Request, body []byte, bindingAudience string) (VerifiedRequest, error) {
	if err := ctx.Err(); err != nil {
		return VerifiedRequest{}, err
	}
	if v == nil || v.store == nil {
		return VerifiedRequest{}, errors.New("Gateway auth verifier is unavailable")
	}
	cleanAudience := strings.TrimSpace(bindingAudience)
	gatewayID := strings.TrimSpace(r.Header.Get("X-Redeven-Gateway-ID"))
	clientKeyID := strings.TrimSpace(r.Header.Get("X-Redeven-Client-Key-ID"))
	nonce := strings.TrimSpace(r.Header.Get("X-Redeven-Client-Nonce"))
	signature := strings.TrimSpace(r.Header.Get("X-Redeven-Request-Signature"))
	ts, err := parseTimestampMS(r.Header.Get("X-Redeven-Request-TS"))
	if err != nil || gatewayID == "" || clientKeyID == "" || nonce == "" || signature == "" {
		return VerifiedRequest{}, errors.New("Gateway authentication headers are incomplete")
	}
	metadata, _, err := v.store.GatewayMetadata(cleanAudience)
	if err != nil {
		return VerifiedRequest{}, err
	}
	if metadata.GatewayID != gatewayID {
		return VerifiedRequest{}, errors.New("Gateway authentication id does not match this runtime")
	}
	now := time.Now().UnixMilli()
	if ts < now-int64(maxClockSkew/time.Millisecond) || ts > now+int64(maxClockSkew/time.Millisecond) {
		return VerifiedRequest{}, errors.New("Gateway authentication timestamp is outside the accepted window")
	}
	publicKey, ok := v.store.ClientPublicKey(clientKeyID, cleanAudience)
	if !ok {
		return VerifiedRequest{}, errors.New("Gateway client is not paired")
	}
	if !v.consumeNonce(clientKeyID, nonce, ts, now) {
		return VerifiedRequest{}, errors.New("Gateway authentication nonce was already used")
	}
	bodyDigest, err := security.CanonicalJSONDigestFromBytes(body)
	if err != nil {
		return VerifiedRequest{}, errors.New("Gateway request body is not canonical JSON")
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  cleanAudience,
		"body_digest":       bodyDigest,
		"gateway_id":        gatewayID,
		"method":            strings.ToUpper(strings.TrimSpace(r.Method)),
		"nonce":             nonce,
		"protocol_version":  protocol.Version,
		"route":             strings.TrimSpace(r.URL.Path),
		"timestamp_unix_ms": ts,
	})
	if err != nil {
		return VerifiedRequest{}, err
	}
	if !security.VerifySignature(publicKey, payload, signature) {
		return VerifiedRequest{}, errors.New("Gateway request signature is invalid")
	}
	return VerifiedRequest{
		GatewayID:       gatewayID,
		ClientKeyID:     clientKeyID,
		BindingAudience: cleanAudience,
		Nonce:           nonce,
		TimestampUnixMS: ts,
	}, nil
}

func parseTimestampMS(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("timestamp is required")
	}
	out, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, err
	}
	if out <= 0 {
		return 0, errors.New("timestamp must be positive")
	}
	return out, nil
}

func (v *Verifier) consumeNonce(clientKeyID string, nonce string, ts int64, now int64) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.seen == nil {
		v.seen = map[string]int64{}
	}
	cutoff := now - int64(maxClockSkew/time.Millisecond)
	for key, seenTS := range v.seen {
		if seenTS < cutoff {
			delete(v.seen, key)
		}
	}
	key := strings.TrimSpace(clientKeyID) + ":" + strings.TrimSpace(nonce)
	if _, ok := v.seen[key]; ok {
		return false
	}
	v.seen[key] = ts
	return true
}
