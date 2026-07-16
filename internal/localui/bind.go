package localui

import (
	"fmt"
	"net"
	"net/netip"
	"sort"
	"strconv"
	"strings"
)

const DefaultBind = "localhost:23998"

// BindSpec is the parsed Local UI listener configuration.
type BindSpec struct {
	host      string
	port      int
	localhost bool
	loopback  bool
	wildcard  bool
}

func ParseBind(raw string) (BindSpec, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = DefaultBind
	}
	host, portRaw, err := net.SplitHostPort(value)
	if err != nil {
		return BindSpec{}, fmt.Errorf("want host:port: %w", err)
	}
	if strings.TrimSpace(host) == "" {
		return BindSpec{}, fmt.Errorf("missing host")
	}
	port, err := strconv.Atoi(strings.TrimSpace(portRaw))
	if err != nil || port < 0 || port > 65535 {
		return BindSpec{}, fmt.Errorf("invalid port %q", portRaw)
	}

	if strings.EqualFold(strings.TrimSpace(host), "localhost") {
		if port == 0 {
			return BindSpec{}, fmt.Errorf("localhost:0 is not supported; use 127.0.0.1:0 or [::1]:0")
		}
		return BindSpec{
			host:      "localhost",
			port:      port,
			localhost: true,
			loopback:  true,
		}, nil
	}

	addr, err := netip.ParseAddr(strings.TrimSpace(host))
	if err != nil {
		return BindSpec{}, fmt.Errorf("host must be localhost or an IP literal")
	}
	if addr.Zone() != "" || addr.Is4In6() {
		return BindSpec{}, fmt.Errorf("host must be a canonical IPv4 or IPv6 literal without a zone")
	}
	if addr.IsUnspecified() {
		if port == 0 {
			return BindSpec{}, fmt.Errorf("network exposure requires a fixed port")
		}
		return BindSpec{
			host:     addr.String(),
			port:     port,
			wildcard: true,
		}, nil
	}
	if !addr.IsLoopback() {
		if !eligibleNetworkAccessAddress(addr) {
			return BindSpec{}, fmt.Errorf("network host must be a non-loopback unicast IP address")
		}
		if port == 0 {
			return BindSpec{}, fmt.Errorf("network exposure requires a fixed port")
		}
	}
	return BindSpec{
		host:     addr.String(),
		port:     port,
		loopback: addr.IsLoopback(),
	}, nil
}

func (b BindSpec) Port() int {
	return b.port
}

func (b BindSpec) Host() string {
	return b.host
}

func (b BindSpec) IsLoopbackOnly() bool {
	return b.localhost || b.loopback
}

func (b BindSpec) IsNetworkExposure() bool {
	return b.host != "" && !b.IsLoopbackOnly()
}

func (b BindSpec) IsWildcard() bool {
	return b.wildcard
}

func (b BindSpec) ListenLabel() string {
	host := b.host
	if host == "" {
		host = "localhost"
	}
	return net.JoinHostPort(host, strconv.Itoa(b.port))
}

func (b BindSpec) ListenAddrs() []string {
	port := strconv.Itoa(b.port)
	if b.localhost {
		return []string{
			net.JoinHostPort("127.0.0.1", port),
			net.JoinHostPort("::1", port),
		}
	}
	if strings.TrimSpace(b.host) == "" || b.port < 0 {
		return nil
	}
	return []string{net.JoinHostPort(b.host, port)}
}

func (b BindSpec) DisplayURLs() []string {
	return b.displayURLsForPort(b.port)
}

func (b BindSpec) ListenLabelForPort(port int) string {
	return b.listenLabelForPort(port)
}

func (b BindSpec) DisplayURLsForPort(port int) []string {
	return b.displayURLsForPort(port)
}

func (b BindSpec) listenLabelForPort(port int) string {
	switch {
	case port < 0:
		port = 0
	}
	host := b.host
	if host == "" {
		host = "localhost"
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func (b BindSpec) displayURLsForPort(port int) []string {
	if port <= 0 {
		return nil
	}
	switch {
	case b.localhost:
		return []string{formatHTTPURL("localhost", port)}
	case b.wildcard:
		return nil
	default:
		return []string{formatHTTPURL(b.host, port)}
	}
}

type interfaceAddress struct {
	addr     netip.Addr
	up       bool
	loopback bool
}

func resolveNetworkAccessHosts(bind BindSpec) ([]netip.Addr, error) {
	if !bind.IsNetworkExposure() {
		return nil, nil
	}
	if !bind.IsWildcard() {
		addr, err := netip.ParseAddr(bind.Host())
		if err != nil || !eligibleNetworkAccessAddress(addr) {
			return nil, fmt.Errorf("invalid network bind host")
		}
		return []netip.Addr{addr}, nil
	}

	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("enumerate network interfaces: %w", err)
	}
	candidates := make([]interfaceAddress, 0)
	for _, iface := range interfaces {
		addrs, addrErr := iface.Addrs()
		if addrErr != nil {
			continue
		}
		for _, raw := range addrs {
			prefix, parseErr := netip.ParsePrefix(strings.TrimSpace(raw.String()))
			if parseErr != nil {
				continue
			}
			candidates = append(candidates, interfaceAddress{
				addr:     prefix.Addr(),
				up:       iface.Flags&net.FlagUp != 0,
				loopback: iface.Flags&net.FlagLoopback != 0,
			})
		}
	}
	return selectNetworkAccessHosts(bind, candidates), nil
}

func selectNetworkAccessHosts(bind BindSpec, candidates []interfaceAddress) []netip.Addr {
	wantIPv4 := bind.Host() == "0.0.0.0"
	unique := make(map[netip.Addr]struct{})
	for _, candidate := range candidates {
		addr := candidate.addr
		if !candidate.up || candidate.loopback || addr.Is4() != wantIPv4 || !eligibleNetworkAccessAddress(addr) {
			continue
		}
		unique[addr] = struct{}{}
	}
	result := make([]netip.Addr, 0, len(unique))
	for addr := range unique {
		result = append(result, addr)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Less(result[j]) })
	return result
}

func eligibleNetworkAccessAddress(addr netip.Addr) bool {
	return addr.IsValid() &&
		addr.Zone() == "" &&
		!addr.Is4In6() &&
		!addr.IsLoopback() &&
		!addr.IsUnspecified() &&
		!addr.IsMulticast() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsLinkLocalMulticast() &&
		addr.IsGlobalUnicast()
}

func formatHTTPURL(host string, port int) string {
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port)) + "/"
}
