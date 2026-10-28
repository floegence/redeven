package environmentcenter

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/url"
	"time"

	"github.com/floegence/redeven/internal/webbinding"
	"golang.org/x/net/publicsuffix"
)

type Source struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	GatewayID string `json:"gateway_id"`
}
type Directory struct {
	Bookmarks []Bookmark `json:"bookmarks"`
	Revision  int64      `json:"revision" minimum:"0"`
	Sources   []Source   `json:"sources"`
	Routes    []Route    `json:"routes"`
}

func (c *Center) Directory(token string) (Directory, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return Directory{}, err
	}
	out := Directory{Revision: c.state.DirectoryRevision, Sources: []Source{}, Routes: append([]Route{}, c.state.Routes...), Bookmarks: append([]Bookmark{}, c.state.Bookmarks...)}
	for _, g := range c.state.Gateways {
		out.Sources = append(out.Sources, Source{ID: g.ID, Name: g.Name, URL: g.URL, GatewayID: g.GatewayID})
	}
	return out, nil
}
func actionDigest(kind string, value any) string {
	raw, _ := json.Marshal(value)
	return kind + ":" + digest(string(raw))
}
func (c *Center) addGateway(token string, record GatewayRecord, expected int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return err
	}
	if c.state.DirectoryRevision != expected {
		return ErrConflict
	}
	if len(c.state.Gateways) >= 16 {
		return ErrBusy
	}
	for _, g := range c.state.Gateways {
		if g.URL == record.URL || g.GatewayID == record.GatewayID {
			return ErrConflict
		}
	}
	next := c.state
	next.Gateways = append(append([]GatewayRecord(nil), next.Gateways...), record)
	next.DirectoryRevision++
	c.auditLocked(&next, "gateway_pair", "committed", record.ID)
	return c.saveLocked(next)
}
func (c *Center) source(token, id string) (GatewayRecord, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return GatewayRecord{}, err
	}
	for _, g := range c.state.Gateways {
		if g.ID == id {
			return g, nil
		}
	}
	return GatewayRecord{}, ErrDenied
}
func sameSite(portal, environment string) bool {
	if webbinding.ValidateOrigin(environment) != nil {
		return false
	}
	p, _ := url.Parse(portal)
	e, _ := url.Parse(environment)
	if p.Hostname() == e.Hostname() || p.Port() != e.Port() {
		return false
	}
	first, err := publicsuffix.EffectiveTLDPlusOne(p.Hostname())
	if err != nil {
		return false
	}
	second, err := publicsuffix.EffectiveTLDPlusOne(e.Hostname())
	return err == nil && first == second
}

type RouteInput struct {
	SourceID         string `json:"source_id"`
	MemberID         string `json:"member_id"`
	RuntimeID        string `json:"runtime_id"`
	Origin           string `json:"origin"`
	Label            string `json:"label"`
	ExpectedRevision int64  `json:"expected_revision"`
}

func (c *Center) addRoute(token, grant string, input RouteInput) (Route, webbinding.Binding, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.grantLocked(token, grant, actionDigest("route:add", input)); err != nil {
		return Route{}, webbinding.Binding{}, err
	}
	if input.ExpectedRevision != c.state.DirectoryRevision {
		return Route{}, webbinding.Binding{}, ErrConflict
	}
	if !sameSite(c.key.Origin, input.Origin) || input.MemberID == "" || input.RuntimeID == "" || len(input.Label) > 120 || len(input.MemberID) > 128 || len(input.RuntimeID) > 128 {
		return Route{}, webbinding.Binding{}, ErrDenied
	}
	sourceExists := false
	for _, source := range c.state.Gateways {
		sourceExists = sourceExists || source.ID == input.SourceID
	}
	if !sourceExists {
		return Route{}, webbinding.Binding{}, ErrDenied
	}
	if len(c.state.Routes) >= 128 {
		return Route{}, webbinding.Binding{}, ErrBusy
	}
	for _, r := range c.state.Routes {
		if r.Origin == input.Origin || r.SourceID == input.SourceID && r.MemberID == input.MemberID {
			return Route{}, webbinding.Binding{}, ErrConflict
		}
	}
	cert, key, leaf, err := newClientCertificate(c.key.Instance, c.now())
	if err != nil {
		return Route{}, webbinding.Binding{}, err
	}
	r := Route{ID: randomID(), SourceID: input.SourceID, MemberID: input.MemberID, RuntimeID: input.RuntimeID, Origin: input.Origin, Label: input.Label, Revision: 1, Certificate: cert, PrivateKey: key}
	next := c.state
	next.Routes = append(append([]Route(nil), next.Routes...), r)
	next.DirectoryRevision++
	c.auditLocked(&next, "route_add", "committed", r.ID)
	if err = c.saveLocked(next); err != nil {
		return Route{}, webbinding.Binding{}, err
	}
	binding := webbinding.Binding{ID: r.ID, RuntimeID: r.RuntimeID, AppScope: "envapp", Origin: r.Origin, PublicKeySHA256: webbinding.PublicKeyFingerprint(leaf), Enabled: true, Revision: r.BindingRevision}
	return r, binding, nil
}
func newClientCertificate(instance string, now time.Time) (string, string, *x509.Certificate, error) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", nil, err
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Center " + instance[:8]}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, BasicConstraintsValid: true}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, public, private)
	if err != nil {
		return "", "", nil, err
	}
	key, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return "", "", nil, err
	}
	leaf, err := x509.ParseCertificate(raw)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw})), string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key})), leaf, err
}
func (c *Center) binding(token, id string) (webbinding.Binding, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return webbinding.Binding{}, err
	}
	for _, r := range c.state.Routes {
		if r.ID == id {
			block, _ := pem.Decode([]byte(r.Certificate))
			if block == nil {
				return webbinding.Binding{}, ErrDenied
			}
			leaf, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return webbinding.Binding{}, err
			}
			return webbinding.Binding{ID: r.ID, RuntimeID: r.RuntimeID, AppScope: "envapp", Origin: r.Origin, PublicKeySHA256: webbinding.PublicKeyFingerprint(leaf), Enabled: true, Revision: r.BindingRevision}, nil
		}
	}
	return webbinding.Binding{}, ErrDenied
}
func (c *Center) favorite(token, id string, value bool, expected int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return err
	}
	if expected != c.state.DirectoryRevision {
		return ErrConflict
	}
	next := c.state
	next.Routes = append([]Route(nil), next.Routes...)
	found := false
	for i := range next.Routes {
		if next.Routes[i].ID == id {
			next.Routes[i].Favorite = value
			found = true
		}
	}
	if !found {
		return ErrDenied
	}
	next.DirectoryRevision++
	return c.saveLocked(next)
}
func (c *Center) removeSource(token, grant, id string, expected int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.grantLocked(token, grant, actionDigest("source:remove", struct {
		ID       string
		Revision int64
	}{id, expected})); err != nil {
		return err
	}
	if expected != c.state.DirectoryRevision {
		return ErrConflict
	}
	next := c.state
	next.Gateways = nil
	next.Routes = nil
	found := false
	for _, g := range c.state.Gateways {
		if g.ID == id {
			found = true
		} else {
			next.Gateways = append(next.Gateways, g)
		}
	}
	if !found {
		return ErrDenied
	}
	for _, r := range c.state.Routes {
		if r.SourceID != id {
			next.Routes = append(next.Routes, r)
		}
	}
	next.DirectoryRevision++
	c.auditLocked(&next, "source_remove", "committed", id)
	return c.saveLocked(next)
}

