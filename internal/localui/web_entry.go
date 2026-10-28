package localui

import (
	"context"
	"encoding/base64"
	"net/http"
	"strconv"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/webbinding"
)

type webEntryKey struct{}
type webAdmissionKey struct{}
type webDeviceKey struct{}
type webApplicationKey struct{}

// A child application may use the parent Runtime login, but can spend and
// attach only artifacts issued for this exact resource origin.
func webArtifactScope(r *http.Request) string {
	return webArtifactScopeContext(r.Context(), webEntry(r))
}
func webArtifactScopeContext(ctx context.Context, lease *webbinding.Lease) string {
	if lease == nil {
		return ""
	}
	scope := webScope(ctx, lease)
	if application, _ := ctx.Value(webApplicationKey{}).(string); application != "" {
		scope += ":app:" + application
	}
	return scope
}

func webScope(ctx context.Context, lease *webbinding.Lease) string {
	device, _ := ctx.Value(webDeviceKey{}).(string)
	return "web:" + lease.Binding.ID + ":" + strconv.FormatInt(lease.Binding.Revision, 10) + ":" + device
}

func webEntry(r *http.Request) *webbinding.Lease {
	if r == nil {
		return nil
	}
	lease, _ := r.Context().Value(webEntryKey{}).(*webbinding.Lease)
	return lease
}

func webEntryScope(r *http.Request) string {
	lease := webEntry(r)
	if lease == nil {
		return ""
	}
	return webScope(r.Context(), lease)
}

func webAuthorizationMatches(ctx context.Context, scope, accessID string) bool {
	lease, _ := ctx.Value(webEntryKey{}).(*webbinding.Lease)
	if lease == nil {
		return scope == ""
	}
	current, _ := ctx.Value(webAdmissionKey{}).(string)
	return lease.Context.Err() == nil && current != "" && current == accessID && scope == webArtifactScopeContext(ctx, lease)
}

// The only caller is the Gateway member TLS application. Neither a public
// TCP request nor a forwarded header can create this context.
func (s *Server) bindWebEntry(r *http.Request, serviceOrigin string) bool {
	if s.webBindings == nil || !s.accessEnabled() {
		return false
	}
	lease, err := s.webBindings.Admit(r.Context(), r.TLS, r.Host)
	if err != nil {
		return false
	}
	if s.a == nil || lease.Binding.RuntimeID != s.a.RuntimePublicID() || gatewaymembership.ServiceOrigin(lease.Binding.RuntimeID) != serviceOrigin {
		lease.Close()
		return false
	}
	// Accept the device reference only after the registered TLS key proves
	// Connector identity. Public requests cannot create this scope.
	device := r.Header.Get("X-Redeven-Web-Device")
	raw, err := base64.RawURLEncoding.DecodeString(device)
	if err != nil || len(raw) != 32 || base64.RawURLEncoding.EncodeToString(raw) != device {
		lease.Close()
		return false
	}
	ctx := context.WithValue(lease.Context, webEntryKey{}, lease)
	ctx = context.WithValue(ctx, webDeviceKey{}, device)
	r.Header.Del("X-Redeven-Web-Device")
	ctx = context.WithValue(ctx, gatewayMemberOriginKey{}, lease.Binding.Origin)
	*r = *r.WithContext(ctx)
	return true
}

func (s *Server) configureWebBindings() {
	if s.webBindings == nil {
		return
	}
	s.webBindings.SetRevocationHandler(func(id string, revision int64) {
		scope := "web:" + id + ":" + strconv.FormatInt(revision, 10)
		for _, accessID := range s.accessGate.RevokeEntryScopeFamily(scope) {
			s.closePluginAccessSession(accessID)
		}
	})
}

func (s *Server) authenticateLocalEntry(r *http.Request, req accessgate.AuthenticationRequest, challenge string) (result *accessgate.LocalSessionResult, err error) {
	authenticate := func() error {
		result, err = s.accessGate.AuthenticateLocalForScope(req, unlockAttemptSubject(r), challenge, webEntryScope(r))
		return err
	}
	if lease := webEntry(r); lease != nil {
		err = s.webBindings.WithCurrent(lease.Binding, authenticate)
		return result, err
	}
	err = authenticate()
	return result, err
}

// The profile is issued only after pinned mTLS admission, never from a browser header.
func verifiedWebEntryProfile(r *http.Request) string {
	if webEntry(r) != nil {
		return "center-v1"
	}
	return ""
}
