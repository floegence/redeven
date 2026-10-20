package appserver

import (
	"net/http"

	"github.com/floegence/redeven/internal/directoryfavorites"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func (g *Server) handleDirectoryFavoritesAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/_redeven_proxy/api/fs/directory_favorites" {
		return false
	}
	w.Header().Set("Cache-Control", "private, no-store")
	meta, ok := g.requirePermission(w, r, requiredPermissionRead)
	if !ok {
		return true
	}
	if g.directoryFavorites == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "directory favorites service not ready"})
		return true
	}
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "unexpected query"})
		return true
	}
	scope := directoryfavorites.Scope{Namespace: meta.NamespacePublicID, Endpoint: meta.EndpointID, User: meta.UserPublicID}
	var out directoryfavorites.Snapshot
	var err error
	switch r.Method {
	case http.MethodGet:
		out, err = g.directoryFavorites.Snapshot(r.Context(), scope)
	case http.MethodPut, http.MethodDelete:
		var body struct {
			Path string `json:"path"`
		}
		if err = decodeNotesJSON(http.MaxBytesReader(w, r.Body, 64<<10), &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		path, normalizeErr := directoryfavorites.NormalizePath(body.Path)
		if normalizeErr != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: normalizeErr.Error()})
			return true
		}
		if r.Method == http.MethodPut {
			resolved, resolveErr := g.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
			if resolveErr == nil && !resolved.Permissions.Read {
				resolveErr = filesystemscope.ErrReadDenied
			}
			if resolveErr == nil {
				_, resolveErr = g.fs.ListDirectory(path, false)
			}
			if resolveErr != nil {
				status, message := fsListHTTPError(resolveErr)
				writeJSON(w, status, apiResp{OK: false, Error: message})
				return true
			}
		}
		out, err = g.directoryFavorites.Set(r.Context(), scope, path, r.Method == http.MethodPut)
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: "method not allowed"})
		return true
	}
	if err != nil {
		g.log.Error("directory favorites request failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "directory favorites unavailable"})
		return true
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
	return true
}
