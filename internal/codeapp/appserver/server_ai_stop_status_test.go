package appserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

func TestAIThreadActionHTTPStatusMapsStopOutcome(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "continuation retry unavailable", err: fmt.Errorf("%w: latest turn is not retryable", ai.ErrThreadContinuationRetryUnavailable), want: http.StatusConflict},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := aiThreadActionHTTPStatus(tc.err); got != tc.want {
				t.Fatalf("aiThreadActionHTTPStatus(%v)=%d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

func TestAIUserTurnErrorKeepsWorkspaceRecoveryCodeAndHidesPrivatePath(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAIUserTurnError(recorder, fmt.Errorf("model context unavailable: %w: /private/source", ai.ErrPluginWorkspaceUnavailable))
	var body apiResp
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusConflict || body.ErrorCode != "PLUGIN_WORKSPACE_UNAVAILABLE" || body.Error != ai.ErrPluginWorkspaceUnavailable.Error() {
		t.Fatalf("unexpected recovery response: %d %+v", recorder.Code, body)
	}
}
