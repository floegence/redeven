package gatewaymembership

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func membershipStore(t *testing.T) (*Store, GatewayIdentity) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hooks, err := NewPolicyHooks(HookConfig{})
	if err != nil {
		t.Fatal(err)
	}
	id := GatewayIdentity{ID: "gateway_test", PrivateKey: key}
	store, err := NewStore(filepath.Join(t.TempDir(), "members.json"), id, "https://gateway.internal:7443", "127.0.0.1:7443", hooks)
	if err != nil {
		t.Fatal(err)
	}
	return store, id
}

func memberRequest(t *testing.T, invitation gp.EnrollmentDescriptor, runtimeID string) (gp.MemberJoinRequest, ed25519.PrivateKey) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, transportKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: runtimeID}}, transportKey)
	if err != nil {
		t.Fatal(err)
	}
	id := MemberID(invitation.InvitationID, base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)))
	delegation := gp.MemberDelegation{ProtocolVersion: gp.Version, GatewayID: invitation.GatewayID, MemberID: id, RuntimePublicID: runtimeID, PublicKeyB64u: base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)), InvitationID: invitation.InvitationID, ConsentedAtUnixMS: time.Now().UnixMilli(), ManageAccess: true, ManageCloudPublication: true}
	if err := SignDelegation(&delegation, key); err != nil {
		t.Fatal(err)
	}
	service, _, err := NewServiceCertificate(runtimeID)
	if err != nil {
		t.Fatal(err)
	}
	if err := SignService(&service, delegation, key); err != nil {
		t.Fatal(err)
	}
	request := gp.MemberJoinRequest{ProtocolVersion: gp.Version, InvitationID: invitation.InvitationID, Token: invitation.Token, DeliveryID: "delivery_test", Delegation: delegation, ClientCSRPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr})), Service: service, Metadata: gp.MemberMetadata{Hostname: runtimeID}}
	if err := SignJoin(&request, key); err != nil {
		t.Fatal(err)
	}
	return request, key
}

func TestMembershipAcceptsDifferentRuntimeReleaseVersions(t *testing.T) {
	store, _ := membershipStore(t)
	want := map[string]string{
		"runtime_old": "v1.0.0",
		"runtime_new": "v2.0.0",
		"runtime_dev": "v0.0.0-dev",
	}
	for id, version := range want {
		invitation, err := store.Invite("desktop_admin")
		if err != nil {
			t.Fatal(err)
		}
		request, key := memberRequest(t, invitation, id)
		request.Metadata.Version = version
		if err := SignJoin(&request, key); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Join(t.Context(), request); err != nil {
			t.Fatalf("compatible Runtime %s could not join: %v", version, err)
		}
	}
	members, _, _ := store.Snapshot()
	got := make(map[string]string)
	for _, member := range members {
		got[member.Member.RuntimePublicID] = member.Member.Metadata.Version
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mixed Runtime releases = %v, want %v", got, want)
	}
}

func TestInvitationHasOneDurableConcurrentDelivery(t *testing.T) {
	store, identity := membershipStore(t)
	invitation, err := store.Invite("desktop_admin")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyEnrollmentDescriptor(invitation, time.Now()); err != nil {
		t.Fatal(err)
	}
	request, _ := memberRequest(t, invitation, "runtime_a")
	var workers sync.WaitGroup
	results := make(chan gp.MemberJoinResponse, 20)
	failures := make(chan error, 20)
	for range 20 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			response, err := store.Join(context.Background(), request)
			if err != nil {
				failures <- err
				return
			}
			results <- response
		}()
	}
	workers.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	var first gp.MemberJoinResponse
	for response := range results {
		if first.MemberID == "" {
			first = response
		}
		if !reflect.DeepEqual(response, first) {
			t.Fatal("duplicate request changed credential delivery")
		}
	}
	members, policy, _ := store.Snapshot()
	if len(members) != 1 || policy.DefaultCloudAllowed || members[0].Member.MemberVersion != 1 {
		t.Fatalf("members %+v policy %+v", members, policy)
	}
	other, _ := memberRequest(t, invitation, "runtime_b")
	if _, err := store.Join(context.Background(), other); !errors.Is(err, ErrDenied) {
		t.Fatalf("second consumer: %v", err)
	}
	// A lost response can be recovered after restart, including after invitation
	// expiry; only the committed member and exact original request may recover it.
	store.mu.Lock()
	record := store.state.Invitations[invitation.InvitationID]
	record.ExpiresAtUnixMS = time.Now().Add(-time.Minute).UnixMilli()
	next := store.clone()
	next.Invitations[invitation.InvitationID] = record
	err = store.commit(next)
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(store.path, identity, "", "", store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	response, err := reopened.Join(context.Background(), request)
	if err != nil || !reflect.DeepEqual(response, first) {
		t.Fatalf("recovery %v", err)
	}
	if err := reopened.Remove(first.MemberID, first.MemberVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Join(context.Background(), request); !errors.Is(err, ErrDenied) {
		t.Fatalf("revoked delivery recovered: %v", err)
	}
}

func TestOldMembershipSchemasAreRejectedWithoutRewrite(t *testing.T) {
	for _, version := range []int{1, 2, 3, 4} {
		store, identity := membershipStore(t)
		legacy := store.clone()
		legacy.SchemaVersion = version
		if err := gatewaystate.Write(store.path, legacy); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(store.path)
		if _, err := NewStore(store.path, identity, "", "", store.hooks); !errors.Is(err, ErrState) {
			t.Fatalf("schema %d was accepted: %v", version, err)
		}
		after, _ := os.ReadFile(store.path)
		if string(before) != string(after) {
			t.Fatal("old membership state was rewritten")
		}
	}
}

func TestFutureMembershipSchemaIsRejectedWithoutRewrite(t *testing.T) {
	store, identity := membershipStore(t)
	store.mu.Lock()
	future := store.clone()
	future.SchemaVersion = 6
	if err := gatewaystate.Write(store.path, future); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()
	before, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(store.path, identity, "", "", store.hooks); !errors.Is(err, ErrState) {
		t.Fatalf("future schema accepted: %v", err)
	}
	after, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("future schema was rewritten while being rejected")
	}
}

