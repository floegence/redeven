package appserver

import (
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

func browserFileUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "browser_file_unavailable"})
}

func (g *Server) serveBrowserFile(w http.ResponseWriter, r *http.Request, meta *session.Meta, view, kind string) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(r.URL.RawQuery) > 16384 {
		browserFileUnavailable(w)
		return
	}
	for _, values := range query {
		if len(values) != 1 {
			browserFileUnavailable(w)
			return
		}
	}
	if !isDistRequestMethod(r.Method) {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var response *http.Response
	if kind == "download" {
		response, err = g.browserRuntime.OpenBrowserDownload(r.Context(), meta, view, query.Get("target"), query.Get("id"))
	} else {
		response, err = g.browserRuntime.OpenBrowserResource(r.Context(), meta, view, query.Get("target"), query.Get("id"))
	}
	if err != nil {
		browserFileUnavailable(w)
		return
	}
	defer response.Body.Close()
	// Never forward source response headers, cookies, redirects or source URLs.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	if length := response.Header.Get("Content-Length"); length != "" {
		w.Header().Set("Content-Length", length)
	}
	if kind == "download" {
		name, err := url.PathUnescape(response.Header.Get("X-Browser-Filename"))
		if err != nil || name == "" {
			name = "download"
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		if _, err := io.CopyBuffer(w, response.Body, make([]byte, 32*1024)); err != nil {
			// A partial file must terminate the HTTP carrier, not appear complete.
			panic(http.ErrAbortHandler)
		}
	}
}

var browserDocumentInstance = regexp.MustCompile(`^[a-zA-Z0-9-]{16,128}$`)

// This static shell has no view identity or source data. Its authenticated
// environment owner lends named browser operations over nonce-bound ports;
// every view, resource and download request retains the owner's exact Session.
func (g *Server) serveBrowserDocument(w http.ResponseWriter, r *http.Request) bool {
	const path = "/_redeven_proxy/env/browser/"
	if !strings.HasPrefix(r.URL.Path, path) {
		return false
	}
	if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
		return true
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if !isDistRequestMethod(r.Method) || r.URL.Path != path || err != nil || len(query) != 1 || len(query["instance"]) != 1 || !browserDocumentInstance.MatchString(query.Get("instance")) {
		browserFileUnavailable(w)
		return true
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	g.serveDistFile(w, r, "env/browser.html")
	return true
}
