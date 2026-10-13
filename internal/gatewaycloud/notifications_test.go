package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func notificationTestServer(t *testing.T, stream http.HandlerFunc) (*httptest.Server, Identity, *atomic.Int64) {
	t.Helper()
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	identity := Identity{PrivateKey: key, GatewayPublicID: "gateway", NamespacePublicID: "namespace"}
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	challenges := &atomic.Int64{}
	var origin string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/challenges") {
			challenges.Add(1)
			var request gc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil || request.Purpose != gc.PurposeGatewayNotify {
				t.Error("unexpected challenge")
				w.WriteHeader(400)
				return
			}
			proof := gc.Proof{ProtocolVersion: gc.ProtocolVersion, Purpose: request.Purpose, CloudOrigin: origin, GatewayPublicID: identity.GatewayPublicID, ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.ChallengeResponse]{Success: true, Data: gc.ChallengeResponse{Proof: proof}})
			return
		}
		var signed gc.SignedRequest
		if json.NewDecoder(r.Body).Decode(&signed) != nil || signed.Proof.Verify(public, signed.Payload, time.Now()) != nil {
			t.Error("notification has no valid machine proof")
			w.WriteHeader(401)
			return
		}
		stream(w, r)
	}))
	origin = server.URL
	t.Cleanup(server.Close)
	return server, identity, challenges
}

func TestGatewayHTTPSNotificationsCancelWithoutAnotherChallenge(t *testing.T) {
	applied := make(chan struct{}, 1)
	exited := make(chan struct{})
	server, identity, challenges := notificationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		defer close(exited)
		w.Header().Set("Content-Type", "application/x-ndjson")
		encoder := json.NewEncoder(w)
		_ = encoder.Encode(gc.Notification{ProtocolVersion: gc.ProtocolVersion, StreamID: strings.Repeat("a", 43), Sequence: 1, Kind: "snapshot", Snapshot: &gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway"}}})
		_ = encoder.Encode(gc.Notification{ProtocolVersion: gc.ProtocolVersion, StreamID: strings.Repeat("a", 43), Sequence: 2, Kind: "keepalive"})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	client, _ := NewClient(server.URL, server.Client().Transport)
	defer client.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- client.Notifications(ctx, identity, func(*gc.GatewayStatus) error { applied <- struct{}{}; return nil })
	}()
	select {
	case <-applied:
	case <-time.After(2 * time.Second):
		t.Fatal("snapshot was not delivered")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("client did not stop")
	}
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("server waiter did not stop")
	}
	if challenges.Load() != 1 {
		t.Fatal("keepalive created an authentication challenge")
	}
}

func TestGatewayNotificationsRejectIncompleteDuplicateAndTrailingFrames(t *testing.T) {
	for _, scenario := range []string{"first_keepalive", "duplicate", "trailing", "wrong_gateway", "slow_consumer"} {
		t.Run(scenario, func(t *testing.T) {
			server, identity, _ := notificationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/x-ndjson")
				frame := gc.Notification{ProtocolVersion: gc.ProtocolVersion, StreamID: strings.Repeat("a", 43), Sequence: 1, Kind: "snapshot", Snapshot: &gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway"}}}
				if scenario == "first_keepalive" {
					frame.Kind, frame.Snapshot = "keepalive", nil
				}
				if scenario == "wrong_gateway" {
					frame.Snapshot.Gateway.PublicID = "other"
				}
				raw, _ := json.Marshal(frame)
				if scenario == "trailing" {
					raw = append(raw, []byte(`{}`)...)
				}
				_, _ = w.Write(append(raw, '\n'))
				if scenario == "duplicate" {
					_, _ = w.Write(append(raw, '\n'))
				}
			})
			client, _ := NewClient(server.URL, server.Client().Transport)
			defer client.Close()
			applied := 0
			err := client.Notifications(t.Context(), identity, func(*gc.GatewayStatus) error {
				applied++
				if scenario == "slow_consumer" {
					return errors.New("bounded consumer full")
				}
				return nil
			})
			if err == nil || (scenario != "duplicate" && scenario != "slow_consumer" && applied != 0) || applied > 1 {
				t.Fatalf("invalid frame was accepted: applied=%d error=%v", applied, err)
			}
		})
	}
}

func TestGatewayNotificationsPreserveAuthenticationReason(t *testing.T) {
	server, identity, _ := notificationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_ = json.NewEncoder(w).Encode(gc.Response[gc.EmptyRequest]{Error: &gc.Error{Code: "GATEWAY_IDENTITY_EXPIRED", Message: "Register again"}})
	})
	client, _ := NewClient(server.URL, server.Client().Transport)
	defer client.Close()
	err := client.Notifications(t.Context(), identity, func(*gc.GatewayStatus) error { t.Fatal("unauthorized snapshot"); return nil })
	var remote *CloudError
	if !errors.As(err, &remote) || remote.Code != "GATEWAY_IDENTITY_EXPIRED" || remote.Status != 401 {
		t.Fatalf("authentication failure lost its action: %v", err)
	}
}
