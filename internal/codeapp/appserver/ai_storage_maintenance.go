package appserver

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/floegence/redeven/internal/ai"
)

func (g *Server) handleFlowerSnapshots(w http.ResponseWriter, r *http.Request) {
	meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
	if !ok {
		return
	}
	maintenance, ok := g.aiProvider.(AIStorageMaintenanceProvider)
	if !ok {
		writeAIServiceUnavailable(w, g.aiReadinessSnapshot())
		return
	}
	items, err := maintenance.ListFlowerSnapshots(r.Context())
	if err != nil {
		g.appendAudit(meta, "ai_snapshots_list", "failure", nil, err)
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "Flower backups could not be read", ErrorCode: "AI_BACKUP_LIST_FAILED"})
		return
	}
	if items == nil {
		items = []ai.FlowerSnapshotSummary{}
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"snapshots": items}})
}

func (g *Server) handleFlowerRestore(w http.ResponseWriter, r *http.Request) {
	meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
	if !ok {
		return
	}
	maintenance, ok := g.aiProvider.(AIStorageMaintenanceProvider)
	if !ok {
		writeAIServiceUnavailable(w, g.aiReadinessSnapshot())
		return
	}
	var request struct {
		SnapshotID string `json:"snapshot_id"`
		Confirmed  bool   `json:"confirmed"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "Invalid restore request"})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "Invalid restore request"})
		return
	}
	id, err := hex.DecodeString(request.SnapshotID)
	if err != nil || len(id) != 16 || hex.EncodeToString(id) != request.SnapshotID || !request.Confirmed {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "Confirm the selected Flower backup before restoring", ErrorCode: "AI_RESTORE_CONFIRMATION_REQUIRED"})
		return
	}
	if err := maintenance.RestoreFlowerSnapshot(request.SnapshotID); err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, ErrAIRetryInProgress) {
			status = http.StatusConflict
		}
		writeJSON(w, status, apiResp{OK: false, Error: "Flower maintenance is already running or unavailable", ErrorCode: "AI_MAINTENANCE_UNAVAILABLE"})
		return
	}
	g.appendAudit(meta, "ai_snapshot_restore", "accepted", map[string]any{"snapshot_id": request.SnapshotID}, nil)
	writeJSON(w, http.StatusAccepted, apiResp{OK: true, Data: g.aiReadinessSnapshot()})
}
