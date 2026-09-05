package appserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestWriteContainerResourceErrorUsesActionablePruneCodes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		err         error
		wantCode    string
		wantMessage string
	}{
		{
			name:        "nothing to prune",
			err:         fmt.Errorf("wrapped: %w", containerengine.ErrNothingToPrune),
			wantCode:    "NOTHING_TO_PRUNE",
			wantMessage: "There are no unused resources to clean up.",
		},
		{
			name:        "reference state incomplete",
			err:         fmt.Errorf("wrapped: %w", containerengine.ErrReferenceStateIncomplete),
			wantCode:    "REFERENCE_STATE_INCOMPLETE",
			wantMessage: "Resource usage could not be confirmed. Refresh and try again.",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rr := httptest.NewRecorder()
			writeContainerResourceError(rr, tc.err)
			if rr.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d; body=%q", rr.Code, http.StatusConflict, rr.Body.String())
			}
			var body apiResp
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.OK || body.ErrorCode != tc.wantCode || body.Error != tc.wantMessage {
				t.Fatalf("response = %#v, want code=%q message=%q", body, tc.wantCode, tc.wantMessage)
			}
		})
	}
}

func TestComposeResourceErrorsAreTypedAndRedacted(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		err    error
		code   string
		status int
	}{
		{containerengine.ErrComposeProjectNotFound, "COMPOSE_PROJECT_NOT_FOUND", http.StatusNotFound},
		{containerengine.ErrComposeConfigurationUnavailable, "COMPOSE_CONFIGURATION_UNAVAILABLE", http.StatusConflict},
	} {
		rr := httptest.NewRecorder()
		writeContainerResourceError(rr, fmt.Errorf("private /workspace/secret.yaml: %w", tc.err))
		var body apiResp
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if rr.Code != tc.status || body.ErrorCode != tc.code || strings.Contains(rr.Body.String(), "secret.yaml") {
			t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
		}
	}
}
