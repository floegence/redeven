package gatewaycloud

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// Summary is safe for local management UI and never includes machine credentials.
type Summary struct {
	Configured        bool   `json:"configured"`
	CloudOrigin       string `json:"cloud_origin,omitempty"`
	GatewayPublicID   string `json:"gateway_public_id,omitempty"`
	NamespacePublicID string `json:"namespace_public_id,omitempty"`
	Region            string `json:"region,omitempty"`
	State             string `json:"state"`
	ManagementURL     string `json:"management_url,omitempty"`
}

func (g *Gateway) Summary() Summary {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := Summary{Configured: g.config.CloudOrigin != "", CloudOrigin: g.config.CloudOrigin, GatewayPublicID: g.config.GatewayPublicID, NamespacePublicID: g.config.NamespacePublicID, State: "unconfigured"}
	if !out.Configured {
		return out
	}
	out.State = "pending"
	key, _ := gatewayIdentity(g.config)
	fingerprint := ""
	if len(key.PrivateKey) > 0 {
		sum := sha256.Sum256(key.PrivateKey.Public().(ed25519.PublicKey))
		fingerprint = hex.EncodeToString(sum[:])
	}
	if g.status != nil {
		out.State, out.Region, fingerprint = g.status.Gateway.State, g.status.Gateway.Region, g.status.Gateway.PublicKeySHA256
	}
	if g.status != nil && g.status.Gateway.IdentityExpiresAtUnixMS <= time.Now().UnixMilli() && out.State != "revoked" && out.State != "retired" {
		out.State = "expired"
	}
	if out.GatewayPublicID == "" {
		out.State = "registering"
		return out
	}
	out.ManagementURL = GatewayManagementURL(out.CloudOrigin, out.NamespacePublicID, out.GatewayPublicID, fingerprint)
	return out
}
