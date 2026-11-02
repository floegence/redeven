package protocol

import (
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"
)

// ValidateEgressDestinations accepts exact host:port authorities only.
// An empty list disables forwarding; wildcards and paths never grant access.
func ValidateEgressDestinations(destinations []string) error {
	if len(destinations) > 64 {
		return errors.New("too many egress destinations")
	}
	seen := map[string]bool{}
	for _, address := range destinations {
		host, port, err := net.SplitHostPort(address)
		n, portErr := strconv.Atoi(port)
		if err != nil || portErr != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port || host == "" || address != strings.ToLower(strings.TrimSpace(address)) || strings.ContainsAny(host, "*/?#@%\\ \t\r\n") || seen[address] {
			return errors.New("invalid egress destination")
		}
		if _, err := netip.ParseAddr(host); err != nil {
			if len(host) > 253 {
				return errors.New("invalid egress destination")
			}
			for _, label := range strings.Split(host, ".") {
				if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
					return errors.New("invalid egress destination")
				}
				for _, c := range label {
					if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
						return errors.New("invalid egress destination")
					}
				}
			}
		}
		seen[address] = true
	}
	return nil
}
