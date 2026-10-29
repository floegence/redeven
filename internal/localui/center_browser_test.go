package localui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/environmentcenter"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewayservice"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/webbinding"
)

func trustedBrowserCertificate(t *testing.T, hosts ...string) tls.Certificate {
	t.Helper()
	dir := t.TempDir()
	cert, key := filepath.Join(dir, "server.pem"), filepath.Join(dir, "server-key.pem")
	args := append([]string{"-cert-file", cert, "-key-file", key}, hosts...)
	if raw, err := exec.Command("mkcert", args...).CombinedOutput(); err != nil {
		t.Fatalf("mkcert: %v %s", err, raw)
	}
	pair, err := tls.LoadX509KeyPair(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	return pair
}
func TestCenterBrowserQualification(t *testing.T) {
	if os.Getenv("REDEVEN_CENTER_BROWSER") != "1" {
		t.Skip("set REDEVEN_CENTER_BROWSER=1 with trusted mkcert and built Center UI")
	}
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "center-editor.txt"), []byte("Center editor qualification\n"), 0600); err != nil {
		t.Fatal(err)
	}
	webService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		if r.Method == "POST" {
			io.Copy(w, r.Body)
			return
		}
		w.Write([]byte("Center isolated service qualification"))
	}))
	defer webService.Close()
	qualificationTimeout := 6 * time.Minute
	if os.Getenv("REDEVEN_CENTER_LARGE_FILE") == "1" {
		qualificationTimeout = 12 * time.Minute
	}
	if os.Getenv("REDEVEN_CENTER_REVOCATION_LATENCY") == "1" || os.Getenv("REDEVEN_CENTER_AUTH_BOUNDARIES") == "1" {
		qualificationTimeout = 15 * time.Minute
	}
	if value := os.Getenv("REDEVEN_CENTER_SOAK_SECONDS"); value != "" {
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds < 30 || seconds > 9*60*60 {
			t.Fatal("soak duration must be between 30 seconds and nine hours")
		}
		qualificationTimeout = time.Duration(seconds)*time.Second + 10*time.Minute
	}
	ctx, cancel := context.WithTimeout(t.Context(), qualificationTimeout)
	defer cancel()
	reserved, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	memberAddress := reserved.Addr().String()
	memberURL := "https://" + memberAddress
	if external := os.Getenv("REDEVEN_CENTER_EXTERNAL_HOST_IP"); external != "" {
		_, port, _ := net.SplitHostPort(memberAddress)
		memberAddress = "0.0.0.0:" + port
		memberURL = "https://" + net.JoinHostPort(external, port)
	}
	reserved.Close()
	hostToken := strings.Repeat("c", 43)
	gateway, err := gatewayservice.New(gatewayservice.Options{StateRoot: t.TempDir(), HostAdminToken: hostToken, MemberURL: memberURL, MemberListen: memberAddress})
	if err != nil {
		t.Fatal(err)
	}
	admin, listeners, err := gateway.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	_ = listeners
	hostCall := func(path string, body, out any) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "http://gateway/gateway/v6/"+path, bytes.NewReader(raw))
		req.RemoteAddr = "127.0.0.1:12345"
		req.Header.Set(gatewayservice.HostAdminHeader, hostToken)
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, req)
		var envelope struct {
			OK   bool            `json:"ok"`
			Data json.RawMessage `json:"data"`
		}
		if json.Unmarshal(response.Body.Bytes(), &envelope) != nil || !envelope.OK {
			t.Fatalf("Gateway %s: %s", path, response.Body.String())
		}
		if out != nil {
			if err := json.Unmarshal(envelope.Data, out); err != nil {
				t.Fatal(err)
			}
		}
	}
	gatewayHTTP := httptest.NewUnstartedServer(gateway.Handler())
	gatewayHTTP.TLS = &tls.Config{Certificates: []tls.Certificate{trustedBrowserCertificate(t, "127.0.0.1", "localhost")}, MinVersion: tls.VersionTLS13}
	gatewayHTTP.StartTLS()
	defer gatewayHTTP.Close()
	var code gp.ClientAccessCodeResponse
	hostCall("clients/access-codes", gp.ClientAccessCodeRequest{ProtocolVersion: gp.Version}, &code)
	targets := []*webEntryFixture{}
	var uploadConfig *config.AIConfig
	var flowerRecovery *centerFlowerRecoveryFixture
	if os.Getenv("REDEVEN_CENTER_FLOWER_RECOVERY") == "1" {
		if os.Getenv("REDEVEN_CENTER_UPLOADS") == "1" || os.Getenv("REDEVEN_CENTER_EXTERNAL_FIXTURE") != "" {
			t.Fatal("Flower recovery requires its isolated local provider fixture")
		}
		flowerRecovery, uploadConfig = newCenterFlowerRecoveryFixture(t)
	}
	if os.Getenv("REDEVEN_CENTER_UPLOADS") == "1" {
		// Attachment staging needs a model profile but never invokes inference.
		var requests atomic.Int64
		endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet && r.URL.Path == "/v1/models" {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"data":[{"id":"test"}]}`))
				return
			}
			requests.Add(1)
			http.Error(w, "inference is forbidden during upload qualification", http.StatusServiceUnavailable)
		}))
		t.Cleanup(endpoint.Close)
		t.Cleanup(func() {
			if count := requests.Load(); count != 0 {
				t.Errorf("upload qualification invoked inference %d times", count)
			}
		})
		uploadConfig = &config.AIConfig{CurrentModelID: "upload-fixture/test", Providers: []config.AIProvider{{
			ID: "upload-fixture", Type: "openai_compatible", BaseURL: endpoint.URL + "/v1",
			Models: []config.AIProviderModel{{ModelName: "test", ContextWindow: 32768, InputModalities: []string{"text"}}},
		}}}
	}
	var external struct {
		RuntimeID     string
		Secret        string
		RecoveryCodes []string
		Host          string
		Root          string
	}
	if file := os.Getenv("REDEVEN_CENTER_EXTERNAL_FIXTURE"); file != "" {
		raw, err := os.ReadFile(file)
		if err != nil || json.Unmarshal(raw, &external) != nil || external.Host != "udesk26" || external.Root != "/tmp/redeven-center-aef0-20261028" {
			t.Fatal("invalid explicit external qualification fixture")
		}
	}
	remote := func(input, action string) []byte {
		command := exec.CommandContext(ctx, "ssh", "-x", "-o", "BatchMode=yes", external.Host, external.Root+"/bin/redeven "+action+" --state-root "+external.Root+"/state")
		command.Stdin = strings.NewReader(input)
		raw, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("external Runtime owner action failed: %v", err)
		}
		return raw
	}
	targetID := func(target *webEntryFixture) string {
		if target == nil {
			return external.RuntimeID
		}
		return target.runtime.a.RuntimePublicID()
	}
	activeTargets := 2
	if os.Getenv("REDEVEN_CENTER_CAPACITY") == "1" {
		activeTargets = 10
	}
	for index := 0; index < activeTargets; index++ {
		id := "center-runtime-" + string(rune('a'+index))
		var delivery gc.InvitationCodeDelivery
		hostCall("invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &delivery)
		if id == "center-runtime-a" && external.Host != "" {
			remote(delivery.Code+"\n", "gateway join --gateway "+memberURL+" --code-stdin --yes")
			// The owner command persists consent; the reconnect owner delivers it
			// asynchronously. Issuing another invitation revokes an unconsumed one.
			deadline := time.Now().Add(30 * time.Second)
			for {
				var catalog gp.CatalogResponse
				hostCall("catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog)
				joined := false
				for _, member := range catalog.Members {
					joined = joined || member.RuntimePublicID == external.RuntimeID && member.State == "active"
				}
				if joined {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("external Runtime consent did not reach active Gateway membership")
				}
				time.Sleep(100 * time.Millisecond)
			}
			targets = append(targets, nil)
			continue
		}
		descriptor, err := gatewaymembership.PreviewInvitation(ctx, memberURL, delivery.Code)
		if err != nil {
			t.Fatal(err)
		}
		state, err := gatewaymembership.PrepareRuntime(descriptor, id, gp.MemberMetadata{Hostname: id})
		if err != nil {
			t.Fatal(err)
		}
		targets = append(targets, newWebEntryFixture(t, webFixtureOptions{runtimeID: id, browser: true, enrolled: state, lifetime: qualificationTimeout, aiConfig: uploadConfig}))
	}
	web := httptest.NewUnstartedServer(nil)
	if os.Getenv("REDEVEN_CENTER_CAPACITY") == "1" {
		// Real signed members populate the source catalog; ten active targets
		// have application processes. No UI response interception is used.
		for i := activeTargets; i < 100; i++ {
			var delivery gc.InvitationCodeDelivery
			hostCall("invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &delivery)
			descriptor, err := gatewaymembership.PreviewInvitation(ctx, memberURL, delivery.Code)
			if err != nil {
				t.Fatal(err)
			}
			id := fmt.Sprintf("capacity-member-%03d", i)
			state, err := gatewaymembership.PrepareRuntime(descriptor, id, gp.MemberMetadata{Hostname: id})
			if err != nil {
				t.Fatal(err)
			}
			if err = state.Enroll(ctx, func(*gatewaymembership.RuntimeConfig) error { return nil }); err != nil {
				t.Fatal(err)
			}
		}
	}
	_, port, _ := net.SplitHostPort(web.Listener.Addr().String())
	origin := "https://center.acceptance.localhost:" + port
	center, err := environmentcenter.Open(filepath.Join(t.TempDir(), "center"), origin)
	if err != nil {
		t.Fatal(err)
	}
	defer center.Close()
	setupToken, err := center.OwnerBootstrap(false)
	if err != nil {
		t.Fatal(err)
	}
	assetPath := os.Getenv("REDEVEN_CENTER_ASSETS")
	if assetPath == "" {
		assetPath = "../envcenter_web/dist"
	}
	assets := http.FileServer(http.Dir(assetPath))
	server := environmentcenter.NewServer(center, assets)
	defer server.Close()
	var restartConnector func() error
	var connectorPID func() int
	if binary := os.Getenv("REDEVEN_CENTER_CONNECTOR_BIN"); binary != "" {
		workerRoot, err := os.MkdirTemp("/tmp", "rdv-connector-")
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(workerRoot)
		socket := filepath.Join(workerRoot, "worker.sock")
		var worker *exec.Cmd
		var workerMu sync.Mutex
		connectorPID = func() int {
			workerMu.Lock()
			defer workerMu.Unlock()
			if worker == nil || worker.Process == nil {
				return 0
			}
			return worker.Process.Pid
		}
		stop := func() {
			if worker != nil {
				_ = worker.Process.Kill()
				_ = worker.Wait()
				worker = nil
			}
		}
		restartConnector = func() error {
			workerMu.Lock()
			defer workerMu.Unlock()
			stop()
			worker = exec.Command(binary, "connector", "--connector-socket", socket, "--center-user", strconv.Itoa(os.Geteuid()))
			worker.Stdout, worker.Stderr = io.Discard, io.Discard
			if err := worker.Start(); err != nil {
				worker = nil
				return err
			}
			for range 100 {
				conn, err := net.DialTimeout("unix", socket, 100*time.Millisecond)
				if err == nil {
					conn.Close()
					return nil
				}
				time.Sleep(50 * time.Millisecond)
			}
			return fmt.Errorf("Connector worker did not become ready")
		}
		defer stop()
		if err := restartConnector(); err != nil {
			t.Fatal(err)
		}
		server.UseConnector(socket, os.Geteuid())
	}
	web.Config.Handler = server
	web.TLS = &tls.Config{Certificates: []tls.Certificate{trustedBrowserCertificate(t, "center.acceptance.localhost", "center-runtime-a.acceptance.localhost", "center-runtime-b.acceptance.localhost", "*.acceptance.localhost")}, MinVersion: tls.VersionTLS13}
	web.StartTLS()
	defer web.Close()
	var desktopMu sync.Mutex
	var desktopDone bool
	var desktopValue string
	if external.Host != "" {
		var cleanupCatalog gp.CatalogResponse
		hostCall("catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &cleanupCatalog)
		// Leave while the task Gateway still serves removal requests, so repeated
		// qualifications cannot exhaust the external Runtime membership budget.
		defer func() {
			cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
			defer done()
			command := exec.CommandContext(cleanup, "ssh", "-x", "-o", "BatchMode=yes", external.Host, external.Root+"/bin/redeven gateway leave --state-root "+external.Root+"/state --gateway-id "+cleanupCatalog.Gateway.GatewayID+" --yes")
			if err := command.Run(); err != nil {
				t.Errorf("task Gateway cleanup: %v", err)
				return
			}
			for cleanup.Err() == nil {
				status, err := exec.CommandContext(cleanup, "ssh", "-x", "-o", "BatchMode=yes", external.Host, external.Root+"/bin/redeven gateway status --state-root "+external.Root+"/state").Output()
				if err == nil && !bytes.Contains(status, []byte(cleanupCatalog.Gateway.GatewayID)) {
					return
				}
				time.Sleep(100 * time.Millisecond)
			}
			t.Error("task Gateway membership removal did not finish")
		}()
		t.Cleanup(func() {
			_ = exec.Command("ssh", "-x", external.Host, "systemctl --user stop redeven-center-aef0-input.service").Run()
		})
	}
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if flowerRecovery != nil && flowerRecovery.serveControl(w, r) {
			return
		}
		if r.Method == "POST" && r.URL.Path == "/restart-connector" && restartConnector != nil {
			if err := restartConnector(); err != nil {
				http.Error(w, "Connector restart failed", 500)
				return
			}
			w.WriteHeader(204)
			return
		}
		if external.Host != "" && r.URL.Path == "/desktop-input/start" && r.Method == "POST" {
			command := exec.CommandContext(ctx, "ssh", "-x", external.Host, "systemd-run --user --quiet --wait --pipe --collect --unit=redeven-center-aef0-input --setenv=XDG_RUNTIME_DIR=/run/user/1000 --setenv=WAYLAND_DISPLAY=wayland-0 --setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus zenity --entry --title='Redeven Center acceptance' --text='Enter the test marker' --width=600 --timeout=120")
			var output bytes.Buffer
			command.Stdout = &output
			if err := command.Start(); err != nil {
				http.Error(w, "desktop fixture failed", 500)
				return
			}
			go func() {
				_ = command.Wait()
				desktopMu.Lock()
				defer desktopMu.Unlock()
				desktopDone = true
				desktopValue = strings.TrimSpace(output.String())
			}()
			w.WriteHeader(204)
			return
		}
		if external.Host != "" && r.URL.Path == "/desktop-input/result" && r.Method == "GET" {
			desktopMu.Lock()
			defer desktopMu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"done": desktopDone, "value": desktopValue})
			return
		}
		if r.Method == "GET" && r.URL.Path == "/resources" {
			var memory runtime.MemStats
			runtime.ReadMemStats(&memory)
			resources := map[string]any{"heap_alloc": memory.HeapAlloc, "heap_inuse": memory.HeapInuse, "sys": memory.Sys, "goroutines": runtime.NumGoroutine()}
			pids := map[string]int{"fixture": os.Getpid()}
			if connectorPID != nil {
				pids["connector"] = connectorPID()
			}
			for name, pid := range pids {
				if pid <= 0 {
					continue
				}
				raw, err := exec.CommandContext(r.Context(), "ps", "-p", strconv.Itoa(pid), "-o", "rss=").Output()
				if err != nil {
					resources[name+"_rss_error"] = err.Error()
					continue
				}
				kib, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
				if err != nil {
					resources[name+"_rss_error"] = err.Error()
					continue
				}
				resources[name+"_pid"] = pid
				resources[name+"_rss_bytes"] = kib * 1024
			}
			_ = json.NewEncoder(w).Encode(resources)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/restart-runtime" && external.Host != "" {
			command := exec.CommandContext(ctx, "ssh", "-x", "-o", "BatchMode=yes", external.Host, "sudo -n systemctl restart redeven-center-aef0-runtime.service")
			if err := command.Run(); err != nil {
				http.Error(w, "task Runtime restart failed", 500)
				return
			}
			w.WriteHeader(204)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/revoke-binding" {
			var request struct{ Target int }
			if json.NewDecoder(r.Body).Decode(&request) != nil {
				http.Error(w, "invalid", 400)
				return
			}
			for index, target := range targets {
				if index == request.Target {
					if target == nil {
						var bindings []webbinding.Binding
						if json.Unmarshal(remote("", "web-binding list"), &bindings) != nil {
							http.Error(w, "binding inventory", 500)
							return
						}
						for _, b := range bindings {
							remote("", fmt.Sprintf("web-binding revoke --yes --id %s --revision %d", b.ID, b.Revision))
						}
						w.WriteHeader(204)
						return
					}
					bindings, err := target.bindings.List()
					if err != nil {
						http.Error(w, "bindings", 500)
						return
					}
					for _, b := range bindings {
						if b.ID != "entry" {
							revision := b.Revision
							b.Enabled = false
							if _, err := target.bindings.Put(b, revision); err != nil {
								http.Error(w, "revoke", 500)
								return
							}
						}
					}
					w.WriteHeader(204)
					return
				}
			}
			http.NotFound(w, r)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/revoke-client" {
			var clients gp.ClientListResponse
			hostCall("clients/list", gp.ClientListRequest{ProtocolVersion: gp.Version}, &clients)
			for _, client := range clients.Clients {
				hostCall("clients/revoke", gp.ClientRevokeRequest{ProtocolVersion: gp.Version, ClientKeyID: client.ClientKeyID}, nil)
			}
			w.WriteHeader(204)
			return
		}
		if r.Method != "POST" || r.URL.Path != "/binding" {
			http.NotFound(w, r)
			return
		}
		var b webbinding.Binding
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&b) != nil {
			http.Error(w, "invalid binding", 400)
			return
		}
		for _, target := range targets {
			if targetID(target) == b.RuntimeID {
				if target == nil {
					raw, _ := json.Marshal(b)
					remote(string(raw), "web-binding apply --stdin --yes")
					w.WriteHeader(204)
					return
				}
				_, err := target.bindings.Put(b, b.Revision)
				if err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				w.WriteHeader(204)
				return
			}
		}
		http.NotFound(w, r)
	}))
	defer control.Close()
	fixture := map[string]any{"origin": origin, "gateway": gatewayHTTP.URL, "accessCode": code.AccessCode, "setupToken": setupToken, "control": control.URL, "workspace": workspace, "webService": webService.URL, "editorInstalled": os.Getenv("REDEVEN_CODE_SERVER_BIN") != "", "targets": []map[string]any{}}
	if os.Getenv("REDEVEN_CENTER_LARGE_FILE") == "1" {
		filePath := filepath.Join(workspace, "large-stream.bin")
		file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		const size = 1 << 30
		err = file.Truncate(size)
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			t.Fatalf("large fixture: %v %v", err, closeErr)
		}
		hash := sha256.New()
		block := make([]byte, 1<<20)
		for i := 0; i < size/len(block); i++ {
			_, _ = hash.Write(block)
		}
		fixture["largeFile"] = map[string]any{"path": filePath, "size": size, "sha256": fmt.Sprintf("%x", hash.Sum(nil))}
	}
	values := []map[string]any{}
	for _, target := range targets {
		if target == nil {
			values = append(values, map[string]any{"runtimeID": external.RuntimeID, "label": external.Host, "origin": "https://center-runtime-a.acceptance.localhost:" + port, "recoveryCodes": external.RecoveryCodes, "secret": external.Secret})
			continue
		}
		values = append(values, map[string]any{"runtimeID": targetID(target), "origin": "https://center-runtime-" + string(rune('a'+len(values))) + ".acceptance.localhost:" + port, "recoveryCodes": target.recoveryCodes, "secret": target.secret})
	}
	fixture["targets"] = values
	if external.Host != "" {
		fixture["applicationIndex"] = 1
		fixture["externalHost"] = external.Host
	}
	raw, _ := json.Marshal(fixture)
	file := filepath.Join(t.TempDir(), "center-fixture.json")
	if err = os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "node", "--use-system-ca", "../../scripts/check_center_browser.mjs", file)
	caRoot, err := exec.CommandContext(ctx, "mkcert", "-CAROOT").Output()
	if err != nil {
		t.Fatal(err)
	}
	command.Env = append(os.Environ(), "NODE_EXTRA_CA_CERTS="+filepath.Join(strings.TrimSpace(string(caRoot)), "rootCA.pem"))
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err = command.Run(); err != nil {
		t.Fatal(err)
	}
}
