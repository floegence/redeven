package agent

import (
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestRuntimeMembershipUsesGatewayPairingFingerprint(t *testing.T) {
	store, identity := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	publicDER, err := x509.MarshalPKIXPublicKey(identity.PrivateKey.Public())
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	fingerprint, err := security.PublicKeyFingerprint(publicPEM)
	if err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: &config.Config{LocalEnvironmentPublicID: "runtime", Gateways: []*gatewaymembership.RuntimeConfig{member}}}
	summaries := a.RuntimeServiceSnapshot().GatewayMemberships
	if len(summaries) != 1 || summaries[0].IdentityFingerprint != fingerprint {
		t.Fatalf("Runtime membership must match the Gateway pairing identity: got %+v, want %s", summaries, fingerprint)
	}
}
