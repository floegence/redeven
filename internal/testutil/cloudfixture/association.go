package cloudfixture

import (
	"crypto/ed25519"
	"encoding/base64"
	"time"

	"github.com/floegence/redeven/internal/config"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

// Association supplies an independent identity for local management fixtures.
func Association(runtimeID, envID string) *config.CloudAssociation {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	binding := rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding_fixture", CloudID: "provider_1", RuntimePublicID: runtimeID, EnvPublicID: envID, NamespacePublicID: "namespace_fixture", OwnerKind: rc.OwnerNamespace, OwnerPublicID: "namespace_fixture", Generation: 1}, Region: "dev", State: "active", PublicKeyB64u: public, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}
	return &config.CloudAssociation{Revision: 1, Enabled: true, CloudID: "provider_1", CloudOrigin: "https://redeven.test", RegionOrigin: "https://dev.redeven.test", NamespacePublicID: "namespace_fixture", RuntimePublicID: runtimeID, PublicKeyB64u: public, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), Binding: &binding, ApprovalState: rc.ApprovalApproved}
}
