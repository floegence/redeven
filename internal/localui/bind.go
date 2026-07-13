package localui

import (
	"fmt"
	"net"
	"net/netip"
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
	if addr.Zone() != "" || addr.Is4In6() || !addr.IsLoopback() {
		return BindSpec{}, fmt.Errorf("Local UI is loopback-only; use localhost, 127.0.0.0/8, or ::1")
	}
	return BindSpec{
		host:     addr.String(),
		port:     port,
		loopback: true,
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
	default:
		return []string{formatHTTPURL(b.host, port)}
	}
}

func formatHTTPURL(host string, port int) string {
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port)) + "/"
}