// Bookmarks navigate the browser directly and never grant Connector dial authority.
type Bookmark struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}
type BookmarkInput struct {
	Name             string `json:"name"`
	URL              string `json:"url"`
	ExpectedRevision int64  `json:"expected_revision"`
}

func (c *Center) addBookmark(token, grant string, input BookmarkInput) (Bookmark, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	u, err := url.Parse(input.URL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(input.URL) > 2048 || len(input.Name) == 0 || len(input.Name) > 120 {
		return Bookmark{}, ErrDenied
	}
	if webbinding.ValidateOrigin(u.Scheme+"://"+u.Host) != nil {
		return Bookmark{}, ErrDenied
	}
	if input.ExpectedRevision != c.state.DirectoryRevision {
		return Bookmark{}, ErrConflict
	}
	if len(c.state.Bookmarks) >= 128 {
		return Bookmark{}, ErrBusy
	}
	if err = c.grantLocked(token, grant, actionDigest("bookmark:add", input)); err != nil {
		return Bookmark{}, err
	}
	for _, b := range c.state.Bookmarks {
		if b.URL == input.URL {
			return Bookmark{}, ErrConflict
		}
	}
	b := Bookmark{ID: randomID(), Name: input.Name, URL: input.URL}
	next := c.state
	next.Bookmarks = append(append([]Bookmark(nil), next.Bookmarks...), b)
	next.DirectoryRevision++
	c.auditLocked(&next, "bookmark_add", "committed", b.ID)
	if err = c.saveLocked(next); err != nil {
		return Bookmark{}, err
	}
	return b, nil
}
func (c *Center) removeBookmark(token, id string, expected int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.sessionLocked(token); err != nil {
		return err
	}
	if expected != c.state.DirectoryRevision {
		return ErrConflict
	}
	next := c.state
	next.Bookmarks = nil
	found := false
	for _, b := range c.state.Bookmarks {
		if b.ID == id {
			found = true
		} else {
			next.Bookmarks = append(next.Bookmarks, b)
		}
	}
	if !found {
		return ErrDenied
	}
	next.DirectoryRevision++
	return c.saveLocked(next)
}

// RotateRouteInput binds both Center's directory revision and the separately
// obtained Runtime consent revision. Rotation does not approve its new key.
type RotateRouteInput struct {
	ID               string `json:"id"`
	ExpectedRevision int64  `json:"expected_revision"`
	BindingRevision  int64  `json:"binding_revision"`
}

func (c *Center) rotateRoute(token, grant string, input RotateRouteInput) (webbinding.Binding, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.grantLocked(token, grant, actionDigest("route:rotate", input)); err != nil {
		return webbinding.Binding{}, err
	}
	if input.ExpectedRevision != c.state.DirectoryRevision {
		return webbinding.Binding{}, ErrConflict
	}
	if input.BindingRevision < 1 {
		return webbinding.Binding{}, ErrDenied
	}
	for i, route := range c.state.Routes {
		if route.ID != input.ID {
			continue
		}
		cert, key, leaf, err := newClientCertificate(c.key.Instance, c.now())
		if err != nil {
			return webbinding.Binding{}, err
		}
		route.Certificate, route.PrivateKey = cert, key
		route.BindingRevision = input.BindingRevision
		route.Revision++
		next := c.state
		next.Routes = append([]Route(nil), c.state.Routes...)
		next.Routes[i] = route
		next.DirectoryRevision++
		c.auditLocked(&next, "route_rotate", "awaiting_runtime_consent", route.ID)
		if err := c.saveLocked(next); err != nil {
			return webbinding.Binding{}, err
		}
		return webbinding.Binding{ID: route.ID, RuntimeID: route.RuntimeID, AppScope: "envapp", Origin: route.Origin, PublicKeySHA256: webbinding.PublicKeyFingerprint(leaf), Enabled: true, Revision: input.BindingRevision}, nil
	}
	return webbinding.Binding{}, ErrDenied
}
