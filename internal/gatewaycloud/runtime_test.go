package gatewaycloud

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
	"strings"
	"testing"
	"time"
)

func newMembershipFixture(t *testing.T) (*gatewaymembership.Store, *gatewaymembership.RuntimeConfig, *RuntimeConfig) {
	t.Helper()
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	publication, err := PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	return store, member, publication
}

func TestCloudAssociationUsesOnlyExistingMembership(t *testing.T) {
	_, member, publication := newMembershipFixture(t)
	identity, err := publication.Identity()
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := member.TLSConfig(true)
	if err != nil {
		t.Fatal(err)
	}
	memberKey, _ := gc.DecodeKey(member.PrivateKeyB64u)
	if identity.PrivateKey.Equal(tlsConfig.Certificates[0].PrivateKey) || identity.PrivateKey.Equal(ed25519.PrivateKey(memberKey)) {
		t.Fatal("Cloud key is shared with member or transport identity")
	}
	if _, err := publication.Proxy(member); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*gatewaymembership.RuntimeConfig){
		func(m *gatewaymembership.RuntimeConfig) { m.MemberVersion++ },
		func(m *gatewaymembership.RuntimeConfig) { m.MemberID = "other" },
		func(m *gatewaymembership.RuntimeConfig) { m.Leaving = true },
		func(m *gatewaymembership.RuntimeConfig) { m.GatewayTLSRootPEM = "untrusted" },
	} {
		changed := member.Clone()
		change(changed)
		if _, err := publication.Proxy(changed); err == nil {
			t.Fatal("mismatched member authorized Cloud forwarding")
		}
	}
	if _, err := publication.Proxy(nil); err == nil {
		t.Fatal("missing member fell back to direct access")
	}
	publication.Revoked = true
	if _, err := publication.Proxy(member); err == nil {
		t.Fatal("revoked publication authorized forwarding")
	}
	encoded, err := json.Marshal(publication)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"gateway_url", "certificate_pem", "join_token", "enrollment_token", "local_consent"} {
		if strings.Contains(string(encoded), field) {
			t.Fatalf("Cloud association retained a second membership field: %s", field)
		}
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
	_, _, runtime := newMembershipFixture(t)
	binding := gc.Binding{MemberID: runtime.MemberID, MemberVersion: runtime.MemberVersion, PublicID: "binding", EnvPublicID: "env", Region: "sg", NamespacePublicID: runtime.NamespacePublicID, GatewayPublicID: runtime.GatewayPublicID, RuntimePublicID: runtime.RuntimePublicID, Generation: 1, State: "active"}
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
