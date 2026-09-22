package appserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/browserstore"
)

// Browser product state belongs to the environment runtime. Opening this surface
// never acquires an AI service lease or depends on model configuration.
func (g *Server) requireBrowserRuntime(w http.ResponseWriter) bool {
	if g != nil && g.browserRuntime != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "browser_unavailable"})
	return false
}

func (g *Server) handleBrowserLibraryAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || r.URL == nil || !strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/browser/library/") {
		return false
	}
	meta, ok := g.requirePermission(w, r, requiredPermissionFull)
	if !ok || !g.requireBrowserRuntime(w) {
		return true
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/browser/library/profiles":
		profiles, err := g.browserRuntime.BrowserLibraryProfiles(r.Context(), meta)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: profiles})
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/browser/library/profile":
		var profile browserstore.Profile
		if !decodeBrowserRequest(w, r, 2048, &profile) {
			return true
		}
		if err := g.browserRuntime.SaveBrowserLibraryProfile(r.Context(), meta, profile); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_profile_failed"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true})
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/browser/library/tabs":
		tabs, err := g.browserRuntime.BrowserLibraryTabs(r.Context(), meta, r.URL.Query().Get("profile_id"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: tabs})
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/browser/library/bookmarks":
		bookmarks, err := g.browserRuntime.BrowserBookmarks(r.Context(), meta, r.URL.Query().Get("profile_id"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: bookmarks})
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/browser/library/history":
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		history, err := g.browserRuntime.BrowserHistory(r.Context(), meta, r.URL.Query().Get("profile_id"), r.URL.Query().Get("q"), limit)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: history})
		return true
	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/browser/library/bookmark":
		var body struct {
			ProfileID string `json:"profile_id"`
			URL       string `json:"url"`
			Title     string `json:"title"`
		}
		if !decodeBrowserRequest(w, r, 16384, &body) {
			return true
		}
		err := g.browserRuntime.SaveBrowserBookmark(r.Context(), meta, body.ProfileID, browserstore.Entry{URL: body.URL, Title: body.Title})
		writeBrowserLibraryMutation(w, err)
		return true
	case r.Method == http.MethodDelete && r.URL.Path == "/_redeven_proxy/api/browser/library/bookmark":
		var body struct {
			ProfileID string `json:"profile_id"`
			URL       string `json:"url"`
		}
		if !decodeBrowserRequest(w, r, 16384, &body) {
			return true
		}
		writeBrowserLibraryMutation(w, g.browserRuntime.DeleteBrowserBookmark(r.Context(), meta, body.ProfileID, body.URL))
		return true
	case r.Method == http.MethodDelete && r.URL.Path == "/_redeven_proxy/api/browser/library/history":
		writeBrowserLibraryMutation(w, g.browserRuntime.ClearBrowserHistory(r.Context(), meta, r.URL.Query().Get("profile_id")))
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/browser/library/zoom":
		zoom, err := g.browserRuntime.BrowserZoom(r.Context(), meta, r.URL.Query().Get("profile_id"), r.URL.Query().Get("origin"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]float64{"zoom": zoom}})
		return true
	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/browser/library/zoom":
		var body struct {
			ProfileID string  `json:"profile_id"`
			Origin    string  `json:"origin"`
			Zoom      float64 `json:"zoom"`
		}
		if !decodeBrowserRequest(w, r, 16384, &body) {
			return true
		}
		writeBrowserLibraryMutation(w, g.browserRuntime.SaveBrowserZoom(r.Context(), meta, body.ProfileID, body.Origin, body.Zoom))
		return true

	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func decodeBrowserRequest(w http.ResponseWriter, r *http.Request, limit int64, value any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if dec.Decode(value) != nil || dec.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid_json"})
		return false
	}
	return true
}

func writeBrowserLibraryMutation(w http.ResponseWriter, err error) {
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_library_update_failed"})
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true})
}
