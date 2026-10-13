package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in browser qualification uses the production owner page and HTTP/socket
// boundary. State responses deliberately exercise approval and transport faults.
func TestCloudManagementBrowserRecoveryExits(t *testing.T) {
	if os.Getenv("REDEVEN_CLOUD_MANAGE_BROWSER") != "1" {
		t.Skip("set REDEVEN_CLOUD_MANAGE_BROWSER=1 for browser qualification")
	}
	dir, err := os.MkdirTemp("/tmp", "rdv-cloud-browser-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "owner.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	id := ""
	state := "awaiting_confirmation"
	owner := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v2/cloud-link" {
			_, _ = io.WriteString(w, `{"ok":true,"data":{"binding":{"cloud_origin":"https://cloud.example","cloud":{"association_revision":1,"enabled":true,"approval_state":"revoked","reason_code":"AUTHORIZATION_REVOKED","connection_state":"retrying","route":{"kind":"gateway","member_id":"missing"},"route_revision":3,"next_attempt_at_unix_ms":2000000000000}},"runtime_service":{"gateway_memberships":[]}}}`)
			return
		}
		if r.URL.Path == "/v2/cloud/route/preflight" {
			var req struct {
				ID string `json:"operation_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			id = req.ID
		}
		if r.URL.Path == "/v2/cloud/route/commit" {
			state = "committed"
			http.Error(w, "lost response", http.StatusServiceUnavailable)
			return
		}
		if strings.Contains(r.URL.Path, "/operations/") || r.URL.Path == "/v2/cloud/route/preflight" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"operation_id": id, "state": state}})
			return
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{}}`)
	})}
	go func() { _ = owner.Serve(listener) }()
	defer owner.Close()
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	server.Config.Handler = cloudManagementHandler(socket, origin, "browser-owner-token")
	server.Start()
	defer server.Close()
	module, err := filepath.Abs("../../internal/envapp/ui_src/node_modules/playwright/index.mjs")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "--input-type=module")
	command.Env = append(os.Environ(), "CLOUD_MANAGE_URL="+origin+"/#browser-owner-token", "CLOUD_MANAGE_PLAYWRIGHT="+module)
	command.Stdin = strings.NewReader(`
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CLOUD_MANAGE_PLAYWRIGHT);
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.goto(process.env.CLOUD_MANAGE_URL);
 await page.getByText(/Approval: revoked/).waitFor();
 assert.equal(new URL(page.url()).hash,'');
 assert.equal(await page.getByRole('link',{name:'Manage approval'}).getAttribute('href'),'https://cloud.example');
 assert.equal(await page.getByRole('button',{name:'Retry connection'}).isEnabled(),true);
 assert.equal(await page.getByRole('button',{name:'Disconnect Cloud'}).isEnabled(),true);
 assert.match(await page.locator('#next').innerText(),/Next attempt/);
 await page.locator('#route').selectOption('direct');await page.getByRole('button',{name:'Verify route',exact:true}).click();
 await page.getByRole('button',{name:'Confirm reconnection',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('#confirm').disabled);
 const original=await page.locator('#operation').inputValue();assert.match(original,/^[A-Za-z0-9_-]{43}$/);
 page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Confirm reconnection',exact:true}).click();
 await page.getByRole('status').getByText(/Request could not be confirmed/).waitFor();
 assert.equal(await page.locator('#operation').inputValue(),original);
 await page.getByRole('button',{name:'Query result'}).click();
 await page.getByRole('status').getByText(/committed/).waitFor();
 await page.getByRole('button',{name:'Cancel pending change'}).click();
 assert.match(await page.getByRole('status').innerText(),/committed/);
 await page.getByRole('button',{name:'Review current route'}).click();
 await page.waitForFunction(()=>!document.querySelector('#verify').disabled);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
 assert.equal(await page.getByRole('button',{name:'Retry connection'}).isEnabled(),true);
 console.log('PASS owner browser: revoked approval, missing Gateway, original operation, unknown commit, committed cancellation, review and exit');
} finally {await browser.close();}
`)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("browser qualification: %v\n%s", err, output)
	} else {
		t.Log(string(output))
	}
}
