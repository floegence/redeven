package localui

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	"github.com/pquerna/otp/totp"
)

func TestRuntimeSecurityStatusReportsRunningHTTPS(t *testing.T) {
	gate, err := accessgate.OpenPersistent(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	for _, protocol := range []string{config.LocalUIProtocolHTTP, config.LocalUIProtocolHTTPS} {
		t.Run(protocol, func(t *testing.T) {
			control := &runtimeControlServer{token: "owner", accessGate: gate, accessCurrent: config.EnvironmentCatalogAccess{LocalUIProtocol: protocol}}
			req := httptest.NewRequest("POST", "http://localhost/v2/runtime/security", bytes.NewBufferString(`{"action":"status"}`))
			req.RemoteAddr = "127.0.0.1:1234"
			req.Header.Set("Authorization", "Bearer owner")
			res := httptest.NewRecorder()
			control.handleRuntimeSecurity(res, req)
			var body struct {
				Data struct {
					HTTPSReady *bool `json:"https_ready"`
				} `json:"data"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if res.Code != 200 || body.Data.HTTPSReady == nil || *body.Data.HTTPSReady != (protocol == config.LocalUIProtocolHTTPS) {
				t.Fatalf("missing or inaccurate HTTPS prerequisite: %s", res.Body.String())
			}
		})
	}
}

func TestRuntimeSecurityOwnerBoundaryAndTwoStepLogin(t *testing.T) {
	dir := t.TempDir()
	hash, err := accessgate.HashPassword("environment secret")
	if err != nil {
		t.Fatal(err)
	}
	if err = accessgate.WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	gate, err := accessgate.OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	control := &runtimeControlServer{token: "owner-control-token", accessGate: gate, accessCurrent: config.EnvironmentCatalogAccess{LocalUIProtocol: config.LocalUIProtocolHTTPS}}
	manage := func(token string, input accessgate.SecurityRequest) (int, accessgate.SecurityResult) {
		raw, _ := json.Marshal(input)
		req := httptest.NewRequest("POST", "http://localhost:23998/v2/runtime/security", bytes.NewReader(raw))
		req.RemoteAddr = "127.0.0.1:2345"
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		control.handleRuntimeSecurity(res, req)
		var body struct {
			Data accessgate.SecurityResult `json:"data"`
		}
		_ = json.Unmarshal(res.Body.Bytes(), &body)
		return res.Code, body.Data
	}
	if status, _ := manage("", accessgate.SecurityRequest{Action: "setup"}); status != 401 {
		t.Fatal("loopback enabled owner management")
	}
	control.accessCurrent.LocalUIProtocol = config.LocalUIProtocolHTTP
	if status, _ := manage(control.token, accessgate.SecurityRequest{Action: "setup"}); status != 409 {
		t.Fatal("inactive HTTPS settings allowed MFA setup")
	}
	control.accessCurrent.LocalUIProtocol = config.LocalUIProtocolHTTPS
	status, setup := manage(control.token, accessgate.SecurityRequest{Action: "setup"})
	if status != 200 || setup.Secret == "" || setup.Enabled {
		t.Fatalf("setup: %d %+v", status, setup.SecurityStatus)
	}
	code, _ := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
	status, verified := manage(control.token, accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
	if status != 200 || len(verified.RecoveryCodes) != 8 {
		t.Fatal("failed real authenticator confirmation")
	}
	status, enabled := manage(control.token, accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true})
	if status != 200 || !enabled.Enabled {
		t.Fatal("MFA not committed")
	}
	server := &Server{accessGate: gate}
	unlock := func(input accessgate.AuthenticationRequest, cookies []*http.Cookie, secure bool) (*httptest.ResponseRecorder, accessgate.LocalSessionResult) {
		raw, _ := json.Marshal(input)
		req := httptest.NewRequest("POST", "https://localhost:23998/api/local/access/unlock", bytes.NewReader(raw))
		if secure {
			req.TLS = &tls.ConnectionState{}
		} else {
			req.TLS = nil
		}
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		server.handleAccessUnlock(res, req)
		var body struct {
			Data accessgate.LocalSessionResult `json:"data"`
		}
		_ = json.Unmarshal(res.Body.Bytes(), &body)
		return res, body.Data
	}
	res, challenge := unlock(accessgate.AuthenticationRequest{Password: "environment secret"}, nil, true)
	if res.Code != 200 || !challenge.SecondFactorRequired || challenge.Unlocked || challenge.ResumeToken != "" {
		t.Fatal("password-only login bypassed MFA")
	}
	for _, cookie := range res.Result().Cookies() {
		if cookie.Name == accessgate.LocalSessionCookieName {
			t.Fatal("password step minted a business cookie")
		}
	}
	cookies := res.Result().Cookies()
	code, _ = totp.GenerateCode(setup.Secret, time.Now())
	stolen, _ := unlock(accessgate.AuthenticationRequest{ChallengeID: challenge.ChallengeID, Code: code}, nil, true)
	if stolen.Code != 401 {
		t.Fatal("challenge escaped browser binding")
	}
	insecure, _ := unlock(accessgate.AuthenticationRequest{ChallengeID: challenge.ChallengeID, Code: code}, cookies, false)
	if insecure.Code != 403 {
		t.Fatal("insecure factor submission admitted")
	}
	authenticated, result := unlock(accessgate.AuthenticationRequest{ChallengeID: challenge.ChallengeID, Code: code}, cookies, true)
	if authenticated.Code != 200 || !result.Unlocked || result.ResumeToken == "" {
		t.Fatalf("second factor login failed: %d", authenticated.Code)
	}
	retry, replayed := unlock(accessgate.AuthenticationRequest{ChallengeID: challenge.ChallengeID, Code: code}, cookies, true)
	if retry.Code != 200 || replayed.ResumeToken != result.ResumeToken {
		t.Fatal("network retry issued a different session")
	}
	for _, cookie := range authenticated.Result().Cookies() {
		if cookie.Name == accessgate.LocalSessionCookieName && (!cookie.Secure || !cookie.HttpOnly) {
			t.Fatal("access cookie lacks transport protection")
		}
	}
}
