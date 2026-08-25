package runtimemanagement

import "fmt"

type LocalUIExposureScope string

const (
	LocalUIExposureScopeLoopback LocalUIExposureScope = "loopback"
	LocalUIExposureScopeNetwork  LocalUIExposureScope = "network"
	LocalUITransportTLS                               = "tls"
)

// LocalUIExposure is the canonical runtime security posture projected to every
// Local UI status surface.
type LocalUIExposure struct {
	Scope            LocalUIExposureScope `json:"scope"`
	Transport        string               `json:"transport"`
	PasswordRequired bool                 `json:"password_required"`
}

func NewLocalUIExposure(network bool, passwordRequired bool) LocalUIExposure {
	scope := LocalUIExposureScopeLoopback
	if network {
		scope = LocalUIExposureScopeNetwork
	}
	return LocalUIExposure{
		Scope:            scope,
		Transport:        LocalUITransportTLS,
		PasswordRequired: passwordRequired,
	}
}

func (e LocalUIExposure) Validate() error {
	if e.Scope != LocalUIExposureScopeLoopback && e.Scope != LocalUIExposureScopeNetwork {
		return fmt.Errorf("invalid Local UI exposure scope %q", e.Scope)
	}
	if e.Transport != LocalUITransportTLS {
		return fmt.Errorf("invalid Local UI exposure transport %q", e.Transport)
	}
	if e.Scope == LocalUIExposureScopeNetwork && !e.PasswordRequired {
		return fmt.Errorf("network Local UI exposure requires password authentication")
	}
	return nil
}

func (e LocalUIExposure) IsNetwork() bool {
	return e.Scope == LocalUIExposureScopeNetwork
}
