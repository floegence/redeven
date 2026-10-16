package appserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"golang.org/x/net/html"
)

const flowerIconTTL = 90 * 24 * time.Hour
const flowerIconFailureTTL = 24 * time.Hour
const flowerIconMaxBytes = 256 << 10

type flowerSourceIcon struct {
	DataURL   string    `json:"data_url,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
}
type flowerIconFlight struct {
	done chan struct{}
	icon flowerSourceIcon
}
type flowerIconCache struct {
	dir     string
	client  *http.Client
	now     func() time.Time
	mu      sync.Mutex
	flights map[string]*flowerIconFlight
	icons   map[string]flowerSourceIcon
	slots   chan struct{}
}

func newFlowerIconCache(stateDir string) *flowerIconCache {
	dir := ""
	if stateDir != "" {
		dir = filepath.Join(stateDir, "cache", "flower-source-icons")
	}
	transport := &http.Transport{DialContext: dialFlowerIcon, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 3 * time.Second, MaxResponseHeaderBytes: 32 << 10, MaxIdleConns: 4, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second}
	return &flowerIconCache{dir: dir, now: time.Now, flights: make(map[string]*flowerIconFlight), icons: make(map[string]flowerSourceIcon), slots: make(chan struct{}, 4), client: &http.Client{Transport: transport, Timeout: 6 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many icon redirects")
		}
		if err := validFlowerIconURL(r.URL); err != nil {
			return err
		}
		if via[0].URL.Scheme == "https" && r.URL.Scheme != "https" {
			return errors.New("insecure icon redirect")
		}
		return nil
	}}}
}

func (g *Server) handleFlowerSourceIcon(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	values := r.URL.Query()
	origin, err := flowerIconOrigin(values.Get("origin"))
	if err != nil || len(values) != 1 || len(values["origin"]) != 1 {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid source origin"})
		return
	}
	g.sourceIconsOnce.Do(func() { g.sourceIcons = newFlowerIconCache(g.stateDir) })
	icon := g.sourceIcons.get(r.Context(), origin)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: icon})
}

func flowerIconOrigin(raw string) (string, error) {
	if len(raw) > 2048 {
		return "", errors.New("origin too long")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if err = validFlowerIconURL(u); err != nil {
		return "", err
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("expected origin")
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

func validFlowerIconURL(u *url.URL) error {
	if u == nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Opaque != "" || len(u.String()) > 4096 {
		return errors.New("invalid icon URL")
	}
	host := u.Hostname()
	if host == "" || strings.HasSuffix(host, ".") || strings.ContainsAny(host, "%\\ \t\r\n") || (u.Port() != "" && !((u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80"))) {
		return errors.New("invalid icon host")
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		if !publicFlowerIconIP(ip) {
			return errors.New("nonpublic icon host")
		}
	} else if !strings.Contains(host, ".") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return errors.New("nonpublic icon host")
	}
	return nil
}

var flowerIconExcludedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("3fff::/20"),
}

func publicFlowerIconIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, p := range flowerIconExcludedNetworks {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}
func dialFlowerIcon(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("icon host has no addresses")
	}
	for _, ip := range ips {
		if !publicFlowerIconIP(ip) {
			return nil, errors.New("icon host resolved to a nonpublic address")
		}
	}
	// Dial the checked address directly, preventing a second DNS resolution.
	return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].Unmap().String(), port))
}

func (c *flowerIconCache) path(origin string) string {
	hash := sha256.Sum256([]byte(origin))
	return filepath.Join(c.dir, hex.EncodeToString(hash[:])+".json")
}
func (c *flowerIconCache) get(ctx context.Context, origin string) flowerSourceIcon {
	now := c.now()
	c.mu.Lock()
	cached, exists := c.icons[origin]
	c.mu.Unlock()
	if exists && cached.ExpiresAt.After(now) {
		return cached
	}
	if c.dir != "" {
		f, err := os.Open(c.path(origin))
		if err == nil {
			var icon flowerSourceIcon
			err = json.NewDecoder(io.LimitReader(f, flowerIconMaxBytes*2)).Decode(&icon)
			_ = f.Close()
			if err == nil && icon.ExpiresAt.After(now) && !icon.ExpiresAt.After(now.Add(flowerIconTTL)) && validCachedFlowerIcon(icon.DataURL) {
				c.mu.Lock()
				c.remember(origin, icon)
				c.mu.Unlock()
				return icon
			}
		}
	}
	c.mu.Lock()
	if icon, ok := c.icons[origin]; ok && icon.ExpiresAt.After(now) {
		c.mu.Unlock()
		return icon
	}
	flight := c.flights[origin]
	if flight == nil {
		select {
		case c.slots <- struct{}{}:
			flight = &flowerIconFlight{done: make(chan struct{})}
			c.flights[origin] = flight
			go func() {
				fetchCtx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
				defer cancel()
				icon := flowerSourceIcon{ExpiresAt: c.now().Add(flowerIconFailureTTL)}
				if data := c.fetch(fetchCtx, origin); data != "" {
					icon = flowerSourceIcon{DataURL: data, ExpiresAt: c.now().Add(flowerIconTTL)}
				}
				c.store(origin, icon)
				c.mu.Lock()
				c.remember(origin, icon)
				flight.icon = icon
				delete(c.flights, origin)
				close(flight.done)
				<-c.slots
				c.mu.Unlock()
			}()
		default:
			c.mu.Unlock()
			return flowerSourceIcon{ExpiresAt: now.Add(time.Minute)}
		}
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return flowerSourceIcon{ExpiresAt: now.Add(time.Minute)}
	case <-flight.done:
		return flight.icon
	}
}

// The icon mutex protects only bounded process-local maps, never network work.
func (c *flowerIconCache) remember(origin string, icon flowerSourceIcon) {
	if len(c.icons) >= 128 {
		for key := range c.icons {
			delete(c.icons, key)
			break
		}
	}
	c.icons[origin] = icon
}
func validCachedFlowerIcon(data string) bool {
	if data == "" {
		return true
	}
	for _, kind := range []string{"png", "jpeg", "gif", "x-icon", "svg+xml"} {
		prefix := "data:image/" + kind + ";base64,"
		if strings.HasPrefix(data, prefix) {
			b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, prefix))
			return err == nil && len(b) <= flowerIconMaxBytes && flowerIconData(b) == data
		}
	}
	return false
}
func (c *flowerIconCache) store(origin string, icon flowerSourceIcon) {
	if c.dir == "" || os.MkdirAll(c.dir, 0700) != nil {
		return
	}
	b, err := json.Marshal(icon)
	if err != nil {
		return
	}
	f, err := os.CreateTemp(c.dir, ".icon-*")
	if err != nil {
		return
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err != nil {
		_ = f.Close()
		return
	}
	if f.Close() != nil {
		return
	}
	_ = os.Rename(f.Name(), c.path(origin))
}
func (c *flowerIconCache) read(ctx context.Context, address string) ([]byte, *url.URL) {
	u, err := url.Parse(address)
	if err != nil || validFlowerIconURL(u) != nil {
		return nil, nil
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, nil
	}
	r.Header.Set("User-Agent", "Redeven-Source-Icons/1.0")
	r.Header.Set("Accept", "image/*,text/html;q=0.8")
	resp, err := c.client.Do(r)
	if err != nil {
		return nil, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, flowerIconMaxBytes+1))
	if err != nil || len(b) > flowerIconMaxBytes {
		return nil, nil
	}
	return b, resp.Request.URL
}
func (c *flowerIconCache) fetch(ctx context.Context, origin string) string {
	b, _ := c.read(ctx, origin+"/favicon.ico")
	if data := flowerIconData(b); data != "" {
		return data
	}
	body, page := c.read(ctx, origin+"/")
	if page == nil {
		return ""
	}
	tokenizer := html.NewTokenizer(bytes.NewReader(body))
	candidates := []string{}
	for {
		token := tokenizer.Next()
		if token == html.ErrorToken {
			break
		}
		if token != html.StartTagToken && token != html.SelfClosingTagToken {
			continue
		}
		t := tokenizer.Token()
		if t.Data != "link" {
			continue
		}
		var href, rel string
		for _, a := range t.Attr {
			if a.Key == "href" {
				href = a.Val
			}
			if a.Key == "rel" {
				rel = strings.ToLower(a.Val)
			}
		}
		icon := false
		for _, r := range strings.Fields(rel) {
			if r == "icon" || r == "apple-touch-icon" {
				icon = true
			}
		}
		if !icon || href == "" {
			continue
		}
		u, err := page.Parse(href)
		if err != nil || validFlowerIconURL(u) != nil || (page.Scheme == "https" && u.Scheme != "https") {
			continue
		}
		candidates = append(candidates, u.String())
		if len(candidates) == 3 {
			break
		}
	}
	for _, address := range candidates {
		b, _ := c.read(ctx, address)
		if data := flowerIconData(b); data != "" {
			return data
		}
	}
	return ""
}

// Decode bounded raster dimensions and reduce large images before retaining them.
// SVGs accept only self-contained vector geometry; active content is rejected.
func flowerIconData(b []byte) string {
	if len(b) == 0 || len(b) > flowerIconMaxBytes {
		return ""
	}
	kind := ""
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err == nil {
		if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 1024 || cfg.Height > 1024 {
			return ""
		}
		if format == "png" || format == "jpeg" || format == "gif" {
			kind = format
		} else if format != "webp" {
			return ""
		}
		if cfg.Width > 64 || cfg.Height > 64 || format == "webp" {
			src, _, err := image.Decode(bytes.NewReader(b))
			if err != nil {
				return ""
			}
			w, h := cfg.Width, cfg.Height
			if w > 64 || h > 64 {
				if w >= h {
					h = max(1, h*64/w)
					w = 64
				} else {
					w = max(1, w*64/h)
					h = 64
				}
			}
			dst := image.NewNRGBA(image.Rect(0, 0, w, h))
			draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
			var out bytes.Buffer
			if png.Encode(&out, dst) != nil {
				return ""
			}
			b = out.Bytes()
			kind = "png"
		}
	} else if len(b) >= 22 && bytes.Equal(b[:4], []byte{0, 0, 1, 0}) {
		count := int(binary.LittleEndian.Uint16(b[4:6]))
		if count < 1 || count > 64 || len(b) < 6+16*count {
			return ""
		}
		for i := 0; i < count; i++ {
			entry := b[6+16*i : 6+16*(i+1)]
			size := uint64(binary.LittleEndian.Uint32(entry[8:12]))
			offset := uint64(binary.LittleEndian.Uint32(entry[12:16]))
			if size < 8 || offset < uint64(6+16*count) || offset+size > uint64(len(b)) {
				return ""
			}
		}
		kind = "x-icon"
	} else if validFlowerIconSVG(b) {
		kind = "svg+xml"
	} else {
		return ""
	}
	return "data:image/" + kind + ";base64," + base64.StdEncoding.EncodeToString(b)
}
func validFlowerIconSVG(b []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(b))
	root := false
	depth := 0
	allowed := " svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask use title desc "
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return root && depth == 0
		}
		if err != nil {
			return false
		}
		switch t := token.(type) {
		case xml.StartElement:
			if !strings.Contains(allowed, " "+t.Name.Local+" ") || (t.Name.Space != "" && t.Name.Space != "http://www.w3.org/2000/svg") {
				return false
			}
			if depth == 0 {
				if root || t.Name.Local != "svg" {
					return false
				}
				root = true
			}
			depth++
			for _, a := range t.Attr {
				name := strings.ToLower(a.Name.Local)
				value := strings.ToLower(strings.TrimSpace(a.Value))
				if strings.HasPrefix(name, "on") || name == "style" || (name == "href" && !strings.HasPrefix(value, "#")) || strings.Contains(value, "url(") && (!strings.HasPrefix(value, "url(#") || !strings.HasSuffix(value, ")")) {
					return false
				}
			}
		case xml.EndElement:
			depth--
		case xml.Directive:
			return false
		case xml.ProcInst:
			if t.Target != "xml" {
				return false
			}
		}
	}
}
