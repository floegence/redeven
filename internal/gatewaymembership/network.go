package gatewaymembership

import (
	"net"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var hostLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func normalizeHost(host string) (string, bool) {
	host = strings.ToLower(strings.TrimSpace(host))
	if ip := net.ParseIP(host); ip != nil {
		return ip.String(), true
	}
	if len(host) == 0 || len(host) > 253 {
		return "", false
	}
	for _, label := range strings.Split(host, ".") {
		if !hostLabel.MatchString(label) {
			return "", false
		}
	}
	return host, true
}

func normalizeNetworkSettings(settings gp.GatewayNetworkSettings) (gp.GatewayNetworkSettings, error) {
	if len(settings.ListenAddresses) < 1 || len(settings.ListenAddresses) > 16 || len(settings.AllowedHosts) > 64 || validateStoredEndpoints(settings.Endpoints) != nil {
		return settings, ErrState
	}
	normalized := gp.GatewayNetworkSettings{Endpoints: append([]gp.GatewayEndpoint{}, settings.Endpoints...), ListenAddresses: []string{}, AllowedHosts: []string{}}
	for _, address := range settings.ListenAddresses {
		host, port, err := net.SplitHostPort(strings.TrimSpace(address))
		number, numberErr := strconv.Atoi(port)
		if err != nil || numberErr != nil || number < 0 || number > 65535 {
			return settings, ErrState
		}
		if host != "" {
			var ok bool
			host, ok = normalizeHost(host)
			if !ok {
				return settings, ErrState
			}
		}
		canonical := net.JoinHostPort(host, strconv.Itoa(number))
		if slices.Contains(normalized.ListenAddresses, canonical) {
			return settings, ErrState
		}
		normalized.ListenAddresses = append(normalized.ListenAddresses, canonical)
	}
	for _, host := range settings.AllowedHosts {
		canonical, ok := normalizeHost(host)
		if !ok || slices.Contains(normalized.AllowedHosts, canonical) {
			return settings, ErrState
		}
		normalized.AllowedHosts = append(normalized.AllowedHosts, canonical)
	}
	return normalized, nil
}

func (s *Store) NetworkSettings() gp.GatewayNetworkSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return gp.GatewayNetworkSettings{ListenAddresses: append([]string{}, s.state.Endpoint.ListenAddresses...), AllowedHosts: append([]string{}, s.state.Endpoint.AllowedHosts...), Endpoints: append([]gp.GatewayEndpoint{}, s.state.AdvertisedEndpoints...)}
}

// UpdateNetworkSettings atomically saves bindings for the next start, request
// Host admission and confirmed share endpoints without replacing member identity.
func (s *Store) UpdateNetworkSettings(settings gp.GatewayNetworkSettings) error {
	settings, err := normalizeNetworkSettings(settings)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.clone()
	endpointsChanged := !endpointsEqual(settings.Endpoints, next.AdvertisedEndpoints)
	if !endpointsChanged && slices.Equal(settings.ListenAddresses, next.Endpoint.ListenAddresses) && slices.Equal(settings.AllowedHosts, next.Endpoint.AllowedHosts) {
		return nil
	}
	if endpointsChanged && len(settings.Endpoints) > 0 {
		next.Endpoint.URL = settings.Endpoints[0].Address
		next.Endpoint, err = renewEndpointForOrigins(next.Endpoint, endpointAddresses(settings.Endpoints))
		if err != nil {
			return err
		}
	}
	next.Endpoint.ListenAddresses = settings.ListenAddresses
	next.Endpoint.ListenAddress = settings.ListenAddresses[0]
	next.Endpoint.AllowedHosts = settings.AllowedHosts
	next.AdvertisedEndpoints = settings.Endpoints
	if endpointsChanged {
		next.Admissions = map[string]Admission{}
	}
	return s.commit(next)
}

// AllowsHost checks the original HTTP authority. Forwarded headers never
// expand it, and allowing a Host does not authorize a member or a Desktop.
func (s *Store) AllowsHost(request *http.Request) bool {
	s.mu.Lock()
	allowed := slices.Clone(s.state.Endpoint.AllowedHosts)
	s.mu.Unlock()
	if len(allowed) == 0 {
		return true
	}
	host := request.Host
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		host = parsed
	}
	host = strings.Trim(host, "[]")
	canonical, ok := normalizeHost(host)
	return ok && slices.Contains(allowed, canonical)
}
