package redevpluginintegration

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/websecurity"
)

const (
	csrfHeader = "X-ReDevPlugin-CSRF"
	csrfProof  = "redeven-env-v1"
)

type webSecurityGuard struct {
	resolver *sessionResolver
	sessions *sessionPermissionCache
}

func (a *sessionAdapter) Authenticate(r *http.Request) (sessionctx.Context, error) {
	if a == nil {
		return sessionctx.Context{}, sessionctx.ErrSessionRequired
	}
	return a.webSecurity.Authenticate(r)
}

func (a *sessionAdapter) ValidateOrigin(r *http.Request, session sessionctx.Context, policy websecurity.OriginPolicy) error {
	if a == nil {
		return websecurity.ErrOriginDenied
	}
	return a.webSecurity.ValidateOrigin(r, session, policy)
}

func (a *sessionAdapter) ValidateCSRF(r *http.Request, session sessionctx.Context, policy websecurity.CSRFPolicy) error {
	if a == nil {
		return websecurity.ErrCSRFInvalid
	}
	return a.webSecurity.ValidateCSRF(r, session, policy)
}

func (a *sessionAdapter) AuthorizeRoute(r *http.Request, session sessionctx.Context, action websecurity.RouteAction) error {
	if a == nil {
		return host.ErrActionDenied
	}
	return a.webSecurity.AuthorizeRoute(r, session, action)
}

func (g webSecurityGuard) Authenticate(r *http.Request) (sessionctx.Context, error) {
	if routeRoleFromRequest(r) != RouteRoleEnvTrusted || g.resolver == nil {
		return sessionctx.Context{}, sessionctx.ErrSessionRequired
	}
	return g.resolver.ResolveRequest(r.Context(), r)
}

func (g webSecurityGuard) ValidateOrigin(r *http.Request, session sessionctx.Context, policy websecurity.OriginPolicy) error {
	if policy != websecurity.OriginPolicyTrustedHost || !session.Valid() || routeRoleFromRequest(r) != RouteRoleEnvTrusted || !isReDevPluginManagementPath(requestPath(r)) {
		return websecurity.ErrOriginDenied
	}
	origins := r.Header.Values("Origin")
	if len(origins) != 1 {
		return websecurity.ErrOriginDenied
	}
	origin := origins[0]
	if origin == "" || origin != strings.TrimSpace(origin) || origin == "null" {
		return websecurity.ErrOriginDenied
	}
	trustedOrigin, ok := trustedOriginFromRequest(r)
	if !ok || origin != trustedOrigin {
		return websecurity.ErrOriginDenied
	}
	return nil
}

func (g webSecurityGuard) ValidateCSRF(r *http.Request, session sessionctx.Context, policy websecurity.CSRFPolicy) error {
	if policy == websecurity.CSRFPolicyNotRequired {
		return nil
	}
	if policy != websecurity.CSRFPolicyRequired || !session.Valid() {
		return websecurity.ErrCSRFInvalid
	}
	proofs := r.Header.Values(csrfHeader)
	if len(proofs) == 0 || proofs[0] == "" {
		return websecurity.ErrCSRFRequired
	}
	if len(proofs) != 1 || subtle.ConstantTimeCompare([]byte(proofs[0]), []byte(csrfProof)) != 1 {
		return websecurity.ErrCSRFInvalid
	}
	return nil
}

func (g webSecurityGuard) AuthorizeRoute(_ *http.Request, session sessionctx.Context, action websecurity.RouteAction) error {
	if !action.Valid() || !session.Valid() {
		return host.ErrActionDenied
	}
	resolved, ok := g.sessions.Get(session)
	if !ok || !permissionsAllowAction(resolved.permissions, host.ManagementAction(action)) {
		return host.ErrActionDenied
	}
	return nil
}

func requestPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	return r.URL.Path
}

func isReDevPluginManagementPath(path string) bool {
	path = strings.TrimSpace(path)
	return path == "/_redevplugin/api/plugins" || strings.HasPrefix(path, "/_redevplugin/api/plugins/")
}

func hashID(namespace, value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(namespace) + ":" + strings.TrimSpace(value)))
	return "sha256:" + hex.EncodeToString(sum[:])
}
