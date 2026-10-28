package webbinding

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
)

// ApplicationOrigin is deterministic from an already owner-approved Env origin
// and one exact application. It grants no permission and never selects a target.
func ApplicationOrigin(origin, kind, id string) (string, error) {
	if ValidateOrigin(origin) != nil || (kind != "cs" && kind != "pf") || !validID(id) || len(id) > 64 {
		return "", ErrDenied
	}
	u, _ := url.Parse(origin)
	_, suffix, ok := strings.Cut(u.Hostname(), ".")
	if !ok || suffix == "" {
		return "", ErrDenied
	}
	hash := sha256.Sum256([]byte(origin + "\x00" + kind + "\x00" + id))
	host := "app-" + hex.EncodeToString(hash[:20]) + "." + suffix
	if u.Port() != "" {
		host += ":" + u.Port()
	}
	return "https://" + host, nil
}
