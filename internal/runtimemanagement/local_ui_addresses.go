package runtimemanagement

// LocalUIAddressIssue describes a partial public-access failure without changing
// Runtime liveness or exposing private management endpoints.
type LocalUIAddressIssue struct {
	Code  string   `json:"code"`
	Hosts []string `json:"hosts,omitempty"`
}

const (
	LocalUIInterfaceScanFailed        = "interface_scan_failed"
	LocalUIBoundAddressUnavailable    = "bound_address_unavailable"
	LocalUICertificateHostsNotCovered = "certificate_hosts_not_covered"
	LocalUICertificateRefreshFailed   = "certificate_refresh_failed"
)
