package appserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

// uiCacheScope identifies presentation data only. It never grants request authority.
func uiCacheScope(meta *session.Meta) string {
	identity, _ := json.Marshal([]string{"redeven-ui-cache-v1", meta.EndpointID, meta.NamespacePublicID, meta.UserPublicID})
	digest := sha256.Sum256(identity)
	return hex.EncodeToString(digest[:])
}

func (g *Server) handleUICacheScope(w http.ResponseWriter, r *http.Request) {
	meta, ok := g.requirePermission(w, r, requiredPermissionRead)
	if !ok {
		return
	}
	if strings.TrimSpace(meta.EndpointID) == "" || strings.TrimSpace(meta.UserPublicID) == "" {
		writeJSON(w, http.StatusUnauthorized, apiResp{OK: false, Error: "cache identity unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]string{"scope_id": uiCacheScope(meta)}})
}
