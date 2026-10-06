package gatewaycloud

// RepublishRequest fences the revocation revision shown to the administrator.
type RepublishRequest struct {
	Current BindingFence `json:"current"`
}
