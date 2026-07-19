package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

type RouteRole string

const RouteRoleEnvTrusted RouteRole = "env_trusted"

type routeRoleContextKey struct{}

type trustedOriginContextKey struct{}

func WithRouteRole(r *http.Request, role RouteRole) *http.Request {
	if r == nil {
		return nil
	}
	return r.WithContext(context.WithValue(r.Context(), routeRoleContextKey{}, role))
}

func routeRoleFromRequest(r *http.Request) RouteRole {
	if r == nil {
		return ""
	}
	role, _ := r.Context().Value(routeRoleContextKey{}).(RouteRole)
	return role
}

// WithTrustedOrigin binds the exact origin already authenticated by the host
// router. The value is server-only context and is never read from JSON or IPC.
func WithTrustedOrigin(r *http.Request, origin string) (*http.Request, error) {
	if r == nil {
		return nil, errors.New("request is required")
	}
	if err := validateTrustedOrigin(origin); err != nil {
		return nil, err
	}
	return r.WithContext(context.WithValue(r.Context(), trustedOriginContextKey{}, origin)), nil
}

func trustedOriginFromRequest(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	origin, ok := r.Context().Value(trustedOriginContextKey{}).(string)
	return origin, ok && validateTrustedOrigin(origin) == nil
}

func validateTrustedOrigin(origin string) error {
	if origin == "" || origin != strings.TrimSpace(origin) {
		return errors.New("trusted origin is invalid")
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("trusted origin is invalid")
	}
	return nil
}
