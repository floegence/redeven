package pluginmarket

const (
	RefreshStateRefreshing = "refreshing"
	RefreshStateReady      = "ready"
	RefreshStateFailed     = "refresh_failed"
)

// RefreshEvent is a process-local status projection for Redeven's trusted Env
// App. It never carries remote error details or installation authority.
type RefreshEvent struct {
	Seq           int64  `json:"seq"`
	State         string `json:"state"`
	Generation    int64  `json:"generation"`
	Stale         bool   `json:"stale"`
	CheckedAt     string `json:"checked_at,omitempty"`
	NextRefreshAt string `json:"next_refresh_at,omitempty"`
}
