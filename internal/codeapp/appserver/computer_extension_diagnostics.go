package appserver

import (
	"crypto/rand"
	"errors"
	"net/http"

	"github.com/floegence/redeven/internal/ai"
)

func (g *Server) writeComputerExtensionFailure(w http.ResponseWriter, err error, stage string) {
	diagnostic := ai.ComputerExtensionDiagnosticForError(err, stage)
	if diagnostic.DiagnosticID == "" {
		diagnostic.DiagnosticID = rand.Text()
	}
	cause := err
	for errors.Unwrap(cause) != nil {
		cause = errors.Unwrap(cause)
	}
	g.log.Warn("Chrome connection action failed", "stage", diagnostic.Stage, "reason", diagnostic.Reason, "diagnostic_id", diagnostic.DiagnosticID, "error", cause)
	writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: diagnostic.Reason, ErrorCode: diagnostic.Reason, Data: diagnostic})
}
