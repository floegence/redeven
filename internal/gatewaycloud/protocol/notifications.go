package gatewaycloud

// Notification is scoped to an authenticated stream. A replacement stream
// starts with a full snapshot; sequence numbers fence duplicates within it.
type Notification struct {
	ProtocolVersion int            `json:"protocol_version"`
	StreamID        string         `json:"stream_id"`
	Sequence        uint64         `json:"sequence"`
	Kind            string         `json:"kind"`
	Snapshot        *GatewayStatus `json:"snapshot,omitempty"`
}
