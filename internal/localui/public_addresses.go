package localui

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"syscall"
)

type publicListenerSpec struct {
	host     string
	optional bool
}

func (s publicListenerSpec) network() string {
	if netip.MustParseAddr(s.host).Is4() {
		return "tcp4"
	}
	return "tcp6"
}

func (b BindSpec) listenerSpecs() []publicListenerSpec {
	if b.localhost {
		return []publicListenerSpec{{"127.0.0.1", true}, {"::1", true}}
	}
	if b.host == "" {
		return nil
	}
	result := []publicListenerSpec{{host: b.host}}
	if b.wildcard {
		supplement := "::1"
		if b.host == "::" {
			supplement = "127.0.0.1"
		}
		result = append(result, publicListenerSpec{supplement, true})
	}
	return result
}

func unavailableAddressFamily(err error) bool {
	return errors.Is(err, syscall.EAFNOSUPPORT) || errors.Is(err, syscall.EADDRNOTAVAIL)
}

func listenPublicAddresses(bind BindSpec, listen func(string, string) (net.Listener, error)) ([]net.Listener, error) {
	var listeners []net.Listener
	for _, spec := range bind.listenerSpecs() {
		address := net.JoinHostPort(spec.host, strconv.Itoa(bind.port))
		listener, err := listen(spec.network(), address)
		if err != nil {
			if spec.optional && unavailableAddressFamily(err) {
				continue
			}
			closeNetworkListeners(listeners)
			return nil, fmt.Errorf("listen %s: %w", address, err)
		}
		listeners = append(listeners, listener)
	}
	if len(listeners) == 0 {
		return nil, fmt.Errorf("no supported Local UI listener for %s", bind.ListenLabel())
	}
	return listeners, nil
}

// publicAccessHosts is the sole host policy for startup and certificate preflight.
// Network hosts retain their priority; local aliases follow successful listeners.
func publicAccessHosts(bind BindSpec, bound []netip.Addr, resolve func(BindSpec) ([]netip.Addr, error)) ([]string, error) {
	actual := make(map[string]bool, len(bound))
	plan := make(map[string]bool)
	for _, spec := range bind.listenerSpecs() {
		plan[spec.host] = spec.optional
	}
	for _, addr := range bound {
		if _, ok := plan[addr.String()]; !ok {
			return nil, fmt.Errorf("invalid Local UI listener %s: does not match bind %s", addr, bind.ListenLabel())
		}
		actual[addr.String()] = true
	}
	for host, optional := range plan {
		if !optional && !actual[host] {
			return nil, fmt.Errorf("missing Local UI listener %s", host)
		}
	}
	if len(actual) == 0 {
		return nil, fmt.Errorf("missing Local UI listeners")
	}
	if !bind.localhost && !bind.wildcard {
		return []string{bind.host}, nil
	}
	var hosts []string
	if bind.wildcard {
		addresses, err := resolve(bind)
		if err != nil {
			return nil, err
		}
		for _, addr := range addresses {
			if !eligibleNetworkAccessAddress(addr) || addr.Is4() != (bind.host == "0.0.0.0") {
				return nil, fmt.Errorf("invalid Local UI network address %s", addr)
			}
			hosts = append(hosts, addr.String())
		}
	}
	hosts = append(hosts, "localhost")
	if actual["127.0.0.1"] || actual["0.0.0.0"] {
		hosts = append(hosts, "127.0.0.1")
	}
	if actual["::1"] || actual["::"] {
		hosts = append(hosts, "::1")
	}
	return dedupeStrings(hosts), nil
}

// Preflight probes only optional loopback families on ephemeral ports, so it
// can run while the configured public port is still owned by the old Runtime.
func preflightPublicHosts(bind BindSpec, listen func(string, string) (net.Listener, error), resolve func(BindSpec) ([]netip.Addr, error)) ([]string, error) {
	var bound []netip.Addr
	for _, spec := range bind.listenerSpecs() {
		if spec.optional {
			listener, err := listen(spec.network(), net.JoinHostPort(spec.host, "0"))
			if err != nil {
				if unavailableAddressFamily(err) {
					continue
				}
				return nil, fmt.Errorf("check Local UI address family for %s: %w", spec.host, err)
			}
			_ = listener.Close()
		}
		bound = append(bound, netip.MustParseAddr(spec.host))
	}
	return publicAccessHosts(bind, bound, resolve)
}
