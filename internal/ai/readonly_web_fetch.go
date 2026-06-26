package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	webFetchMaxBodyBytes   int64 = 5 << 20
	webFetchDefaultTimeout       = 30 * time.Second
	webFetchMaxTimeout           = 120 * time.Second
	webFetchMaxRedirects         = 5
	webFetchUserAgent            = "Redeven-Flower-WebFetch/1.0"
	webFetchDefaultFormat        = "markdown"
)

type webFetchResolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

type netDefaultResolver struct{}

func (netDefaultResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

type webFetchArgs struct {
	URL            string `json:"url"`
	Format         string `json:"format"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type webFetchResult struct {
	RequestedURL  string   `json:"requested_url"`
	FinalURL      string   `json:"final_url"`
	ContentType   string   `json:"content_type"`
	Format        string   `json:"format"`
	Output        string   `json:"output"`
	BodyBytes     int64    `json:"body_bytes"`
	RedirectChain []string `json:"redirect_chain,omitempty"`
}

func (r *run) toolWebFetch(ctx context.Context, args webFetchArgs) (webFetchResult, error) {
	requestedURL := strings.TrimSpace(args.URL)
	if requestedURL == "" {
		return webFetchResult{}, errors.New("url is required")
	}
	format := strings.ToLower(strings.TrimSpace(args.Format))
	if format == "" {
		format = webFetchDefaultFormat
	}
	if format != "markdown" && format != "text" {
		return webFetchResult{}, errors.New("format must be markdown or text")
	}
	timeout := webFetchDefaultTimeout
	if args.TimeoutSeconds > 0 {
		timeout = time.Duration(args.TimeoutSeconds) * time.Second
	}
	if timeout > webFetchMaxTimeout {
		timeout = webFetchMaxTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resolver := r.webFetchResolver
	if resolver == nil {
		resolver = netDefaultResolver{}
	}
	client := r.webFetchClient(resolver)
	current, err := parseAndValidateWebFetchURL(ctx, resolver, requestedURL)
	if err != nil {
		return webFetchResult{}, err
	}
	redirectChain := make([]string, 0, webFetchMaxRedirects)
	for redirects := 0; ; redirects++ {
		if redirects > webFetchMaxRedirects {
			return webFetchResult{}, errors.New("too many redirects")
		}
		resp, err := executeWebFetchRequest(ctx, client, current, format)
		if err != nil {
			return webFetchResult{}, err
		}
		if isWebFetchRedirect(resp.StatusCode) {
			location := strings.TrimSpace(resp.Header.Get("Location"))
			_ = resp.Body.Close()
			if location == "" {
				return webFetchResult{}, errors.New("redirect missing location")
			}
			nextURL, err := current.Parse(location)
			if err != nil {
				return webFetchResult{}, errors.New("invalid redirect location")
			}
			next, err := parseAndValidateWebFetchURL(ctx, resolver, nextURL.String())
			if err != nil {
				return webFetchResult{}, err
			}
			redirectChain = append(redirectChain, next.String())
			current = next
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return webFetchResult{}, fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
		}
		contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
		mimeType, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			mimeType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
			params = nil
		}
		if !isWebFetchTextualMIME(mimeType) {
			return webFetchResult{}, fmt.Errorf("unsupported content type %q", firstNonEmptyString(mimeType, contentType))
		}
		body, err := readBoundedWebFetchBody(resp)
		if err != nil {
			return webFetchResult{}, err
		}
		text, err := decodeWebFetchText(body, params)
		if err != nil {
			return webFetchResult{}, err
		}
		output := text
		if strings.Contains(strings.ToLower(mimeType), "html") {
			output = htmlToSafeText(text)
			if format == "markdown" {
				output = htmlTextToMarkdown(output)
			}
		}
		return webFetchResult{
			RequestedURL:  requestedURL,
			FinalURL:      current.String(),
			ContentType:   contentType,
			Format:        format,
			Output:        output,
			BodyBytes:     int64(len(body)),
			RedirectChain: redirectChain,
		}, nil
	}
}

func (r *run) webFetchClient(resolver webFetchResolver) *http.Client {
	if r != nil && r.webFetchHTTPClient != nil {
		return r.webFetchHTTPClient
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:       nil,
			DialContext: secureWebFetchDialer(resolver),
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func secureWebFetchDialer(resolver webFetchResolver) func(context.Context, string, string) (net.Conn, error) {
	if resolver == nil {
		resolver = netDefaultResolver{}
	}
	dialer := &net.Dialer{}
	return func(ctx context.Context, network string, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := resolveWebFetchHost(ctx, resolver, strings.Trim(host, "[]"))
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !isPublicWebFetchIP(ip) {
				continue
			}
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, errors.New("no allowed address available")
	}
}

func executeWebFetchRequest(ctx context.Context, client *http.Client, target *url.URL, format string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", webFetchUserAgent)
	req.Header.Set("Accept", webFetchAcceptHeader(format))
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Accept-Encoding", "identity")
	return client.Do(req)
}

func parseAndValidateWebFetchURL(ctx context.Context, resolver webFetchResolver, rawURL string) (*url.URL, error) {
	if strings.ContainsRune(rawURL, 0) {
		return nil, errors.New("invalid url")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, errors.New("invalid url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("url must use http or https")
	}
	if parsed.User != nil {
		return nil, errors.New("url userinfo is not allowed")
	}
	if strings.TrimSpace(parsed.Host) == "" || strings.TrimSpace(parsed.Hostname()) == "" {
		return nil, errors.New("url host is required")
	}
	if parsed.Port() != "" && parsed.Port() != "80" && parsed.Port() != "443" {
		return nil, errors.New("url port is not allowed")
	}
	host := strings.Trim(parsed.Hostname(), "[]")
	if strings.Contains(host, "%") {
		return nil, errors.New("url host zone id is not allowed")
	}
	ips, err := resolveWebFetchHost(ctx, resolver, host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if !isPublicWebFetchIP(ip) {
			return nil, errors.New("url host resolves to a blocked address")
		}
	}
	return parsed, nil
}

func resolveWebFetchHost(ctx context.Context, resolver webFetchResolver, host string) ([]netip.Addr, error) {
	if ip, ok := parseWebFetchHostIP(host); ok {
		return []netip.Addr{ip}, nil
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return nil, errors.New("localhost is not allowed")
	}
	if resolver == nil {
		resolver = netDefaultResolver{}
	}
	addrs, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(addrs) == 0 {
		return nil, errors.New("host did not resolve")
	}
	out := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		ip, ok := netip.AddrFromSlice(addr.IP)
		if !ok {
			return nil, errors.New("invalid resolved address")
		}
		out = append(out, ip.Unmap())
	}
	return out, nil
}

func parseWebFetchHostIP(host string) (netip.Addr, bool) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Unmap(), true
	}
	if ip := net.ParseIP(host); ip != nil {
		if addr, ok := netip.AddrFromSlice(ip); ok {
			return addr.Unmap(), true
		}
	}
	if encoded, ok := parseIPv4EncodedHost(host); ok {
		return encoded, true
	}
	return netip.Addr{}, false
}

func parseIPv4EncodedHost(host string) (netip.Addr, bool) {
	if strings.ContainsAny(host, ":") || strings.TrimSpace(host) == "" {
		return netip.Addr{}, false
	}
	parts := strings.Split(host, ".")
	if len(parts) > 4 {
		return netip.Addr{}, false
	}
	values := make([]uint64, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			return netip.Addr{}, false
		}
		base := 10
		valueText := part
		if strings.HasPrefix(valueText, "0x") || strings.HasPrefix(valueText, "0X") {
			base = 16
			valueText = valueText[2:]
		} else if len(valueText) > 1 && strings.HasPrefix(valueText, "0") {
			base = 8
		}
		value, err := strconv.ParseUint(valueText, base, 32)
		if err != nil {
			return netip.Addr{}, false
		}
		values = append(values, value)
	}
	var ipv4 uint32
	switch len(values) {
	case 1:
		ipv4 = uint32(values[0])
	case 2:
		if values[0] > 255 || values[1] > 0xFFFFFF {
			return netip.Addr{}, false
		}
		ipv4 = uint32(values[0]<<24 | values[1])
	case 3:
		if values[0] > 255 || values[1] > 255 || values[2] > 0xFFFF {
			return netip.Addr{}, false
		}
		ipv4 = uint32(values[0]<<24 | values[1]<<16 | values[2])
	case 4:
		for _, value := range values {
			if value > 255 {
				return netip.Addr{}, false
			}
		}
		ipv4 = uint32(values[0]<<24 | values[1]<<16 | values[2]<<8 | values[3])
	default:
		return netip.Addr{}, false
	}
	return netip.AddrFrom4([4]byte{byte(ipv4 >> 24), byte(ipv4 >> 16), byte(ipv4 >> 8), byte(ipv4)}), true
}

func isPublicWebFetchIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if ip.Is4() {
		if addrInPrefix(ip, "0.0.0.0/8") ||
			addrInPrefix(ip, "100.64.0.0/10") ||
			addrInPrefix(ip, "127.0.0.0/8") ||
			addrInPrefix(ip, "169.254.0.0/16") ||
			addrInPrefix(ip, "192.0.0.0/24") ||
			addrInPrefix(ip, "192.0.2.0/24") ||
			addrInPrefix(ip, "198.18.0.0/15") ||
			addrInPrefix(ip, "198.51.100.0/24") ||
			addrInPrefix(ip, "203.0.113.0/24") ||
			addrInPrefix(ip, "224.0.0.0/4") ||
			addrInPrefix(ip, "240.0.0.0/4") {
			return false
		}
	}
	if ip.Is6() {
		if addrInPrefix(ip, "::/128") ||
			addrInPrefix(ip, "::1/128") ||
			addrInPrefix(ip, "64:ff9b::/96") ||
			addrInPrefix(ip, "100::/64") ||
			addrInPrefix(ip, "2001::/23") ||
			addrInPrefix(ip, "2001:db8::/32") ||
			addrInPrefix(ip, "fc00::/7") ||
			addrInPrefix(ip, "fe80::/10") ||
			addrInPrefix(ip, "ff00::/8") {
			return false
		}
	}
	return true
}

func addrInPrefix(ip netip.Addr, prefix string) bool {
	p, err := netip.ParsePrefix(prefix)
	return err == nil && p.Contains(ip)
}

func isWebFetchRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	default:
		return false
	}
}

func readBoundedWebFetchBody(resp *http.Response) ([]byte, error) {
	if resp.ContentLength > webFetchMaxBodyBytes {
		return nil, errors.New("response too large")
	}
	limited := io.LimitReader(resp.Body, webFetchMaxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > webFetchMaxBodyBytes {
		return nil, errors.New("response too large")
	}
	return body, nil
}

func decodeWebFetchText(body []byte, params map[string]string) (string, error) {
	if charset := strings.ToLower(strings.TrimSpace(params["charset"])); charset != "" && charset != "utf-8" && charset != "us-ascii" {
		return "", fmt.Errorf("unsupported charset %q", charset)
	}
	body = bytes.TrimPrefix(body, []byte{0xEF, 0xBB, 0xBF})
	if !utf8.Valid(body) {
		return "", errors.New("invalid text encoding")
	}
	return string(body), nil
}

func isWebFetchTextualMIME(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	return mimeType == "" ||
		strings.HasPrefix(mimeType, "text/") ||
		mimeType == "application/json" ||
		strings.HasSuffix(mimeType, "+json") ||
		mimeType == "application/xml" ||
		strings.HasSuffix(mimeType, "+xml") ||
		mimeType == "application/javascript" ||
		mimeType == "application/x-javascript" ||
		mimeType == "image/svg+xml"
}

func webFetchAcceptHeader(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "text":
		return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, application/json;q=0.7, */*;q=0.1"
	default:
		return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, application/json;q=0.6, */*;q=0.1"
	}
}

func htmlToSafeText(html string) string {
	safe := html
	for _, tag := range []string{"script", "style", "noscript", "iframe", "object", "embed"} {
		re := regexp.MustCompile(`(?is)<` + tag + `\b[^>]*>.*?</\s*` + tag + `\s*>`)
		safe = re.ReplaceAllString(safe, "")
	}
	for _, tag := range []string{"meta", "link"} {
		re := regexp.MustCompile(`(?is)<` + tag + `\b[^>]*>`)
		safe = re.ReplaceAllString(safe, "")
	}
	tagRE := regexp.MustCompile(`(?s)<[^>]+>`)
	safe = tagRE.ReplaceAllString(safe, " ")
	spaceRE := regexp.MustCompile(`[ \t\r\n]+`)
	return strings.TrimSpace(spaceRE.ReplaceAllString(safe, " "))
}

func htmlTextToMarkdown(text string) string {
	return text
}
