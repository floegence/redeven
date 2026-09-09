package appserver

import (
	"net/url"
	"regexp"
	"strconv"
)

var nativeBrowserHost = regexp.MustCompile(`^cs-[a-f0-9]{40}\.localhost$`)

// NativeCodeSpaceOrigin accepts only Desktop-owned loopback presentation origins.
// This value controls editor Host presentation, never the Runtime dial target.
func NativeCodeSpaceOrigin(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u == nil || len(raw) > 128 || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && !nativeBrowserHost.MatchString(u.Hostname())) || u.String() != u.Scheme+"://"+u.Host {
		return nil, false
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, false
	}
	return u, true
}
