package appserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/plugincreation"
)

const pluginCreationAPI = "/_redeven_proxy/api/plugin-creation"

func decodePluginDraftJSON(r *http.Request, out any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return plugincreation.ErrInvalid
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return plugincreation.ErrInvalid
	}
	return nil
}
func writePluginDraftResult(w http.ResponseWriter, value any, err error) {
	if err == nil {
		writeJSON(w, 200, apiResp{OK: true, Data: value})
		return
	}
	status := 500
	code := "PLUGIN_DRAFT_OPERATION_FAILED"
	switch {
	case errors.Is(err, plugincreation.ErrInvalid):
		status = 400
		code = "PLUGIN_DRAFT_INVALID_REQUEST"
	case errors.Is(err, plugincreation.ErrNotFound):
		status = 404
		code = "PLUGIN_DRAFT_NOT_FOUND"
	case errors.Is(err, plugincreation.ErrConflict), errors.Is(err, plugincreation.ErrDeleting):
		status = 409
		code = "PLUGIN_DRAFT_CONFLICT"
	}
	writeJSON(w, status, apiResp{OK: false, Error: err.Error(), ErrorCode: code})
}
func (g *Server) handlePluginCreationAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || !strings.HasPrefix(r.URL.Path, pluginCreationAPI+"/") {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	permission := requiredPermissionRead
	if r.Method != http.MethodGet {
		permission = requiredPermissionFull
	}
	meta, ok := g.requirePermission(w, r, permission)
	if !ok {
		return true
	}
	if g.pluginCreation == nil {
		writeJSON(w, 503, apiResp{OK: false, Error: "Plugin creation unavailable", ErrorCode: "PLUGIN_CREATION_UNAVAILABLE"})
		return true
	}
	owner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		writePluginDraftResult(w, nil, err)
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, pluginCreationAPI+"/"), "/")
	if r.URL.RawQuery != "" {
		writePluginDraftResult(w, nil, plugincreation.ErrConflict)
		return true
	}
	if len(parts) == 1 && parts[0] == "drafts" {
		if r.Method == http.MethodGet {
			v, e := g.pluginCreation.Store.List(r.Context(), owner)
			writePluginDraftResult(w, v, e)
			return true
		}
		if r.Method == http.MethodPost {
			var req struct {
				RequestID string `json:"request_id"`
			}
			if e := decodePluginDraftJSON(r, &req); e != nil {
				writePluginDraftResult(w, nil, e)
				return true
			}
			v, e := g.pluginCreation.Create(r.Context(), meta, req.RequestID)
			writePluginDraftResult(w, v, e)
			return true
		}
	}
	if len(parts) == 2 && parts[0] == "threads" && r.Method == http.MethodGet {
		v, e := g.pluginCreation.Store.ForThread(r.Context(), owner, parts[1])
		writePluginDraftResult(w, v, e)
		return true
	}
	if len(parts) >= 2 && parts[0] == "drafts" {
		id := parts[1]
		d, e := g.pluginCreation.Store.Get(r.Context(), owner, id)
		if e != nil {
			writePluginDraftResult(w, nil, e)
			return true
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			writePluginDraftResult(w, d, nil)
			return true
		}
		if len(parts) == 3 && r.Method == http.MethodPost {
			switch parts[2] {
			case "resume":
				var req struct{}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					d, e = g.pluginCreation.ResumePreparation(r.Context(), meta, id)
					if e == nil && d.LaunchPending {
						if g.aiProvider == nil {
							e = errors.New("Flower unavailable")
						} else {
							svc, ctx, _, release, failure := g.aiProvider.AcquireAIService(r.Context())
							if release != nil {
								defer release()
							}
							if failure != nil {
								e = failure
							} else if svc == nil || ctx == nil {
								e = errors.New("Flower unavailable")
							} else {
								d, e = svc.ResumePluginDraft(ctx, meta, id)
							}
						}
					}
				}
				writePluginDraftResult(w, d, e)
				return true
			case "rename":
				var req struct {
					Revision int64  `json:"revision"`
					Title    string `json:"title"`
				}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					d, e = g.pluginCreation.Store.Rename(r.Context(), owner, id, req.Revision, req.Title)
				}
				writePluginDraftResult(w, d, e)
				return true
			case "turns", "delete":
				if g.aiProvider == nil {
					writeJSON(w, 503, apiResp{OK: false, Error: "Flower unavailable"})
					return true
				}
				svc, ctx, _, release, e := g.aiProvider.AcquireAIService(r.Context())
				if release != nil {
					defer release()
				}
				if e != nil || svc == nil || ctx == nil {
					writeJSON(w, 503, apiResp{OK: false, Error: "Flower unavailable"})
					return true
				}
				if parts[2] == "delete" {
					var req struct {
						Revision int64 `json:"revision"`
					}
					if e = decodePluginDraftJSON(r, &req); e == nil {
						d, e = svc.DeletePluginDraft(ctx, meta, id, req.Revision)
					}
					writePluginDraftResult(w, d, e)
					return true
				}
				body, e := decodeAIUserTurnRequest(r.Body)
				if e != nil {
					writePluginDraftResult(w, nil, plugincreation.ErrConflict)
					return true
				}
				scope, capability, e := optionalUploadStagingHeaders(r)
				if e != nil || strings.TrimSpace(body.StagingScopeID) != scope {
					writePluginDraftResult(w, nil, plugincreation.ErrConflict)
					return true
				}
				body.StagingCapability = capability
				if body.Create != nil {
					if body.ThreadID != "" || body.ClientRequestID != "" {
						writePluginDraftResult(w, nil, plugincreation.ErrConflict)
						return true
					}
					body.PluginDraftID = id
				} else {
					if d.ThreadID == "" || body.ThreadID != "" && body.ThreadID != d.ThreadID {
						writePluginDraftResult(w, nil, plugincreation.ErrConflict)
						return true
					}
					body.ThreadID = d.ThreadID
				}
				result, e := svc.SendUserTurn(ctx, meta, body)
				if errors.Is(e, ai.ErrFlowerStorageRestored) {
					writeJSON(w, 409, apiResp{OK: false, Error: e.Error(), ErrorCode: "AI_STORAGE_RESTORED"})
					return true
				}
				if e != nil {
					writeJSON(w, aiThreadActionHTTPStatus(e), apiResp{OK: false, Error: e.Error()})
					return true
				}
				writeJSON(w, 202, apiResp{OK: true, Data: result})
				return true
			}
		}
	}
	writeJSON(w, 404, apiResp{OK: false, Error: "not found"})
	return true
}
