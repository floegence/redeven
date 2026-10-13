package gatewaycloud

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// applyPolicyLocked intersects only local member admission with trusted Cloud
// destinations. Runtime Cloud authorization is enforced end to end by Cloud.
func (g *Gateway) applyPolicyLocked() error {
	if g.admissionTimer != nil {
		g.admissionTimer.Stop()
		g.admissionTimer = nil
	}
	permitted := []gatewayegress.Member{}
	now := time.Now().UnixMilli()
	deadline := int64(0)
	if g.status == nil || g.status.Gateway.State != "active" || g.status.Gateway.IdentityExpiresAtUnixMS <= time.Now().UnixMilli() {
		return g.egress.ReplaceMembers(permitted)
	}
	for _, local := range g.records {
		member := local.Member
		if member.State != "active" || local.ClientExpiresAtUnixMS <= now || !gatewaymembership.EffectiveCloudAllowed(local, g.policy) {
			continue
		}
		if len(g.status.AdmissionDestinations) == 0 {
			continue
		}
		expires := min(local.ClientExpiresAtUnixMS, g.status.Gateway.IdentityExpiresAtUnixMS)
		if deadline == 0 || expires < deadline {
			deadline = expires
		}
		permitted = append(permitted, gatewayegress.Member{ID: member.MemberID, MemberVersion: uint64(member.MemberVersion), Generation: uint64(member.MemberVersion), CertificateSHA256: local.ClientCertificateSHA256, AdmissionExpiresAtUnixMS: min(local.ClientExpiresAtUnixMS, g.status.Gateway.IdentityExpiresAtUnixMS), Destinations: append([]string(nil), g.status.AdmissionDestinations...)})
	}
	err := g.egress.ReplaceMembers(permitted)
	if err == nil && deadline > now {
		// One Gateway-owned timer closes expired admissions even if its Cloud
		// management stream is unavailable. It performs no network or DB work.
		g.admissionTimer = time.AfterFunc(time.Until(time.UnixMilli(deadline)), func() {
			g.mu.Lock()
			defer g.mu.Unlock()
			_ = g.applyPolicyLocked()
		})
	}
	return err
}

func (g *Gateway) MemberContext(record gatewaymembership.MemberRecord) gp.MemberCloudContext {
	g.mu.Lock()
	defer g.mu.Unlock()
	member := record.Member
	out := gp.MemberCloudContext{ProtocolVersion: gp.Version, GatewayID: g.stable.ID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, PolicyRevision: g.policy.Revision, State: "not_configured"}
	if g.config.CloudOrigin == "" {
		return out
	}
	out.CloudOrigin, out.GatewayPublicID, out.NamespacePublicID = g.config.CloudOrigin, g.config.GatewayPublicID, g.config.NamespacePublicID
	if g.status == nil {
		out.State = "cloud_offline"
		return out
	}
	out.RegionOrigin = g.status.RegionOrigin
	if g.status.Gateway.IdentityExpiresAtUnixMS <= time.Now().UnixMilli() {
		out.State = "cloud_identity_expired"
		return out
	}
	if g.status.Gateway.State != "active" {
		out.State = "cloud_approval_required"
		return out
	}
	if !gatewaymembership.EffectiveCloudAllowed(record, g.policy) {
		out.State = "cloud_denied"
		return out
	}
	out.Allowed, out.State = true, "awaiting_cloud_approval"
	for _, remote := range g.status.Members {
		if remote.MemberID == member.MemberID && remote.MemberVersion == member.MemberVersion && remote.State == "published" {
			out.State = "published"
			break
		}
	}
	return out
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		g.egress.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || r.URL.Path != "/v6/member/cloud" {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Origin") != "" || r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
		http.Error(w, "MEMBER_DENIED", http.StatusForbidden)
		return
	}
	record, err := g.members.Authenticate(r.TLS.PeerCertificates[0])
	if err != nil {
		http.Error(w, "MEMBER_DENIED", http.StatusForbidden)
		return
	}
	var request gp.CatalogRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || request.ProtocolVersion != gp.Version {
		http.Error(w, "PROTOCOL_MISMATCH", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(g.MemberContext(record))
}

// Invalid authority is observable and cannot leave a previous allow snapshot live.
func (g *Gateway) applyPolicyOrDenyLocked() {
	if err := g.applyPolicyLocked(); err != nil {
		_ = g.egress.ReplaceMembers(nil)
		if g.log != nil {
			g.log.Error("Gateway Cloud policy rejected", "category", "invalid_policy")
		}
	}
}
