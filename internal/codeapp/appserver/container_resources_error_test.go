package appserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
