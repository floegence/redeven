package localui

import (
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

const DefaultBind = "localhost:23998"

type bindFamily int

const (
	bindFamilyIPv4 bindFamily = iota
	bindFamilyIPv6
)

// BindSpec is the parsed Local UI listener configuration.
type BindSpec struct {
	host      string
	port      int
	localhost bool
	wildcard  bool
	loopback  bool
	family    bindFamily
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
			family:    bindFamilyIPv4,
		}, nil
	}

	addr, err := netip.ParseAddr(strings.TrimSpace(host))
	if err != nil {
		return BindSpec{}, fmt.Errorf("host must be localhost or an IP literal")
	}
	addr = addr.Unmap()
	family := bindFamilyIPv6
	if addr.Is4() {
		family = bindFamilyIPv4
	}
	return BindSpec{
		host:     addr.String(),
		port:     port,
		wildcard: addr.IsUnspecified(),
		loopback: addr.IsLoopback(),
		family:   family,
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
	case !b.wildcard:
		return []string{formatHTTPURL(b.host, port)}
	default:
		return discoverWildcardURLs(b.family, port)
	}
}

func discoverWildcardURLs(family bindFamily, port int) []string {
	var preferred []string
	var discovered []string
	addHost := func(dst *[]string, host string) {
		host = strings.TrimSpace(host)
		if host == "" {
			return
		}
		*dst = append(*dst, host)
	}

	if family == bindFamilyIPv4 {
		addHost(&preferred, "127.0.0.1")
	} else {
		addHost(&preferred, "::1")
	}

	ifaces, err := net.Interfaces()
	if err != nil {
		out := make([]string, 0, len(preferred))
		for _, host := range preferred {
			out = append(out, formatHTTPURL(host, port))
		}
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			default:
				continue
			}
			if ip == nil {
				continue
			}
			if family == bindFamilyIPv4 {
				ip = ip.To4()
				if ip == nil {
					continue
				}
			} else {
				ip = ip.To16()
				if ip == nil || ip.To4() != nil {
					continue
				}
			}
			if ip.IsMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() {
				continue
			}
			discovered = append(discovered, ip.String())
		}
	}

	sort.Strings(discovered)
	seen := make(map[string]struct{}, len(preferred)+len(discovered))
	out := make([]string, 0, len(preferred)+len(discovered))
	for _, host := range append(preferred, discovered...) {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, formatHTTPURL(host, port))
	}
	return out
}

func formatHTTPURL(host string, port int) string {
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(port)), Path: "/"}).String()
}
