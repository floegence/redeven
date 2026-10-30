// Package pluginorigin defines Redeven's DNS routing for platform-owned Web
// surfaces. Names select a resource handler and are never authorization proof.
package pluginorigin

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

var errOrigin = errors.New("plugin application origin is not routable")

func validLabel(label string) bool {
	return len(label) == 48 && strings.Trim(label, "0123456789abcdef") == ""
}

// Child maps the platform's opaque origin key into the already trusted parent
// route. Center uses its configured wildcard; Gateway uses one Runtime's TLS
// namespace; Desktop uses loopback localhost on the private listener port.
func Child(parent, key string) (string, error) {
	if !validLabel(key) {
		return "", errOrigin
	}
	u, err := url.Parse(parent)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || u.String() != parent || u.Host != strings.ToLower(u.Host) || strings.HasSuffix(u.Host, ":") {
		return "", errOrigin
	}
	host := u.Hostname()
	port := u.Port()
	if port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
			return "", errOrigin
		}
		if u.Scheme == "http" && n == 80 || u.Scheme == "https" && n == 443 {
			return "", errOrigin
		}
	}
	var suffix string
	switch u.Scheme {
	case "http":
		address, e := netip.ParseAddr(host)
		if host != "localhost" && (e != nil || !address.IsLoopback() || address.Is4In6() || address.String() != host) {
			return "", errOrigin
		}
		suffix = "localhost"
	case "https":
		if net.ParseIP(host) != nil || !validDNSName(host) {
			return "", errOrigin
		}
		first, rest, ok := strings.Cut(host, ".")
		if !ok || rest == "" || strings.HasSuffix(host, ".") {
			return "", errOrigin
		}
		if rest == "redeven.invalid" {
			if len(first) != 42 || !strings.HasPrefix(first, "r-") || strings.Trim(first[2:], "0123456789abcdef") != "" {
				return "", errOrigin
			}
			suffix = host
		} else {
			suffix = rest
		}
	default:
		return "", errOrigin
	}
	if len(key)+1+len(suffix) > 253 {
		return "", errOrigin
	}
	u.Host = key + "." + suffix
	if port != "" {
		u.Host = net.JoinHostPort(u.Host, port)
	}
	return u.String(), nil
}

func validDNSName(host string) bool {
	if len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") || strings.Trim(label, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
			return false
		}
	}
	return true
}

func IsChild(parent, child string) bool {
	u, err := url.Parse(child)
	if err != nil {
		return false
	}
	key, _, ok := strings.Cut(u.Hostname(), ".")
	if !ok {
		return false
	}
	expected, err := Child(parent, key)
	return err == nil && expected == child
}
