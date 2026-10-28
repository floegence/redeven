package environmentcenter

import (
	"github.com/floegence/redeven/internal/webbinding"
	"testing"
	"time"
)

func TestRouteRotationPreservesIdentityAndRequiresNewOwnerConsent(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	cert, key, _, err := newClientCertificate(c.key.Instance, c.now())
	if err != nil {
		t.Fatal(err)
	}
	route := Route{ID: "route", SourceID: "gateway", MemberID: "member", RuntimeID: "runtime", Origin: "https://env.example.test", Certificate: cert, PrivateKey: key, Revision: 1}
	c.state.Routes = []Route{route}
	old, err := c.binding(login.Token, route.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := RotateRouteInput{ID: route.ID, ExpectedRevision: c.state.DirectoryRevision, BindingRevision: 7}
	grant := randomID()
	c.grants[digest(grant)] = &actionGrant{Session: login.Token, Action: actionDigest("route:rotate", input), Revision: c.state.Revision, Expires: c.now().Add(time.Minute)}
	binding, err := c.rotateRoute(login.Token, grant, input)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ID != old.ID || binding.RuntimeID != old.RuntimeID || binding.Origin != old.Origin || binding.Revision != 7 || binding.PublicKeySHA256 == old.PublicKeySHA256 {
		t.Fatal("rotation changed identity or reused key", binding)
	}
	stored, err := c.binding(login.Token, route.ID)
	if err != nil || stored != binding {
		t.Fatal("export did not preserve owner consent revision", stored, err)
	}
	store, err := webbinding.Open(t.TempDir(), "runtime")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.Put(binding, binding.Revision); err == nil {
		t.Fatal("unknown prior Runtime consent accepted")
	}
	if _, err = c.rotateRoute(login.Token, grant, input); err == nil {
		t.Fatal("rotation grant replayed")
	}
}