func TestCloudInvitationCommandRecoversTheSameDelivery(t *testing.T) {
	store, identity := membershipStore(t)
	deadline := time.Now().Add(time.Minute)
	first, err := store.InviteForCommand("namespace_admin", "command_one", deadline)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(store.path, identity, "", "", store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		got, err := reopened.InviteForCommand("namespace_admin", "command_one", deadline)
		if err != nil || !reflect.DeepEqual(got, first) {
			t.Fatal("invitation delivery changed after restart", err)
		}
	}
	if _, err := reopened.InviteForCommand("another_admin", "command_one", deadline); err == nil {
		t.Fatal("command replay crossed the approving administrator")
	}
	if _, err := reopened.InviteForCommand("namespace_admin", "expired_command", time.Now().Add(-time.Minute)); err == nil {
		t.Fatal("expired command created an invitation")
	}
	request, _ := memberRequest(t, first, "runtime_delivery")
	response, err := reopened.Join(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Remove(response.MemberID, response.MemberVersion); err != nil {
		t.Fatal(err)
	}
	recovered, err := reopened.InviteForCommand("namespace_admin", "command_one", deadline)
	if err != nil || !reflect.DeepEqual(recovered, first) {
		t.Fatal("issuance retry changed the spent invitation", err)
	}
	if _, err := reopened.Join(context.Background(), request); err == nil {
		t.Fatal("invitation delivery restored removed membership")
	}
}

func TestMemberProofDoesNotCrossGatewayIdentityOrServiceOrigin(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, key := memberRequest(t, invitation, "runtime_a")
	changed := invitation
	changed.Endpoints[0].Address = "https://attacker.invalid"
	if VerifyEnrollmentDescriptor(changed, time.Now()) == nil {
		t.Fatal("changed invitation endpoint accepted")
	}
	if VerifyJoin(request, "another_gateway", time.Now()) == nil {
		t.Fatal("delegation replayed to another gateway")
	}
	request.Service.Origin = "https://localhost"
	if err := SignJoin(&request, key); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Join(context.Background(), request); err == nil {
		t.Fatal("member-controlled network origin accepted")
	}
}

func TestCloudDefaultsAndOverridesHaveOneEffectivePolicy(t *testing.T) {
	member := MemberRecord{Member: gp.Member{State: "active"}, HookCloudAllowed: true}
	for _, allowDefault := range []bool{false, true} {
		for _, override := range []gp.CloudPermission{gp.CloudInherit, gp.CloudAllow, gp.CloudDeny} {
			member.Member.CloudPermission = override
			want := override == gp.CloudAllow || (override == gp.CloudInherit && allowDefault)
			if got := EffectiveCloudAllowed(member, gp.GatewayPolicy{DefaultCloudAllowed: allowDefault}); got != want {
				t.Fatalf("default=%v override=%s got=%v", allowDefault, override, got)
			}
		}
	}
	member.Member.CloudPermission = gp.CloudAllow
	member.HookCloudAllowed = false
	if EffectiveCloudAllowed(member, gp.GatewayPolicy{DefaultCloudAllowed: true}) {
		t.Fatal("built-in policy widened hook rejection")
	}
}

func TestPendingJoinCancellationFencesLostResponses(t *testing.T) {
	for _, committed := range []bool{false, true} {
		store, identity := membershipStore(t)
		invitation, err := store.Invite("admin")
		if err != nil {
			t.Fatal(err)
		}
		request, _ := memberRequest(t, invitation, "runtime_cancel")
		if committed {
			if _, err := store.Join(context.Background(), request); err != nil {
				t.Fatal(err)
			}
		}
		if err := store.CancelJoin(request); err != nil {
			t.Fatal(err)
		}
		store, err = NewStore(store.path, identity, "", "", store.hooks)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.CancelJoin(request); err != nil {
			t.Fatal("cancellation was not idempotent", err)
		}
		if _, err := store.Join(context.Background(), request); err == nil {
			t.Fatal("canceled invitation regained membership")
		}
	}
}

func TestServiceCertificateCannotBeSubstitutedByGateway(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	request, key := memberRequest(t, invitation, "runtime_certificate")
	if err := VerifyMemberService(request.Service, request.Delegation, time.Now()); err != nil {
		t.Fatal(err)
	}
	forged, _, err := NewServiceCertificate(request.Delegation.RuntimePublicID)
	if err != nil {
		t.Fatal(err)
	}
	forged.Signature = request.Service.Signature
	if VerifyMemberService(forged, request.Delegation, time.Now()) == nil {
		t.Fatal("substituted service certificate accepted")
	}
	if err := SignService(&forged, request.Delegation, key); err != nil {
		t.Fatal(err)
	}
	if err := VerifyMemberService(forged, request.Delegation, time.Now()); err != nil {
		t.Fatal("Runtime-owned certificate rotation rejected", err)
	}
}
