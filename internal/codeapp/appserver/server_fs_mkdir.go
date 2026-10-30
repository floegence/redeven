package appserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func (g *Server) handleFSMkdir(w http.ResponseWriter, r *http.Request) {
	if g.fs == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "filesystem service not ready"})
		return
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	var body struct {
		Path string `json:"path"`
	}
	if err := dec.Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
		return
	}
	if !filepath.IsAbs(body.Path) || strings.ContainsRune(body.Path, 0) {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid path"})
		return
	}
	target, err := g.fs.CreateDirectory(r.Context(), body.Path, false)
	if err != nil {
		status, message := http.StatusInternalServerError, "mkdir failed"
		var rpcError *sessionrpc.Error
		if errors.As(err, &rpcError) {
			message = rpcError.Message
			if rpcError.Code >= 400 && rpcError.Code <= 599 {
				status = int(rpcError.Code)
			}
			if rpcError.Code == gitruntime.ErrorResourceLimit {
				status = http.StatusServiceUnavailable
			}
		}
		writeJSON(w, status, apiResp{OK: false, Error: message})
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: struct {
		Path string `json:"path"`
	}{Path: target}})
}
