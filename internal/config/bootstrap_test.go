package config

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flowercontrol "github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

// The fixture exercises the signed v5 enrollment and exact shared delivery.
func enrollmentTestServer(t *testing.T, enroll func(http.ResponseWriter, *http.Request, rc.SignedRequest, rc.EnrollRequest), recover ...func(http.ResponseWriter, *http.Request, rc.SignedRequest, rc.RecoverRequest)) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		origin := "https://" + r.Host
		switch r.URL.Path {
		case "/api/rcpp/v5/runtime-link/resolve":
			var q struct {
				EnvPublicID string `json:"env_public_id"`
			}
			if json.NewDecoder(r.Body).Decode(&q) != nil {
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode(runtimeLinkAssignment{ProtocolVersion: rc.ProtocolVersion, NamespacePublicID: "namespace", CloudID: "example_control_plane", CloudOrigin: origin, EnvPublicID: q.EnvPublicID, AccessPointID: "dev", AccessPointOrigin: origin, ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()})
		case "/api/console/v1/runtime-cloud/v5/challenges":
			var q rc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&q) != nil {
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.ChallengeResponse{Proof: rc.Proof{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: origin, NamespacePublicID: q.NamespacePublicID, RuntimePublicID: q.RuntimePublicID, Purpose: q.Purpose, ChallengeID: "challenge", NonceB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}})
		case "/api/console/v1/runtime-cloud/v5/enroll":
			var signed rc.SignedRequest
			var q rc.EnrollRequest
			if json.NewDecoder(r.Body).Decode(&signed) != nil || json.Unmarshal(signed.Payload, &q) != nil || signed.Proof.Verify(q.PublicKeyB64u, signed.Payload, time.Now()) != nil {
				t.Error("invalid independent identity proof")
				w.WriteHeader(400)
				return
			}
			enroll(w, r, signed, q)
		case "/api/console/v1/runtime-cloud/v5/recover":
			var signed rc.SignedRequest
			var q rc.RecoverRequest
			if len(recover) != 1 || json.NewDecoder(r.Body).Decode(&signed) != nil || json.Unmarshal(signed.Payload, &q) != nil {
				t.Error("unexpected recovery")
				w.WriteHeader(400)
				return
			}
			recover[0](w, r, signed, q)
		default:
			t.Errorf("retired or unknown route: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
}
func writeEnrollmentTestDelivery(t *testing.T, w http.ResponseWriter, r *http.Request, q rc.EnrollRequest) {
	t.Helper()
	b := rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding", CloudID: "example_control_plane", RuntimePublicID: q.RuntimePublicID, EnvPublicID: q.Authorization.EnvPublicID, NamespacePublicID: "namespace", OwnerKind: rc.OwnerUser, OwnerPublicID: "user", Generation: 7}, Region: "dev", State: "active", PublicKeyB64u: q.PublicKeyB64u, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}
	p := bootstrapTestControlArtifactPool(t, 7)
	p.LogicalCloudBindingID = "runtime-cloud-v5:binding"
	finalizeBootstrapTestPoolDigest(t, p)
	raw, _ := json.Marshal(p)
	var shared rc.ControlArtifactPoolV2
	_ = json.Unmarshal(raw, &shared)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.RecoverResponse{ProtocolVersion: rc.ProtocolVersion, State: rc.ApprovalApproved, Binding: &b, Closures: []rc.Closure{}, Delivery: &rc.CredentialDelivery{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: "https://" + r.Host, RegionOrigin: "https://" + r.Host, Binding: b, DeliveryRequestID: q.OperationID, ControlArtifactPool: &shared}}})
}
func TestBootstrapSignedEnrollmentPreservesSettingsAndDoesNotPersistTicket(t *testing.T) {
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		writeEnrollmentTestDelivery(t, w, r, q)
	})
	defer server.Close()
	root := t.TempDir()
	layout, _ := LocalEnvironmentStateLayout(root)
	if err := Save(layout.ConfigPath, &Config{LogLevel: "debug", Shell: "/bin/zsh", AI: savedChatGPTConfig()}); err != nil {
		t.Fatal(err)
	}
	_, err := BootstrapConfig(t.Context(), BootstrapArgs{CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "ticket", StateRoot: root, LogLevel: "info", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(layout.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LogLevel != "info" || cfg.Shell != "/bin/zsh" || cfg.AI == nil || cfg.CloudAssociation.Binding.EnvPublicID != "env" || len(cfg.ControlArtifactPool.Entries) != 2 {
		t.Fatal("enrollment changed local settings or failed to persist identity")
	}
	raw, _ := os.ReadFile(layout.ConfigPath)
	if strings.Contains(string(raw), "ticket") {
		t.Fatal("setup ticket persisted")
	}
	if _, err := os.Stat(layout.ConfigPath + ".cloud-enrollment-v5.json"); !os.IsNotExist(err) {
		t.Fatal("completed journal remains")
	}
}
func TestBootstrapUnknownResultReusesOriginalOperationAndIdentity(t *testing.T) {
	var requests []rc.EnrollRequest
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		requests = append(requests, q)
		if len(requests) == 1 {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"retry"}}`))
			return
		}
		writeEnrollmentTestDelivery(t, w, r, q)
	})
	defer server.Close()
	args := BootstrapArgs{CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "ticket", StateRoot: t.TempDir(), HTTPClient: server.Client()}
	if _, err := BootstrapConfig(context.Background(), args); err == nil {
		t.Fatal("lost result must remain pending")
	}
	if _, err := BootstrapConfig(context.Background(), args); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 || requests[0].OperationID != requests[1].OperationID || requests[0].PublicKeyB64u != requests[1].PublicKeyB64u || requests[0].RuntimePublicID != requests[1].RuntimePublicID {
		t.Fatal("unknown operation was repeated with a new identity or ID")
	}
}
func TestEnrollmentJournalRejectsAnotherTargetWithoutChangingBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	assignment := &runtimeLinkAssignment{CloudID: "example_control_plane", CloudOrigin: "https://cloud.example", AccessPointOrigin: "https://region.example", EnvPublicID: "env", NamespacePublicID: "namespace"}
	_, journal, err := prepareRuntimeCloudEnrollment(path, assignment, nil, cloudLinkResolveArgs{})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(journal)
	assignment.EnvPublicID = "other"
	if _, _, err := prepareRuntimeCloudEnrollment(path, assignment, nil, cloudLinkResolveArgs{}); err == nil {
		t.Fatal("pending target overwritten")
	}
	after, _ := os.ReadFile(journal)
	if string(before) != string(after) {
		t.Fatal("pending journal changed")
	}
}
func TestBootstrapAndPersistedPoolsRejectDuplicateArtifactIdentity(t *testing.T) {
	digestDuplicate := bootstrapTestControlArtifactPool(t, 7)
	digestDuplicate.Entries[1].ArtifactJSON = append(json.RawMessage(nil), digestDuplicate.Entries[0].ArtifactJSON...)
	finalizeBootstrapTestPoolDigest(t, digestDuplicate)
	if _, err := controlArtifactPoolFromBootstrap(*digestDuplicate, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "repeats an artifact digest") {
		t.Fatalf("duplicate bootstrap artifact error = %v", err)
	}

	channelDuplicate := bootstrapTestControlArtifactPool(t, 7)
	channelDuplicate.Entries[1].ArtifactChannelID = channelDuplicate.Entries[0].ArtifactChannelID
	finalizeBootstrapTestPoolDigest(t, channelDuplicate)
	if _, err := controlArtifactPoolFromBootstrap(*channelDuplicate, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "repeats an artifact channel") {
		t.Fatalf("duplicate bootstrap channel error = %v", err)
	}

	persisted, err := controlArtifactPoolFromBootstrap(*bootstrapTestControlArtifactPool(t, 7), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	persisted.Entries[1].ArtifactJSON = append(json.RawMessage(nil), persisted.Entries[0].ArtifactJSON...)
	persisted.Entries[1].ArtifactDigest = persisted.Entries[0].ArtifactDigest
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "repeats an artifact digest") {
		t.Fatalf("duplicate persisted artifact error = %v", err)
	}
}

func TestBootstrapAndPersistedPoolsRejectSharedContractDrift(t *testing.T) {
	waterlineDrift := bootstrapTestControlArtifactPool(t, 7)
	waterlineDrift.TargetWaterline = 1
	finalizeBootstrapTestPoolDigest(t, waterlineDrift)
	if _, err := controlArtifactPoolFromBootstrap(*waterlineDrift, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("bootstrap target waterline drift error = %v", err)
	}

	sequenceOverflow := bootstrapTestControlArtifactPool(t, 7)
	sequenceOverflow.Entries[1].ArtifactSequence = uint64(math.MaxInt64) + 1
	sequenceOverflow.ServerHighestArtifactSequence = uint64(math.MaxInt64) + 1
	finalizeBootstrapTestPoolDigest(t, sequenceOverflow)
	if _, err := controlArtifactPoolFromBootstrap(*sequenceOverflow, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("bootstrap sequence overflow error = %v", err)
	}

	persisted, err := controlArtifactPoolFromBootstrap(*bootstrapTestControlArtifactPool(t, 7), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	persisted.TargetWaterline = 1
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "target_waterline") {
		t.Fatalf("persisted target waterline drift error = %v", err)
	}
	persisted.TargetWaterline = ControlArtifactTargetWaterline
	persisted.Entries[1].Sequence = uint64(math.MaxInt64) + 1
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "sequences must increase") {
		t.Fatalf("persisted sequence overflow error = %v", err)
	}
	persisted.Entries[1].Sequence = 2
	responseDigest := sha256.Sum256([]byte("response"))
	persisted.PendingTopUp = &ControlArtifactPendingTopUp{
		RequestIDB64u:      base64.RawURLEncoding.EncodeToString(make([]byte, sha256.Size)),
		BindingGeneration:  7,
		State:              ControlArtifactTopUpApplied,
		ResponseDigestB64u: base64.RawURLEncoding.EncodeToString(responseDigest[:]),
		HighestSequence:    uint64(math.MaxInt64) + 1,
	}
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "server waterline") {
		t.Fatalf("persisted pending waterline overflow error = %v", err)
	}
}

func bootstrapTestControlArtifactPool(t *testing.T, generation int64) *bootstrapControlArtifactPool {
	t.Helper()
	endpoints, err := flowercontrol.NewEndpointSet(flowercontrol.EndpointConfig{
		ID: "websocket", URL: "wss://example.com/flowersec/v3/direct", TLS: flowercontrol.CAPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(4 * time.Minute).Truncate(time.Second)
	pool := &bootstrapControlArtifactPool{
		Version:                       ControlArtifactPoolContractVersion,
		LogicalCloudBindingID:         fmt.Sprintf("binding-%d", generation),
		BindingGeneration:             generation,
		TargetWaterline:               ControlArtifactTargetWaterline,
		RefreshHorizonSeconds:         ControlArtifactRefreshHorizonS,
		ServerHighestArtifactSequence: ControlArtifactTargetWaterline,
		Entries:                       make([]bootstrapControlArtifactPoolEntry, 0, ControlArtifactTargetWaterline),
	}
	for sequence := 1; sequence <= ControlArtifactTargetWaterline; sequence++ {
		channelID := fmt.Sprintf("bootstrap-%d-%d", generation, sequence)
		issued, err := flowercontrol.NewIssuer().IssueDirect(flowercontrol.DirectIssueOptions{
			Session: flowercontrol.SessionOptions{
				ChannelID: channelID,
				ExpiresAt: expires,
			},
			Endpoints:         endpoints,
			RendezvousGroupID: "bootstrap-test",
			ListenerAudience:  "redeven",
			UpstreamAddress:   "127.0.0.1:1",
		})
		if err != nil {
			t.Fatal(err)
		}
		pool.Entries = append(pool.Entries, bootstrapControlArtifactPoolEntry{
			ArtifactJSON:      issued.ArtifactJSON(),
			ArtifactChannelID: channelID,
			BindingGeneration: generation,
			ArtifactSequence:  uint64(sequence),
			ExpiresAtUnixS:    expires.Unix(),
		})
	}
	finalizeBootstrapTestPoolDigest(t, pool)
	return pool
}

func finalizeBootstrapTestPoolDigest(t *testing.T, pool *bootstrapControlArtifactPool) {
	t.Helper()
	pool.ResponseDigestB64u = ""
	unsigned, err := json.Marshal(pool)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(unsigned)
	pool.ResponseDigestB64u = base64.RawURLEncoding.EncodeToString(digest[:])
}

func TestBootstrapLostResultRecoversAfterTicketExpiryWithoutNewEnrollment(t *testing.T) {
	var original rc.EnrollRequest
	enrolls := 0
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		enrolls++
		if enrolls == 1 {
			original = q
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"lost"}}`))
			return
		}
		if q.OperationID != original.OperationID {
			t.Error("operation changed")
		}
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"INVALID_RUNTIME_LINK_TICKET","message":"expired"}}`))
	}, func(w http.ResponseWriter, r *http.Request, signed rc.SignedRequest, q rc.RecoverRequest) {
		if q.EnrollmentOperationID != original.OperationID || q.RuntimePublicID != original.RuntimePublicID || signed.Proof.Verify(original.PublicKeyB64u, signed.Payload, time.Now()) != nil {
			t.Error("recovery did not prove the original enrollment")
		}
		delivered := original
		delivered.OperationID = q.DeliveryRequestID
		writeEnrollmentTestDelivery(t, w, r, delivered)
	})
	defer server.Close()
	args := BootstrapArgs{CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "expired-ticket", StateRoot: t.TempDir(), HTTPClient: server.Client()}
	if _, err := BootstrapConfig(t.Context(), args); err == nil {
		t.Fatal("first lost response must remain pending")
	}
	if _, err := BootstrapConfig(t.Context(), args); err != nil {
		t.Fatal(err)
	}
	if enrolls != 2 {
		t.Fatal("enrollment repeated with a new ID")
	}
}
func TestBootstrapExpiredDeliveryUsesSignedRecoveryAndKeepsEnrollmentID(t *testing.T) {
	var original rc.EnrollRequest
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		original = q
		w.WriteHeader(410)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"DELIVERY_EXPIRED","message":"expired"}}`))
	}, func(w http.ResponseWriter, r *http.Request, signed rc.SignedRequest, q rc.RecoverRequest) {
		if q.DeliveryRequestID == original.OperationID || q.EnrollmentOperationID != original.OperationID || signed.Proof.Verify(original.PublicKeyB64u, signed.Payload, time.Now()) != nil {
			t.Error("expired delivery lost the enrollment identity")
		}
		delivered := original
		delivered.OperationID = q.DeliveryRequestID
		writeEnrollmentTestDelivery(t, w, r, delivered)
	})
	defer server.Close()
	root := t.TempDir()
	path, err := BootstrapConfig(t.Context(), BootstrapArgs{CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "ticket", StateRoot: root, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CloudAssociation.EnrollmentOperationID != original.OperationID || cfg.CloudAssociation.DeliveryRequestID == original.OperationID {
		t.Fatal("delivery replaced the enrollment operation")
	}
}

func TestSavedEnrollmentWithRestoredJournalNeverReplaysCredentials(t *testing.T) {
	var savedJournal []byte
	var calls int
	root := t.TempDir()
	layout, _ := LocalEnvironmentStateLayout(root)
	journal := layout.ConfigPath + ".cloud-enrollment-v5.json"
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		calls++
		savedJournal, _ = os.ReadFile(journal)
		writeEnrollmentTestDelivery(t, w, r, q)
	})
	defer server.Close()
	args := BootstrapArgs{CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "ticket", StateRoot: root, HTTPClient: server.Client()}
	if _, err := BootstrapConfig(t.Context(), args); err != nil {
		t.Fatal(err)
	}
	if _, err := Update(layout.ConfigPath, func(c *Config) error {
		c.LogLevel = "debug"
		c.ControlArtifactPool.Entries[0].Spent = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(journal, savedJournal, 0600); err != nil {
		t.Fatal(err)
	}
	args.RuntimeLinkTicket = ""
	if _, err := BootstrapConfig(t.Context(), args); err != nil {
		t.Fatal(err)
	}
	current, err := Load(layout.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || current.LogLevel != "debug" || !current.ControlArtifactPool.Entries[0].Spent {
		t.Fatal("completed enrollment replayed an old pool or settings")
	}
}

func TestPendingEnrollmentCancellationFencesLateSaveAndRetainsIdentity(t *testing.T) {
	var captured *Config
	server := enrollmentTestServer(t, func(w http.ResponseWriter, r *http.Request, _ rc.SignedRequest, q rc.EnrollRequest) {
		writeEnrollmentTestDelivery(t, w, r, q)
	})
	defer server.Close()
	root := t.TempDir()
	layout, _ := LocalEnvironmentStateLayout(root)
	captured, err := ResolveCloudLinkConfig(t.Context(), CloudLinkBootstrapArgs{ConfigPath: layout.ConfigPath, CloudOrigin: server.URL, EnvironmentID: "env", RuntimeLinkTicket: "ticket", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := InspectPendingCloudEnrollment(layout.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	journal := layout.ConfigPath + ".cloud-enrollment-v5.json"
	before, _ := readPendingCloudEnrollment(layout.ConfigPath)
	if err := SetPendingCloudEnrollmentSuspended(layout.ConfigPath, pending.OperationID, true); err != nil {
		t.Fatal(err)
	}
	if err := SaveCloudLinkConfig(layout.ConfigPath, captured); err == nil {
		t.Fatal("cancelled enrollment committed a late result")
	}
	after, err := readPendingCloudEnrollment(layout.ConfigPath)
	if err != nil || !after.Suspended || after.PrivateKeyB64u != before.PrivateKeyB64u || after.BootstrapDeliveryRequestIDB64u != before.BootstrapDeliveryRequestIDB64u {
		t.Fatal("cancel discarded original identity", err)
	}
	if err := SetPendingCloudEnrollmentSuspended(layout.ConfigPath, pending.OperationID, false); err != nil {
		t.Fatal(err)
	}
	if err := SaveCloudLinkConfig(layout.ConfigPath, captured); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(journal); !os.IsNotExist(err) {
		t.Fatal("committed journal remains")
	}
}

func TestEnrollmentJournalRejectsDamagedIdentityAndOriginReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	assignment := &runtimeLinkAssignment{CloudID: "cloud", CloudOrigin: "https://cloud.example", AccessPointOrigin: "https://region.example", EnvPublicID: "env", NamespacePublicID: "namespace"}
	original, journal, err := prepareRuntimeCloudEnrollment(path, assignment, nil, cloudLinkResolveArgs{})
	if err != nil {
		t.Fatal(err)
	}
	for _, damage := range []func(*bootstrapDeliveryAttempt){func(a *bootstrapDeliveryAttempt) {
		a.PrivateKeyB64u = base64.RawURLEncoding.EncodeToString(make([]byte, 64))
	}, func(a *bootstrapDeliveryAttempt) { a.CloudOrigin = "http://cloud.example" }, func(a *bootstrapDeliveryAttempt) { a.ExpectedAssociationRevision = -1 }} {
		copy := original
		damage(&copy)
		raw, _ := json.Marshal(copy)
		if err := os.WriteFile(journal, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := InspectPendingCloudEnrollment(path); err == nil {
			t.Fatal("damaged journal accepted")
		}
		after, _ := os.ReadFile(journal)
		if string(after) != string(raw) {
			t.Fatal("invalid journal rewritten")
		}
	}
}
