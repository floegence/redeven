package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// This short-lived owner UI is separate from Cloud and Gateway application
// surfaces. Only fixed Cloud operations cross the mode-0600 owner socket.
func (c *cli) cloudManage(socket string) int {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	origin := "http://" + listener.Addr().String()
	handler := cloudManagementHandler(socket, origin, token)
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	fmt.Fprintln(c.stdout, "Open the owner management page:", origin+"/#"+token)
	fmt.Fprintln(c.stdout, "This page expires in 30 minutes. Press Ctrl+C to close it; Runtime work continues.")
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	return 0
}

func cloudManagementHandler(socket, origin, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		nonceBytes := make([]byte, 16)
		if _, err := rand.Read(nonceBytes); err != nil {
			http.Error(w, "Management unavailable", http.StatusServiceUnavailable)
			return
		}
		nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		if "http://"+r.Host != origin || r.URL.RawQuery != "" {
			http.Error(w, "Invalid management authority", http.StatusMisdirectedRequest)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, strings.ReplaceAll(cloudManagementHTML, "NONCE", nonce))
			return
		}
		auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(auth) != len(token) || subtle.ConstantTimeCompare([]byte(auth), []byte(token)) != 1 {
			http.Error(w, "Owner management access expired. Run redeven cloud manage again.", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin || r.Method != http.MethodGet && r.Header.Get("Origin") != origin {
			http.Error(w, "Same-origin management required", http.StatusForbidden)
			return
		}
		path := r.URL.Path
		allowed := r.Method == http.MethodGet && path == "/v2/cloud-link" || r.Method == http.MethodPost && (path == "/v2/cloud/retry" || path == "/v2/cloud-link/disconnect" || path == "/v2/cloud/route/preflight" || path == "/v2/cloud/route/commit")
		if id, ok := strings.CutPrefix(path, "/v2/cloud/route/operations/"); ok && validOperationID(id) && (r.Method == http.MethodGet || r.Method == http.MethodDelete) {
			allowed = true
		}
		if !allowed {
			http.NotFound(w, r)
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 4097))
		if err != nil || len(raw) > 4096 {
			http.Error(w, "Invalid operation", http.StatusBadRequest)
			return
		}
		if len(raw) == 0 {
			raw = []byte(`{}`)
		}
		if !json.Valid(raw) {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		var data json.RawMessage
		if err := ownerRuntimeRequest(ctx, socket, r.Method, path, json.RawMessage(raw), &data); err != nil {
			http.Error(w, "Request could not be confirmed. Query the original operation ID before retrying: "+err.Error(), http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
	})
}

const cloudManagementHTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Runtime Cloud connection</title>
<style nonce="NONCE">:root{font:15px system-ui;color:#20242c;background:#f5f6f8}body{max-width:760px;margin:48px auto;padding:0 20px}section{background:white;border:1px solid #e2e5eb;border-radius:14px;padding:24px;margin:20px 0}h1{font-size:24px}h2{font-size:17px}p{line-height:1.6;color:#566071}.actions{display:flex;gap:10px;flex-wrap:wrap}button,select,input{font:inherit;border:1px solid #c9ced9;border-radius:7px;padding:9px 12px}button,select{cursor:pointer;background:white}button:disabled{cursor:not-allowed;opacity:.5}button.primary{background:#245cdc;color:white;border-color:#245cdc}label{display:block;margin:16px 0 8px}input{width:90%}#result{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#245cdc;cursor:pointer}button{white-space:nowrap}</style>
<h1>Runtime Cloud connection</h1><p>Cloud approval, connection and network route are independent. Background tasks continue while you manage the connection.</p>
<section><h2>Current state</h2><p id="facts">Loading current Runtime state…</p><p id="next"></p><div class="actions"><button id="refresh">Refresh</button><button id="retry">Retry connection</button><button id="disconnect">Disconnect Cloud</button><a id="approval" target="_blank" rel="noreferrer">Manage approval</a></div></section>
<section><h2>Change route</h2><p>Verify the destination first, then confirm reconnection. Cloud identity and ownership remain. A failed preflight keeps the current route.</p><label for="route">Selected route</label><select id="route"><option value="direct">Direct</option></select><div class="actions"><button id="verify">Verify route</button><button id="confirm" class="primary" disabled>Confirm reconnection</button><button id="cancel" disabled>Cancel pending change</button></div><label for="operation">Original operation ID</label><input id="operation" autocomplete="off" spellcheck="false"><p>After an unknown result, query this ID before starting another change. Cancel only affects changes that have not committed.</p><button id="query">Query result</button><button id="review">Review current route</button></section>
<section><h2>Operation result</h2><p id="result" role="status" aria-live="polite">No operation in progress.</p></section>
<script nonce="NONCE">
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);let current=null,pending=null,busy=false;
const by=id=>document.getElementById(id),message=text=>by('result').textContent=text;
function controls(){for(const id of ['refresh','retry','disconnect','verify','query','cancel','confirm','review'])by(id).disabled=busy;by('retry').disabled=busy||!current?.binding?.cloud;by('disconnect').disabled=busy||!current?.binding?.cloud;by('verify').disabled=busy||!!pending||!current?.binding?.cloud;by('confirm').disabled=busy||pending?.state!=='awaiting_confirmation';by('cancel').disabled=busy||!pending;by('route').disabled=busy||!!pending;}
async function request(path,method='GET',body){const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();}
async function refresh(){current=await request('/v2/cloud-link');const c=current.binding.cloud;by('facts').textContent=c?'Approval: '+c.approval_state+' · Connection: '+c.connection_state+' · Route: '+c.route.kind+(c.route.member_id?' ('+c.route.member_id+')':''):'This Runtime is not enrolled. Use a Cloud setup ticket or Gateway batch approval.';by('next').textContent=c?.next_attempt_at_unix_ms?'Next attempt: '+new Date(c.next_attempt_at_unix_ms).toLocaleString():'';by('approval').hidden=!current.binding.cloud_origin;if(current.binding.cloud_origin)by('approval').href=current.binding.cloud_origin;by('route').replaceChildren(new Option('Direct','direct'));for(const m of current.runtime_service.gateway_memberships||[])by('route').add(new Option(m.gateway_name+' · '+m.phase,m.member_id));if(c)by('route').value=c.route.kind==='direct'?'direct':c.route.member_id;controls();}
async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){message(e.message);}finally{busy=false;controls();}}
function remember(op){pending=op;by('operation').value=op.operation_id;message('Operation '+op.operation_id+'\n'+op.state+(op.state==='committed'?' · New route saved. Reconnection may still be in progress.':''));controls();}
by('refresh').onclick=()=>run(refresh);
by('retry').onclick=()=>run(async()=>{await request('/v2/cloud/retry','POST',{expected_association_revision:current.binding.cloud.association_revision});message('Connection intent resumed. Cloud approval is checked independently.');await refresh();});
by('disconnect').onclick=()=>run(async()=>{if(!confirm('Disconnect Cloud sessions and stop local connection intent? Background tasks continue.'))return;await request('/v2/cloud-link/disconnect','POST',{});message('Local Cloud intent stopped. Cloud approval is unchanged.');await refresh();});
by('verify').onclick=()=>run(async()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));const id=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');const c=current.binding.cloud,choice=by('route').value;by('operation').value=id;pending={operation_id:id,state:'unknown'};message('Verifying route. Operation '+id);remember(await request('/v2/cloud/route/preflight','POST',{operation_id:id,expected_route_revision:c.route_revision,selection:choice==='direct'?{kind:'direct'}:{kind:'gateway',member_id:choice}}));});
by('query').onclick=()=>run(async()=>{const id=by('operation').value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw Error('Enter the original operation ID.');remember(await request('/v2/cloud/route/operations/'+id));await refresh();});
by('review').onclick=()=>run(async()=>{await refresh();if(!confirm('The original operation may already have committed. Review the current route above before starting a new change.'))return;pending=null;by('operation').value='';message('Current route reviewed. A new change is a separate operation.');});
by('confirm').onclick=()=>run(async()=>{if(!confirm('Reconnect through the verified route? Cloud sessions close; background tasks continue.'))return;remember(await request('/v2/cloud/route/commit','POST',{operation_id:pending.operation_id,confirmed:true}));await refresh();});
by('cancel').onclick=()=>run(async()=>{remember(await request('/v2/cloud/route/operations/'+pending.operation_id,'DELETE'));await refresh();if(pending.state==='cancelled')pending=null;});
run(refresh);
</script></html>`
