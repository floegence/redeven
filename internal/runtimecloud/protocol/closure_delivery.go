package protocol

const ControlRPCClosure uint32 = 41009

// ClosureDelivery can only close the named identity and generation. It cannot
// grant or restore authority.
type ClosureDelivery struct {
	ProtocolVersion string       `json:"protocol_version"`
	Binding         BindingFence `json:"binding"`
	Closure         Closure      `json:"closure"`
}

func (d ClosureDelivery) Valid() bool {
	return d.ProtocolVersion == ProtocolVersion && d.Binding.Valid() && d.Closure.PublicID != "" && len(d.Closure.PublicID) <= 64 && d.Closure.BindingPublicID == d.Binding.PublicID && d.Closure.RuntimePublicID == d.Binding.RuntimePublicID && d.Closure.Generation == d.Binding.Generation && !d.Closure.RuntimeClosed && d.Closure.Reason != ""
}

type ClosureDeliveryResult struct {
	AuthorityRevoked bool `json:"authority_revoked"`
}
