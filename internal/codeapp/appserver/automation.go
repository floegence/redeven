package appserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redevplugin/v3/pkg/schedule"
)

const automationAPI = "/_redeven_proxy/api/automation"

func writeAutomation(w http.ResponseWriter, value any, err error) {
	if err == nil {
		writeJSON(w, 200, apiResp{OK: true, Data: value})
		return
	}
	status := 500
	code := "AUTOMATION_FAILED"
	switch {
	case errors.Is(err, automation.ErrNotFound):
		status = 404
		code = "AUTOMATION_NOT_FOUND"
	case errors.Is(err, automation.ErrInvalid):
		status = 400
		code = "AUTOMATION_INVALID"
	case errors.Is(err, automation.ErrUnauthorized):
		status = 403
		code = "AUTOMATION_UNAUTHORIZED"
	case errors.Is(err, automation.ErrConflict), errors.Is(err, automation.ErrUnknown):
		status = 409
		code = "AUTOMATION_CONFLICT"
	}
	writeJSON(w, status, apiResp{OK: false, Error: err.Error(), ErrorCode: code})
}
func (g *Server) handleAutomationAPI(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, automationAPI+"/") {
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
	if g.automation == nil {
		writeJSON(w, 503, apiResp{OK: false, Error: "Automation unavailable"})
		return true
	}
	o, err := automation.OwnerFromSession(meta)
	if err != nil {
		writeAutomation(w, nil, err)
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, automationAPI+"/"), "/")
	if r.URL.RawQuery != "" {
		writeAutomation(w, nil, automation.ErrInvalid)
		return true
	}
	if len(parts) == 1 && parts[0] == "options" && r.Method == http.MethodGet {
		if g.aiProvider == nil {
			writeAutomation(w, ai.AutomationOptions{Models: []ai.Model{}}, nil)
			return true
		}
		svc, ctx, _, release, e := g.aiProvider.AcquireAIService(r.Context())
		if release != nil {
			defer release()
		}
		if e != nil {
			writeAutomation(w, nil, e)
			return true
		}
		v, e := svc.AutomationOptions(ctx, meta)
		writeAutomation(w, v, e)
		return true
	}
	if len(parts) == 1 && parts[0] == "workflows" {
		if r.Method == http.MethodGet {
			v, e := g.automation.List(r.Context(), o)
			writeAutomation(w, v, e)
			return true
		}
		if r.Method == http.MethodPost {
			var req struct {
				RequestID  string                `json:"request_id"`
				Definition automation.Definition `json:"definition"`
			}
			if err = decodePluginDraftJSON(r, &req); err == nil {
				var v automation.Workflow
				v, err = g.automation.Create(r.Context(), o, req.RequestID, req.Definition)
				writeAutomation(w, v, err)
			} else {
				writeAutomation(w, nil, automation.ErrInvalid)
			}
			return true
		}
	}
	if len(parts) >= 2 && parts[0] == "workflows" {
		id := parts[1]
		flow, e := g.automation.Get(r.Context(), o, id)
		if e != nil {
			writeAutomation(w, nil, e)
			return true
		}
		if len(parts) == 3 && (parts[2] == "schedule" || parts[2] == "schedule-history" || parts[2] == "schedule-preview" || parts[2] == "schedule-pause") {
			if g.automationSchedules == nil {
				writeAutomation(w, nil, automation.ErrNotFound)
				return true
			}
			switch {
			case parts[2] == "schedule-pause" && r.Method == http.MethodPost:
				var req struct{}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				e = g.automationSchedules.Pause(r.Context(), o, id)
				writeAutomation(w, map[string]bool{"paused": e == nil}, e)
				return true
			case parts[2] == "schedule" && r.Method == http.MethodGet:
				v, e := g.automationSchedules.Get(r.Context(), o, id)
				writeAutomation(w, v, e)
				return true
			case parts[2] == "schedule" && r.Method == http.MethodPost:
				var req automation.ScheduleInput
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				v, e := g.automationSchedules.Save(r.Context(), o, id, req)
				writeAutomation(w, v, e)
				return true
			case parts[2] == "schedule-history" && r.Method == http.MethodGet:
				v, e := g.automationSchedules.Claims(r.Context(), o, id)
				writeAutomation(w, v, e)
				return true
			case parts[2] == "schedule-preview" && r.Method == http.MethodPost:
				var req struct {
					Cadence schedule.Cadence `json:"cadence"`
				}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				dates := []time.Time{}
				at := time.Now().UTC()
				for range 5 {
					at, e = req.Cadence.Next(at)
					if e != nil {
						break
					}
					dates = append(dates, at)
				}
				if e != nil {
					e = automation.ErrInvalid
				}
				writeAutomation(w, dates, e)
				return true
			}
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			writeAutomation(w, flow, nil)
			return true
		}
		if len(parts) == 3 && parts[2] == "runs" && r.Method == http.MethodGet {
			v, e := g.automation.RunSummaries(r.Context(), o, id)
			writeAutomation(w, v, e)
			return true
		}
		if len(parts) == 3 && r.Method == http.MethodPost {
			switch parts[2] {
			case "archive":
				var req struct {
					Revision int64 `json:"revision"`
				}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					flow, e = g.automation.Archive(r.Context(), o, id, req.Revision)
					if e == nil && g.automationSchedules != nil {
						e = g.automationSchedules.Pause(r.Context(), o, id)
					}
				}
				writeAutomation(w, flow, e)
				return true
			case "save":
				var req struct {
					Revision   int64                 `json:"revision"`
					Definition automation.Definition `json:"definition"`
				}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					flow, e = g.automation.Save(r.Context(), o, id, req.Revision, req.Definition)
				}
				writeAutomation(w, flow, e)
				return true
			case "validate":
				var req struct {
					Definition automation.Definition `json:"definition"`
				}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
				} else {
					writeAutomation(w, req.Definition.Validate(), nil)
				}
				return true
			case "publish":
				var req struct {
					Revision  int64     `json:"revision"`
					Tools     []string  `json:"tools"`
					ExpiresAt time.Time `json:"expires_at"`
				}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				if g.aiProvider == nil {
					needsFlower := len(req.Tools) != 0
					for _, node := range flow.Definition.Nodes {
						needsFlower = needsFlower || node.Kind == "agent" || node.Kind == "parallel"
					}
					if needsFlower {
						writeAutomation(w, nil, automation.ErrUnauthorized)
						return true
					}
				}
				if g.aiProvider != nil {
					svc, ctx, _, release, validationErr := g.aiProvider.AcquireAIService(r.Context())
					if release != nil {
						defer release()
					}
					if validationErr == nil {
						validationErr = svc.ValidateAutomationPublication(ctx, meta, flow.Definition, req.Tools)
					}
					if validationErr != nil {
						writeAutomation(w, nil, validationErr)
						return true
					}
				}
				grant := automation.Grant{Enabled: true, Tools: req.Tools, ExpiresAt: req.ExpiresAt, Model: flow.Definition.Model, WorkingDirectory: flow.Definition.WorkingDirectory, Authority: automation.GrantAuthority{Namespace: meta.NamespacePublicID, App: meta.FloeApp, Read: meta.CanRead, Write: meta.CanWrite, Execute: meta.CanExecute}}
				v, e := g.automation.Publish(r.Context(), o, id, req.Revision, grant)
				writeAutomation(w, v, e)
				return true
			case "revoke":
				var req struct{}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					e = g.automation.Revoke(r.Context(), o, id)
				}
				writeAutomation(w, map[string]bool{"revoked": e == nil}, e)
				return true
			case "run":
				var req struct {
					RequestID   string    `json:"request_id"`
					Version     int64     `json:"version"`
					Purpose     string    `json:"purpose"`
					ScheduledAt time.Time `json:"scheduled_at"`
				}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				if prior, receiptErr := g.automation.RunForRequest(r.Context(), o, req.RequestID); receiptErr == nil {
					if prior.WorkflowID != id || prior.DefinitionVersion != req.Version || prior.Purpose != req.Purpose || !prior.ScheduledAt.Equal(req.ScheduledAt) {
						writeAutomation(w, nil, automation.ErrConflict)
					} else {
						writeAutomation(w, prior, nil)
					}
					return true
				} else if !errors.Is(receiptErr, automation.ErrNotFound) {
					writeAutomation(w, nil, receiptErr)
					return true
				}
				grant, e := g.automation.GrantVersion(r.Context(), o, id, req.Version)
				if e != nil || !grant.Enabled || grant.Revision != req.Version || !grant.ExpiresAt.After(time.Now()) {
					writeAutomation(w, nil, automation.ErrUnauthorized)
					return true
				}
				v, e := g.automation.CreateRun(r.Context(), o, id, req.RequestID, req.Version, req.Purpose, req.ScheduledAt)
				writeAutomation(w, v, e)
				return true
			case "designer":
				var req struct{}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				if g.aiProvider == nil {
					writeAutomation(w, nil, errors.New("Flower unavailable"))
					return true
				}
				svc, ctx, _, release, e := g.aiProvider.AcquireAIService(r.Context())
				if release != nil {
					defer release()
				}
				if e != nil {
					writeAutomation(w, nil, e)
					return true
				}
				v, e := svc.PrepareAutomationDesigner(ctx, meta, id)
				writeAutomation(w, v, e)
				return true
			}
		}
	}
	if len(parts) >= 2 && parts[0] == "runs" {
		id := parts[1]
		run, e := g.automation.Run(r.Context(), o, id)
		if e != nil {
			writeAutomation(w, nil, e)
			return true
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			writeAutomation(w, run, nil)
			return true
		}
		if len(parts) == 5 && parts[2] == "attempts" && parts[4] == "context" && r.Method == http.MethodGet {
			if g.aiProvider == nil {
				writeAutomation(w, nil, automation.ErrNotFound)
				return true
			}
			svc, ctx, _, release, e := g.aiProvider.AcquireAIService(r.Context())
			if release != nil {
				defer release()
			}
			if e != nil {
				writeAutomation(w, nil, e)
				return true
			}
			v, e := svc.AutomationContextReceipt(ctx, meta, id, parts[3])
			writeAutomation(w, v, e)
			return true
		}
		if len(parts) == 3 && parts[2] == "artifacts" && r.Method == http.MethodGet {
			writeAutomation(w, run.Artifacts, nil)
			return true
		}
		if len(parts) == 4 && parts[2] == "artifacts" && r.Method == http.MethodGet {
			for _, artifact := range run.Artifacts {
				if artifact.ID == parts[3] {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
					w.Header().Set("X-Content-Type-Options", "nosniff")
					w.Header().Set("Content-Disposition", "attachment; filename=report.html")
					_, _ = w.Write([]byte(artifact.Content))
					return true
				}
			}
			writeAutomation(w, nil, automation.ErrNotFound)
			return true
		}
		if len(parts) == 3 && r.Method == http.MethodPost {
			switch parts[2] {
			case "cancel", "retry":
				var req struct{}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					if parts[2] == "cancel" {
						run, e = g.automation.RequestCancel(r.Context(), o, id)
					} else {
						run, e = g.automation.Retry(r.Context(), o, id)
					}
				}
				writeAutomation(w, run, e)
				return true
			case "approve":
				var req struct {
					AttemptID string `json:"attempt_id"`
				}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					run, e = g.automation.Approve(r.Context(), o, id, req.AttemptID)
				}
				writeAutomation(w, run, e)
				return true
			case "context":
				var req struct {
					After int64 `json:"after_revision"`
					Limit int   `json:"limit"`
				}
				if e = decodePluginDraftJSON(r, &req); e != nil {
					writeAutomation(w, nil, automation.ErrInvalid)
					return true
				}
				v, e := g.automation.ContextPage(r.Context(), o, id, req.After, req.Limit)
				writeAutomation(w, v, e)
				return true
			case "contribute":
				var req struct {
					ID    string `json:"id"`
					Text  string `json:"text"`
					Basis int64  `json:"basis"`
				}
				if e = decodePluginDraftJSON(r, &req); e == nil {
					run, e = g.automation.Contribute(r.Context(), o, id, automation.Contribution{ID: req.ID, Kind: "requirement", Text: req.Text, Basis: req.Basis, Data: json.RawMessage(`{}`)})
				}
				writeAutomation(w, run, e)
				return true
			}
		}
	}
	writeAutomation(w, nil, automation.ErrNotFound)
	return true
}
