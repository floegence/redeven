package ui

import (
	"bytes"
	"io/fs"
	"net/http"
	"strings"
)

// ServeAccessPage renders the Runtime-owned login page for a bookmarked
// resource. The server selects the trust surface; URL parameters cannot change it.
func ServeAccessPage(w http.ResponseWriter, r *http.Request, local bool) bool {
	if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		return false
	}
	page, err := fs.ReadFile(DistFS(), "env/access.html")
	if err != nil {
		http.Error(w, "authentication page unavailable", http.StatusServiceUnavailable)
		return true
	}
	if local {
		page = bytes.Replace(page, []byte("<html"), []byte(`<html data-redeven-local-access="true"`), 1)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		_, _ = w.Write(page)
	}
	return true
}
