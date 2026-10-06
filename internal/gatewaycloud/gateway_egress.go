package gatewaycloud

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func cloudAuthority(origin string) string {
	u, err := url.Parse(origin)
	if err != nil || !gc.ValidOrigin(origin) {
		return ""
	}
	port := u.Port()
	if port == "" {
		port = "443"
	}
	return net.JoinHostPort(u.Hostname(), port)
}

// applyPolicyLocked intersects Cloud's verified projection with the current
// local member authority. Local denial closes business flows before syncing.
func (g *Gateway) applyPolicyLocked() error {
	permitted := []gatewayegress.Member{}
	if g.status == nil {
		return g.egress.ReplaceMembers(permitted)
	}
	remoteByID := make(map[string]gc.EgressMember)
	management := make(map[string]bool)
	for _, remote := range g.status.Members {
		remoteByID[remote.MemberID] = remote
	}
	for _, remote := range g.status.ManagementMembers {
		remoteByID[remote.MemberID] = remote
		management[remote.MemberID] = true
	}
	for _, local := range g.records {
		member := local.Member
		if member.State != "active" {
			continue
		}
		remote, observed := remoteByID[member.MemberID]
		if observed && (remote.MemberVersion != member.MemberVersion || remote.RuntimePublicID != member.RuntimePublicID || remote.RequestPublicID != gc.CandidateID(g.config.GatewayPublicID, member.MemberID)) {
			continue
		}
		var targets []string
		generation := int64(1)
		allowed := gatewaymembership.EffectiveCloudAllowed(local, g.policy)
		if observed {
			generation = remote.Generation
			if management[member.MemberID] {
				targets = remote.Destinations
			} else if allowed && g.status.Gateway.State == "active" {
				targets = remote.Destinations
			} else {
				generation++
				targets = []string{cloudAuthority(g.config.CloudOrigin)}
			}
		} else if allowed && g.status.Gateway.State == "active" {
			targets = g.status.AdmissionDestinations
		}
		if len(targets) == 0 || generation < 1 {
			continue
		}
		permitted = append(permitted, gatewayegress.Member{ID: member.MemberID, MemberVersion: uint64(member.MemberVersion), Generation: uint64(generation), CertificateSHA256: local.ClientCertificateSHA256, AdmissionExpiresAtUnixMS: max(1, min(local.ClientExpiresAtUnixMS, g.status.Gateway.IdentityExpiresAtUnixMS)), Destinations: targets})
	}
	return g.egress.ReplaceMembers(permitted)
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
	for _, remote := range g.status.ManagementMembers {
		if remote.MemberID == member.MemberID {
			out.Allowed, out.State = false, "unpublished"
			return out
		}
	}
	for _, remote := range g.status.Members {
		if remote.MemberID == member.MemberID && remote.MemberVersion == member.MemberVersion && remote.State == "published" {
			out.State = "published"
			break
		}
	}
	return out
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v4/member/cloud-closure" {
		g.relayClosure(w, r)
		return
	}
	if r.Method == http.MethodConnect {
		g.egress.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || r.URL.Path != "/v4/member/cloud" {
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
