package sessionhop

const (
	// HeaderChannelID carries the runtime session channel on the trusted local hop
	// between the per-session access proxy and the local app server.
	//
	// Browser-visible origin isolation still relies on the forwarded external origin
	// context; this header exists only so the app server can recover the already-bound
	// session without depending on public host labels.
	HeaderChannelID = "X-Redeven-Session-Channel"
)
