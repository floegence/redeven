package accessgate

import (
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestWebEntryCredentialsCannotCrossEntryOrDirectPath(t *testing.T) {
	gate := New(Options{Password: "secret"})
	first, err := gate.AuthenticateLocalForScope(AuthenticationRequest{Password: "secret"}, "peer", "browser", "web:first:1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := gate.AuthenticateLocalForScope(AuthenticationRequest{Password: "secret"}, "peer", "browser", "web:second:1")
	if err != nil {
		t.Fatal(err)
	}
	direct, err := gate.AuthenticateLocal(AuthenticationRequest{Password: "secret"}, "peer", "browser")
	if err != nil {
		t.Fatal(err)
	}
	meta := session.Meta{EndpointID: "env_local", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", SessionKind: "envapp_rpc", UserPublicID: "user_local"}
	for _, scope := range []string{"", "web:second:1", "web:first:2"} {
		if _, _, ok := gate.ResolveLocalSessionForScope(first.SessionToken, scope); ok {
			t.Fatal("cookie crossed scope", scope)
		}
		if gate.CanResumeMetaForScope(first.ResumeToken, meta, scope) {
			t.Fatal("resume token crossed scope", scope)
		}
		if _, err := gate.MintLocalSessionFromResumeTokenForScope(first.ResumeToken, meta, scope); err == nil {
			t.Fatal("resume minted cross-scope cookie", scope)
		}
	}
	resumed, err := gate.MintLocalSessionFromResumeTokenForScope(first.ResumeToken, meta, "web:first:1")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := gate.ResolveLocalSessionForScope(resumed.SessionToken, "web:first:1"); !ok {
		t.Fatal("valid scoped resume rejected")
	}
	if ids := gate.RevokeEntryScope("web:first:1"); len(ids) != 1 || ids[0] != first.AccessSessionID {
		t.Fatal("wrong revoked lineage", ids)
	}
	if _, _, ok := gate.ResolveLocalSessionForScope(resumed.SessionToken, "web:first:1"); ok {
		t.Fatal("revoked lineage survived")
	}
	if _, _, ok := gate.ResolveLocalSessionForScope(second.SessionToken, "web:second:1"); !ok {
		t.Fatal("other entry revoked")
	}
	if _, _, ok := gate.ResolveLocalSession(direct.SessionToken); !ok {
		t.Fatal("direct path revoked")
	}
}

func TestWebEntryEditorDelegationPreservesEntryScope(t *testing.T) {
	gate := New(Options{Password: "secret"})
	login, err := gate.AuthenticateLocalForScope(AuthenticationRequest{Password: "secret"}, "peer", "browser", "web:first:1")
	if err != nil {
		t.Fatal(err)
	}
	parent := session.Meta{ChannelID: "parent", EndpointID: "env", UserPublicID: "user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true}
	gate.RegisterChannelWithOptions(parent, RegisterChannelOptions{AccessSessionID: login.AccessSessionID})
	delegation, err := gate.DelegateCodeSpace("parent", "editor")
	if err != nil {
		t.Fatal(err)
	}
	child := parent
	child.ChannelID = "child"
	child.FloeApp = "com.floegence.redeven.code"
	child.CodeSpaceID = "editor"
	gate.RegisterChannel(child)
	if _, err := gate.AuthenticateChannel("child", AuthenticationRequest{Delegation: delegation}, "peer"); err == nil {
		t.Fatal("editor delegation crossed to direct entry")
	}
	gate.RegisterChannelWithOptions(child, RegisterChannelOptions{AccessSessionID: login.AccessSessionID})
	result, err := gate.AuthenticateChannel("child", AuthenticationRequest{Delegation: delegation}, "peer")
	if err != nil {
		t.Fatal(err)
	}
	if gate.CanResumeMeta(result.ResumeToken, child) {
		t.Fatal("editor resume escaped entry")
	}
	if !gate.CanResumeMetaForScope(result.ResumeToken, child, "web:first:1") {
		t.Fatal("editor lost entry scope")
	}
	gate.RevokeEntryScope("web:first:1")
	if gate.IsChannelUnlocked("child") {
		t.Fatal("revoked editor remains unlocked")
	}
}
