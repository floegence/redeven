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

func TestPrivateComputerFrameRejectsUnknownAuthorityWithoutCaching(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	response := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/computer/private-frame?observer_id=other&viewer_revision=1&thread_id=missing&interaction_id=expired&frame_id=1", origin, "")
	if response.Code != http.StatusNotFound || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("private frame response: status=%d cache=%q", response.Code, response.Header().Get("Cache-Control"))
	}
	if strings.Contains(response.Body.String(), "missing") || strings.Contains(response.Body.String(), "expired") {
		t.Fatal("private authority was reflected")
	}
}

func TestComputerSelectionRejectsForgedConnectionAndTrailingBodies(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	for _, body := range []string{
		`{"thread_id":"missing","candidate_ref":"forged","cdp_url":"http://127.0.0.1:9222"}`,
		`{"thread_id":"missing","candidate_ref":"forged"}{}`,
		`{"thread_id":"missing","candidate_ref":7}`,
	} {
		response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/select", origin, body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid candidate input: %d %s", response.Code, response.Body.String())
		}
	}
	response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/select", origin, `{"thread_id":"missing","candidate_ref":"forged"}`)
	if response.Code != http.StatusConflict || strings.Contains(response.Body.String(), "forged") {
		t.Fatalf("unknown authority leaked or selected: %d %s", response.Code, response.Body.String())
	}
}

func TestComputerRevealRejectsForgedBrowserCommands(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	for _, body := range []string{`{"thread_id":"missing","target_id":"page","url":"https://example.test"}`, `{"thread_id":"missing","target_id":"page"}{}`} {
		response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/reveal", origin, body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid reveal accepted: %d", response.Code)
		}
	}
	response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/reveal", origin, `{"thread_id":"missing","target_id":"private-target"}`)
	if response.Code != http.StatusConflict || strings.Contains(response.Body.String(), "private-target") {
		t.Fatalf("reveal authority leaked: %s", response.Body.String())
	}
}

func TestChromeOnboardingRejectsArbitraryNativeDestinations(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	for _, body := range []string{
		`{"action":"connect","url":"https://untrusted.test"}`,
		`{"action":"folder","path":"/arbitrary"}`,
		`{"action":"connect"}{}`,
		`{"action":"--no-sandbox"}`,
	} {
		response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/extension/open", origin, body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("native destination accepted: %d", response.Code)
		}
	}
}

func TestComputerBrowserDiscoveryRejectsForgedOrUnboundedBodies(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	const marker = "private-endpoint-marker"
	for _, body := range []string{
		`{"thread_id":"missing","cdp_url":"` + marker + `","new_tab":true}`,
		`{"thread_id":"missing","cdp_url":"` + marker + `"}{}`,
		`{"thread_id":"missing","cdp_url":7}`,
		`{"thread_id":"missing","cdp_url":"` + marker + strings.Repeat("x", 16384) + `"}`,
		`{"thread_id":"missing","cdp_url":"` + marker + `"}`,
	} {
		response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/computer/candidates", origin, body)
		if response.Code != http.StatusBadRequest || strings.Contains(response.Body.String(), marker) {
			t.Fatalf("invalid discovery response: %d %s", response.Code, response.Body.String())
		}
	}
	response := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/computer/environment", origin, "")
	if response.Code == http.StatusNotFound {
		t.Fatal("environment route is not exposed")
	}
}

func TestComputerBrowserInstallationRejectsMalformedAndUnboundedRequests(t *testing.T) {
	srv, origin, _ := newUploadRouteServer(t)
	for _, test := range []struct{ method, body string }{
		{http.MethodPut, `{}`}, {http.MethodPut, `{"enabled":true,"url":"https://untrusted.test"}`},
		{http.MethodPut, `{"enabled":true}{}`}, {http.MethodPost, `{"action":"start","url":"https://untrusted.test"}`},
		{http.MethodPost, `{"action":"chunk","data":"` + strings.Repeat("x", 360*1024) + `"}`},
	} {
		response := performServerRequest(srv, test.method, "/_redeven_proxy/api/ai/computer/managed/browser", origin, test.body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid json") {
			t.Fatalf("invalid request: %d %s", response.Code, response.Body.String())
		}
	}
}
