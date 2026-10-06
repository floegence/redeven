package gatewaycloud

import (
	"context"
	"time"
)

// observe records only counts and non-sensitive identifiers. Cloud gauges carry
// the observation timestamp so an outage cannot look like fresh zero backlog.
func (g *Gateway) observe(ctx context.Context) {
	if g.log == nil || g.budget == nil {
		return
	}
	flow := g.budget.Statistics()
	egress := g.egress.Statistics()
	g.log.InfoContext(ctx, "Gateway forwarding", "gateway_id", g.stable.ID,
		"active", flow.Active, "lan_active", flow.LAN, "cloud_active", flow.Cloud,
		"limit", flow.Limit, "accepted_total", flow.Accepted, "rejected_total", flow.Rejected,
		"cloud_buffer_budget_bytes", egress.BufferBudgetBytes,
		"cloud_upload_completed_bytes", egress.CompletedUploadBytes, "cloud_download_completed_bytes", egress.CompletedDownloadBytes)
	g.mu.Lock()
	status := g.status
	g.mu.Unlock()
	if status != nil {
		age := int64(-1)
		if status.Gateway.DirectorySyncedAtUnixMS > 0 {
			age = max(int64(0), time.Now().UnixMilli()-status.Gateway.DirectorySyncedAtUnixMS)
		}
		g.log.InfoContext(ctx, "Gateway Cloud projection", "gateway_id", g.stable.ID,
			"pending_closures", status.PendingClosureCount,
			"directory_synced_at_unix_ms", status.Gateway.DirectorySyncedAtUnixMS,
			"directory_age_ms", age, "observed_at_unix_ms", status.Gateway.LastSeenAtUnixMS)
	}
}
