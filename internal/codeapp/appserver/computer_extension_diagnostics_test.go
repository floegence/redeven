package appserver

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChromeFailuresKeepStageAndCorrelationWithoutPrivateDetails(t *testing.T) {
	srv, _, _ := newUploadRouteServer(t)
	for _, stage := range []string{"prepare", "open", "check"} {
		response := httptest.NewRecorder()
		srv.writeComputerExtensionFailure(response, errors.New("private filesystem /home/person/secret"), stage)
		var envelope struct {
			ErrorCode string `json:"error_code"`
			Data      struct {
				Stage, Reason string
				ID            string `json:"diagnostic_id"`
			}
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if response.Code != 400 || envelope.Data.Stage != stage || envelope.ErrorCode != envelope.Data.Reason || envelope.Data.ID == "" {
			t.Fatalf("incomplete error contract: %s", response.Body.String())
		}
		if strings.Contains(response.Body.String(), "private") || strings.Contains(response.Body.String(), "/home") {
			t.Fatal("private platform error crossed the UI boundary")
		}
	}
}
