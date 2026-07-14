package appserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

func TestWriteAIApprovalErrorUsesStableConflictContract(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "approval conflict", err: fmt.Errorf("wrapped: %w", ai.ErrApprovalConflict), wantStatus: http.StatusConflict, wantCode: ai.ApprovalConflictErrorCode},
		{name: "legacy run conflict", err: ai.ErrRunChanged, wantStatus: http.StatusConflict, wantCode: ai.ApprovalConflictErrorCode},
		{name: "invalid request", err: errors.New("invalid request"), wantStatus: http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rr := httptest.NewRecorder()
			writeAIApprovalError(rr, tc.err)
			if rr.Code != tc.wantStatus {
				t.Fatalf("status=%d, want %d; body=%q", rr.Code, tc.wantStatus, rr.Body.String())
			}
			var body apiResp
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.OK || body.Error != tc.err.Error() || body.ErrorCode != tc.wantCode {
				t.Fatalf("response=%#v, want error=%q error_code=%q", body, tc.err.Error(), tc.wantCode)
			}
		})
	}
}
