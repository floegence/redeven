package localui

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
)

func TestServer_E2E_LocalPasswordFlow(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)
	s.a = newRuntimeHealthTestAgent(t, s.configPath)

	srv := httptest.NewTLSServer(s.handler())
	defer srv.Close()
	s.authorityMu.Lock()
	if s.networkAuthorities == nil {
		s.networkAuthorities = make(map[string]struct{})
	}
	s.networkAuthorities[srv.Listener.Addr().String()] = struct{}{}
	s.authorityMu.Unlock()
	if err := s.configureAcceptor(); err != nil {
		t.Fatalf("configureAcceptor() error = %v", err)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := srv.Client()
	client.Jar = jar

	redirectClient := srv.Client()
	redirectClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	rootResp, err := redirectClient.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET / error = %v", err)
	}
	defer rootResp.Body.Close()
	if rootResp.StatusCode != http.StatusFound {
		t.Fatalf("GET / status = %d, want %d", rootResp.StatusCode, http.StatusFound)
	}
	if loc := rootResp.Header.Get("Location"); loc != "/_redeven_proxy/env/" {
		t.Fatalf("GET / location = %q, want %q", loc, "/_redeven_proxy/env/")
	}

	envReq, err := http.NewRequest(http.MethodGet, srv.URL+"/_redeven_proxy/env/", nil)
	if err != nil {
		t.Fatalf("NewRequest env error = %v", err)
	}
	envReq.Host = "localhost:23998"
	envResp, err := client.Do(envReq)
	if err != nil {
		t.Fatalf("GET env shell error = %v", err)
	}
	defer envResp.Body.Close()
	if envResp.StatusCode != http.StatusOK {
		t.Fatalf("GET env shell status = %d, want %d", envResp.StatusCode, http.StatusOK)
	}

	runtimeLockedResp, err := client.Get(srv.URL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET locked runtime error = %v", err)
	}
	defer runtimeLockedResp.Body.Close()
	if runtimeLockedResp.StatusCode != http.StatusLocked {
		t.Fatalf("locked runtime status = %d, want %d", runtimeLockedResp.StatusCode, http.StatusLocked)
	}

	wrongUnlockResp, err := client.Post(srv.URL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"wrong"}`))
	if err != nil {
		t.Fatalf("POST wrong unlock error = %v", err)
	}
	defer wrongUnlockResp.Body.Close()
	if wrongUnlockResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong unlock status = %d, want %d", wrongUnlockResp.StatusCode, http.StatusUnauthorized)
	}

	unlockResp, err := client.Post(srv.URL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST unlock error = %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockResp.StatusCode, http.StatusOK)
	}
	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			Unlocked    bool   `json:"unlocked"`
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(unlockResp.Body).Decode(&unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || !unlockBody.Data.Unlocked || unlockBody.Data.ResumeToken == "" {
		t.Fatalf("unexpected unlock body: %#v", unlockBody)
	}

	headerRuntimeReq, err := http.NewRequest(http.MethodGet, srv.URL+"/api/local/runtime", nil)
	if err != nil {
		t.Fatalf("NewRequest header runtime error = %v", err)
	}
	headerRuntimeReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	headerRuntimeResp, err := client.Do(headerRuntimeReq)
	if err != nil {
		t.Fatalf("GET header runtime error = %v", err)
	}
	defer headerRuntimeResp.Body.Close()
	if headerRuntimeResp.StatusCode != http.StatusOK {
		t.Fatalf("header runtime status = %d, want %d", headerRuntimeResp.StatusCode, http.StatusOK)
	}

	runtimeResp, err := client.Get(srv.URL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET unlocked runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("unlocked runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	connectInfoResp, err := client.Post(srv.URL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST connect_artifact error = %v", err)
	}
	defer connectInfoResp.Body.Close()
	if connectInfoResp.StatusCode != http.StatusOK {
		t.Fatalf("connect_artifact status = %d, want %d", connectInfoResp.StatusCode, http.StatusOK)
	}

	headerConnectReq, err := http.NewRequest(http.MethodPost, srv.URL+"/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("NewRequest header connect_artifact error = %v", err)
	}
	headerConnectReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	headerConnectResp, err := srv.Client().Do(headerConnectReq)
	if err != nil {
		t.Fatalf("POST header connect_artifact error = %v", err)
	}
	defer headerConnectResp.Body.Close()
	if headerConnectResp.StatusCode != http.StatusOK {
		t.Fatalf("header connect_artifact status = %d, want %d", headerConnectResp.StatusCode, http.StatusOK)
	}

	var connectBody connectArtifactEnvelope
	if err := json.NewDecoder(headerConnectResp.Body).Decode(&connectBody); err != nil {
		t.Fatalf("decode header connect_artifact body error = %v", err)
	}
	corruptArtifact := append([]byte(nil), connectBody.ConnectArtifact...)
	if len(corruptArtifact) < 2 {
		t.Fatal("connect artifact is unexpectedly empty")
	}
	corruptArtifact[len(corruptArtifact)-2] = 'x'
	if _, err := flowersec.ParseArtifact(corruptArtifact); err == nil {
		t.Fatal("tampered Flowersec artifact unexpectedly parsed")
	}
	connectLocalDirectSession(t, s, srv.URL, srv.Certificate(), unlockBody.Data.ResumeToken, connectBody.ConnectArtifact)
}

func connectLocalDirectSession(t *testing.T, s *Server, serverURL string, certificate *x509.Certificate, resumeToken string, encodedArtifact json.RawMessage) {
	t.Helper()
	if s == nil || s.a == nil {
		t.Fatal("test server missing agent")
	}
	artifact, err := flowersec.ParseArtifact(encodedArtifact)
	if err != nil {
		t.Fatalf("ParseArtifact() error = %v", err)
	}
	origin := strings.TrimPrefix(serverURL, "ws://")
	origin = strings.TrimPrefix(origin, "wss://")
	origin = strings.TrimPrefix(origin, "http://")
	origin = strings.TrimPrefix(origin, "https://")
	origin = "https://" + origin

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if certificate == nil {
		t.Fatal("test server certificate unavailable")
	}
	trustRoots := x509.NewCertPool()
	trustRoots.AddCert(certificate)
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatalf("NewArtifactLease() error = %v", err)
	}
	client, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: trustRoots, Origin: origin, ConnectTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("ConnectDirect() error = %v", err)
	}
	defer client.Close()
}

func TestServer_E2E_CodespaceBrowserBootstrapFromResumeToken(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	cfgPath := writeTestConfig(t)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte("<html>codespace</html>"))
		case "/static/workbench.js":
			_, _ = w.Write([]byte("console.log('ok');"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	upstreamPort := upstream.Listener.Addr().(*net.TCPAddr).Port
	appSrv := newTestAppServerWithBackend(t, cfgPath, localUITestCodeSpaceBackend{port: upstreamPort})
	s := newTestServerWithAppServer(t, gate, appSrv, cfgPath)

	srv := httptest.NewServer(s.handler())
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := &http.Client{Jar: jar}

	unlockResp, err := client.Post(srv.URL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST unlock error = %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockResp.StatusCode, http.StatusOK)
	}

	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(unlockResp.Body).Decode(&unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || unlockBody.Data.ResumeToken == "" {
		t.Fatalf("unexpected unlock body: %#v", unlockBody)
	}

	codespaceReq, err := http.NewRequest(http.MethodGet, srv.URL+"/cs/demo/?redeven_access_resume="+unlockBody.Data.ResumeToken, nil)
	if err != nil {
		t.Fatalf("NewRequest codespace error = %v", err)
	}
	codespaceReq.Host = "localhost:23998"
	codespaceResp, err := client.Do(codespaceReq)
	if err != nil {
		t.Fatalf("GET codespace error = %v", err)
	}
	defer codespaceResp.Body.Close()
	if codespaceResp.StatusCode != http.StatusOK {
		t.Fatalf("codespace status = %d, want %d", codespaceResp.StatusCode, http.StatusOK)
	}

	assetReq, err := http.NewRequest(http.MethodGet, srv.URL+"/cs/demo/static/workbench.js", nil)
	if err != nil {
		t.Fatalf("NewRequest asset error = %v", err)
	}
	assetReq.Host = "localhost:23998"
	assetResp, err := client.Do(assetReq)
	if err != nil {
		t.Fatalf("GET asset error = %v", err)
	}
	defer assetResp.Body.Close()
	if assetResp.StatusCode != http.StatusOK {
		t.Fatalf("asset status = %d, want %d", assetResp.StatusCode, http.StatusOK)
	}
}
