package appserver

import (
	"net/http"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func (g *Server) hostApplicationPicture(owner string) (config.HostApplicationPicture, error) {
	cfg, err := g.loadConfigLocked()
	if err != nil {
		return config.HostApplicationPicture{}, err
	}
	if value, ok := cfg.HostApplicationPictures[owner]; ok {
		return value, nil
	}
	return config.HostApplicationPicture{Mode: "auto"}, nil
}

func (g *Server) handleHostApplicationPicture(w http.ResponseWriter, r *http.Request, meta *session.Meta) {
	w.Header().Set("Cache-Control", "no-store")
	// IMPORTANT: The authenticated user is the only preference key. Callers cannot
	// name another owner, and resource-scoped viewer sessions only read settings.
	if meta.UserPublicID == "" {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}
	switch r.Method {
	case http.MethodGet:
		value, err := g.hostApplicationPicture(meta.UserPublicID)
		if err != nil {
			writeJSON(w, 500, apiResp{OK: false, Error: "picture preferences unavailable"})
			return
		}
		writeJSON(w, 200, apiResp{OK: true, Data: value})
	case http.MethodPut:
		var value config.HostApplicationPicture
		if decodeManagedJSON(r, &value) != nil || value.Validate() != nil {
			writeJSON(w, 400, apiResp{OK: false, Error: "invalid picture preferences"})
			return
		}
		g.configUpdateMu.Lock()
		_, err := config.Update(g.configPath, func(c *config.Config) error {
			if c.HostApplicationPictures == nil {
				c.HostApplicationPictures = make(map[string]config.HostApplicationPicture)
			}
			c.HostApplicationPictures[meta.UserPublicID] = value
			return nil
		})
		g.configUpdateMu.Unlock()
		if err != nil {
			writeJSON(w, 500, apiResp{OK: false, Error: "picture preferences could not be saved"})
			return
		}
		writeJSON(w, 200, apiResp{OK: true, Data: value})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
