package appserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestComputerInputRejectsInvalidBodiesWithoutEchoingPrivateInput(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	const marker = "private-input-must-not-be-echoed"
	for _, test := range []struct {
		name   string
		body   string
		status int
	}{
		{"unknown field", `{"text":"` + marker + `","target_id":"forged"}`, http.StatusBadRequest},
		{"trailing data", `{"text":"` + marker + `"}{}`, http.StatusBadRequest},
		{"oversized body", `{"text":"` + marker + strings.Repeat("x", 32768) + `"}`, http.StatusBadRequest},
		{"wrong input type", `{"action":"type","text":{"private":"` + marker + `"}}`, http.StatusBadRequest},
		{"unknown interaction", `{"thread_id":"missing","interaction_id":"missing","action":"type","text":"` + marker + `"}`, http.StatusConflict},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/input", origin, test.body)
			if response.Code != test.status {
				t.Fatalf("status=%d want=%d", response.Code, test.status)
			}
			if strings.Contains(response.Body.String(), marker) {
				t.Fatal("private input was reflected in the error")
			}
		})
	}
}
