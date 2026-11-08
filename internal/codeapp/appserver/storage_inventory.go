package appserver

import (
	"context"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/storagecontract"
)

func (g *Server) handleStorageInventory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
		return
	}
	if g.stateDir == "" || g.stateDir == "." {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "Storage is unavailable"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"entries": storagecontract.Inventory(ctx, g.stateDir)}})
}
