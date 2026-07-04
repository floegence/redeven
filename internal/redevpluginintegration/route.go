package redevpluginintegration

import (
	"context"
	"net/http"
)

type RouteRole string

const (
	RouteRoleEnvTrusted    RouteRole = "env_trusted"
	RouteRolePluginSandbox RouteRole = "plugin_sandbox"
)

type routeRoleContextKey struct{}

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
