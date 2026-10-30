package environmentcenter

import (
	"context"
	"fmt"
	"html/template"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
)

const accessCookie = "__Host-redeven-access"

type openOperation struct {
	Sequence                       int64  `json:"sequence" minimum:"0"`
	ID                             string `json:"id"`
	RequestID                      string `json:"request_id"`
	RouteID                        string `json:"route_id"`
	Status                         string `json:"status" enum:"connecting,ready,failed,canceled"`
	Error                          string `json:"error,omitempty"`
	Destination                    string `json:"destination,omitempty"`
	session, device                string
	route                          Route
	expires                        time.Time
	nonceHash, challenge, codeHash string
	consumed                       bool
	accessToken                    string
	connection                     routeConnection
	accessOwner                    *openOperation
	parent                         *openOperation
	appKind, appID, appPath        string
	appInstance                    string
	runtimeCookie                  http.Cookie
	ctx                            context.Context
	cancel                         context.CancelFunc
}
type accessSession struct {
	operation *openOperation
	ctx       context.Context
	requests  int
}
type webAccess struct {
	mu                 sync.Mutex
	center             *Center
	operations         map[string]*openOperation
	access             map[string]*accessSession
	pluginRoutes       map[string]*accessSession
	pluginPreparations map[string]*pluginOriginPreparation
	closed             bool
	requests           int
	deviceRequests     map[string]int
	validateOrigin     func(string) error
	connectorSocket    string
	connectorUID       int
}

func newWebAccess(c *Center) *webAccess {
	return &webAccess{center: c, operations: map[string]*openOperation{}, access: map[string]*accessSession{}, pluginRoutes: map[string]*accessSession{}, pluginPreparations: map[string]*pluginOriginPreparation{}, deviceRequests: map[string]int{}}
}
func (a *webAccess) open(token, routeID, requestID string) (openOperation, error) {
	if len(requestID) < 16 || len(requestID) > 100 {
		return openOperation{}, ErrDenied
	}
	c := a.center
	c.mu.Lock()
	device, err := c.sessionLocked(token)
	if err != nil {
		c.mu.Unlock()
		return openOperation{}, err
	}
	var route Route
	var record GatewayRecord
	for _, r := range c.state.Routes {
		if r.ID == routeID {
			route = r
			break
		}
	}
	for _, g := range c.state.Gateways {
		if g.ID == route.SourceID {
			record = g
			break
		}
	}
	if route.ID == "" || record.ID == "" {
		c.mu.Unlock()
		return openOperation{}, ErrDenied
	}
	ctx, cancel := context.WithCancel(device.Context)
	deviceReference := device.Device
	// Publish while holding directory authority: removal cannot miss this admission.
	defer c.mu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, op := range a.operations {
		if time.Now().After(op.expires) && (op.ctx.Err() != nil || !op.consumed || op.accessOwner != nil) {
			op.cancel()
			a.releaseLocked(op)
			delete(a.operations, id)
		}
	}
	count, receipts := 0, 0
	for _, op := range a.operations {
		if op.session == token {
			receipts++
			if op.ctx.Err() == nil && op.accessOwner == nil {
				count++
			}
			if op.RequestID == requestID {
				cancel()
				if op.RouteID != routeID {
					return openOperation{}, ErrConflict
				}
				return publicOperation(op), nil
			}
		}
	}
	var existing *openOperation
	for _, access := range a.access {
		if access.ctx.Err() == nil && access.operation.session == token && access.operation.RouteID == routeID && access.operation.parent == nil {
			existing = access.operation
			break
		}
	}
	if a.closed || len(a.operations) >= 128 || receipts >= 32 || count >= 16 && existing == nil {
		cancel()
		return openOperation{}, ErrBusy
	}
	id := randomID()
	op := &openOperation{Sequence: 1, ID: id, RequestID: requestID, RouteID: routeID, Status: "connecting", session: token, device: deviceReference, route: route, expires: time.Now().Add(5 * time.Minute), ctx: ctx, cancel: cancel}
	op.accessOwner = existing
	a.operations[id] = op
	context.AfterFunc(ctx, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.releaseLocked(op)
	})
	go func() {
		timer := time.NewTimer(time.Until(op.expires))
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if !op.consumed {
			op.cancel()
			a.releaseLocked(op)
		}
	}()
	if existing != nil {
		op.Sequence++
		op.Status = "ready"
		op.Destination = route.Origin + "/__center/start?operation=" + url.QueryEscape(id)
		return publicOperation(op), nil
	}
	go func() {
		var owner routeConnection
		var err error
		if a.connectorSocket != "" {
			owner, err = connectWorker(ctx, a.connectorSocket, a.connectorUID, record, route, deviceReference)
		} else {
			owner, err = connect(ctx, record, route, deviceReference)
		}
		if err == nil {
			probe, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			req, _ := http.NewRequestWithContext(probe, "GET", gatewaymembership.ServiceOrigin(route.RuntimeID)+"/", nil)
			req.Host = strings.TrimPrefix(route.Origin, "https://")
			response, e := owner.RoundTrip(req)
			err = e
			if response != nil {
				_ = response.Body.Close()
				if response.Header.Get("X-Redeven-Web-Entry") != "center-v1" {
					err = fmt.Errorf("CENTER_RUNTIME_UNSUPPORTED")
				} else if response.StatusCode == http.StatusMisdirectedRequest {
					err = fmt.Errorf("CENTER_BINDING_REQUIRED")
				} else if response.StatusCode >= 500 {
					err = fmt.Errorf("CENTER_CONNECTION_FAILED")
				}
			}
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if ctx.Err() != nil {
			if owner != nil {
				go owner.Close()
			}
			op.Sequence++
			op.Status = "canceled"
			return
		}
		if err != nil {
			if owner != nil {
				go owner.Close()
			}
			op.Sequence++
			op.Status = "failed"
			op.Error = connectionCode(err)
			if err.Error() == "CENTER_BINDING_REQUIRED" || err.Error() == "CENTER_RUNTIME_UNSUPPORTED" {
				op.Error = err.Error()
			}
			cancel()
			return
		}
		op.connection = owner
		op.Sequence++
		op.Status = "ready"
		op.Destination = route.Origin + "/__center/start?operation=" + url.QueryEscape(id)
	}()
	return publicOperation(op), nil
}

// releaseLocked removes admission capabilities immediately; a short operation
// tombstone retains the original outcome for same-request retries.
func (a *webAccess) releaseLocked(op *openOperation) {
	for origin, preparation := range a.pluginPreparations {
		if preparation.parent == op {
			preparation.cancel()
			delete(a.pluginPreparations, origin)
		}
	}
	for origin, access := range a.pluginRoutes {
		if access.operation == op || access.operation.parent == op {
			access.operation.cancel()
			delete(a.pluginRoutes, origin)
		}
	}
	for key, access := range a.access {
		if access.operation == op {
			delete(a.access, key)
		}
	}
	op.accessToken = ""
	if op.Status == "ready" || op.Status == "connecting" {
		op.Sequence++
		op.Status = "canceled"
	}
}
func publicOperation(op *openOperation) openOperation {
	sequence := op.Sequence
	return openOperation{Sequence: sequence, ID: op.ID, RequestID: op.RequestID, RouteID: op.RouteID, Status: op.Status, Error: op.Error, Destination: op.Destination}
}
func (a *webAccess) operation(token, id string, cancel bool) (openOperation, error) {
	if _, err := a.center.Session(token); err != nil {
		return openOperation{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	op := a.operations[id]
	if op == nil || op.session != token {
		return openOperation{}, ErrDenied
	}
	if cancel {
		op.cancel()
		a.releaseLocked(op)
	}
	return publicOperation(op), nil
}
func (a *webAccess) removeSource(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, op := range a.operations {
		if op.route.SourceID == id {
			op.cancel()
			a.releaseLocked(op)
		}
	}
}
func (a *webAccess) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closed = true
	for _, op := range a.operations {
		op.cancel()
		a.releaseLocked(op)
	}
}
func (a *webAccess) start(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("operation")
	a.mu.Lock()
	op := a.operations[id]
	if r.Method != "GET" || op == nil || r.Host != strings.TrimPrefix(op.route.Origin, "https://") || op.Status != "ready" || op.ctx.Err() != nil || !time.Now().Before(op.expires) || op.consumed {
		a.mu.Unlock()
		http.Error(w, "CENTER_HANDOFF_EXPIRED", http.StatusForbidden)
		return
	}
	nonce := randomID()
	op.nonceHash = digest(nonce)
	op.challenge = randomID()
	op.codeHash = ""
	challenge := op.challenge
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "__Host-redeven-launch-" + id, Value: nonce, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 300})
	http.Redirect(w, r, a.center.key.Origin+"/__center/authorize?operation="+url.QueryEscape(id)+"&challenge="+url.QueryEscape(challenge), http.StatusSeeOther)
}

var handoffPage = template.Must(template.New("handoff").Parse(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="strict-origin"><title>Redeven</title><body><form method="post" action="{{.Target}}"><input type="hidden" name="operation" value="{{.Operation}}"><input type="hidden" name="challenge" value="{{.Challenge}}"><input type="hidden" name="code" value="{{.Code}}"></form><script nonce="{{.Nonce}}">document.forms[0].submit()</script></body></html>`))

func (a *webAccess) authorize(w http.ResponseWriter, r *http.Request, token string) {
	if _, err := a.center.Session(token); err != nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	a.mu.Lock()
	op := a.operations[r.URL.Query().Get("operation")]
	if r.Method != "GET" || op == nil || op.session != token || op.Status != "ready" || op.ctx.Err() != nil || !time.Now().Before(op.expires) || op.challenge != r.URL.Query().Get("challenge") || op.nonceHash == "" || op.consumed {
		a.mu.Unlock()
		http.Error(w, "CENTER_HANDOFF_EXPIRED", http.StatusForbidden)
		return
	}
	code := randomID()
	op.codeHash = digest(code)
	target, id, challenge := op.route.Origin+"/__center/finish", op.ID, op.challenge
	a.mu.Unlock()
	nonce := randomID()
	// A form POST needs a real Origin. Strict-origin discloses no path or code.
	w.Header().Set("Referrer-Policy", "strict-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action "+target+"; script-src 'nonce-"+nonce+"'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = handoffPage.Execute(w, map[string]string{"Target": target, "Operation": id, "Challenge": challenge, "Code": code, "Nonce": nonce})
}
func (a *webAccess) finish(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || (r.Header.Get("Origin") != a.center.key.Origin && r.Header.Get("Origin") != "https://"+r.Host) {
		http.Error(w, "CENTER_ORIGIN_DENIED", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if r.ParseForm() != nil {
		http.Error(w, "CENTER_INVALID_REQUEST", 400)
		return
	}
	id := r.PostForm.Get("operation")
	nonce, err := r.Cookie("__Host-redeven-launch-" + id)
	a.mu.Lock()
	defer a.mu.Unlock()
	op := a.operations[id]
	if op == nil || op.ctx.Err() != nil || !time.Now().Before(op.expires) || op.Status != "ready" || r.Host != strings.TrimPrefix(op.route.Origin, "https://") || op.challenge != r.PostForm.Get("challenge") || op.codeHash != digest(r.PostForm.Get("code")) {
		http.Error(w, "CENTER_HANDOFF_EXPIRED", http.StatusForbidden)
		return
	}
	// Complete from the environment's own top-level document. WebKit can omit a
	// Lax cookie on the cross-origin POST even within localhost test domains.
	// The second POST still requires the original HttpOnly browser nonce.
	if r.Header.Get("Origin") == a.center.key.Origin {
		scriptNonce := randomID()
		w.Header().Set("Referrer-Policy", "strict-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'nonce-"+scriptNonce+"'")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = handoffPage.Execute(w, map[string]string{"Target": op.route.Origin + "/__center/finish", "Operation": op.ID, "Challenge": op.challenge, "Code": r.PostForm.Get("code"), "Nonce": scriptNonce})
		return
	}
	if err != nil || op.nonceHash != digest(nonce.Value) {
		http.Error(w, "CENTER_HANDOFF_EXPIRED", http.StatusForbidden)
		return
	}
	// A retried POST recovers this same access capability; it cannot mint a new one.
	if !op.consumed {
		if owner := op.accessOwner; owner != nil {
			if owner.ctx.Err() != nil || owner.accessToken == "" || a.access[digest(owner.accessToken)] == nil {
				http.Error(w, "CENTER_ACCESS_EXPIRED", http.StatusForbidden)
				return
			}
			op.accessToken = owner.accessToken
			op.consumed = true
		} else {
			if len(a.access) >= 64 {
				http.Error(w, "CENTER_BUSY", 429)
				return
			}
			op.accessToken = randomID()
			op.consumed = true
			a.access[digest(op.accessToken)] = &accessSession{operation: op, ctx: op.ctx}
		}
	}
	http.SetCookie(w, &http.Cookie{Name: accessCookie, Value: op.accessToken, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: int(SessionAbsolute.Seconds())})
	destination := "/"
	if op.appPath != "" {
		destination = op.appPath
	}
	http.Redirect(w, r, destination, http.StatusSeeOther)
}
func (a *webAccess) serve(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	access := a.pluginRoutes["https://"+r.Host]
	if access == nil {
		cookie, err := r.Cookie(accessCookie)
		if err != nil {
			a.mu.Unlock()
			http.Error(w, "CENTER_ACCESS_REQUIRED", http.StatusUnauthorized)
			return
		}
		access = a.access[digest(cookie.Value)]
	}
	if access == nil || access.ctx.Err() != nil || access.operation.route.Origin != "https://"+r.Host {
		a.mu.Unlock()
		http.Error(w, "CENTER_ACCESS_EXPIRED", http.StatusUnauthorized)
		return
	}
	if access.requests >= 16 || a.deviceRequests[access.operation.device] >= 48 || a.requests >= 192 {
		a.mu.Unlock()
		w.Header().Set("Retry-After", "1")
		http.Error(w, "CENTER_BUSY", 429)
		return
	}
	access.requests++
	a.requests++
	a.deviceRequests[access.operation.device]++
	op := access.operation
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		access.requests--
		a.requests--
		a.deviceRequests[access.operation.device]--
		if a.deviceRequests[access.operation.device] == 0 {
			delete(a.deviceRequests, access.operation.device)
		}
		a.mu.Unlock()
	}()
	if _, err := a.center.Session(op.session); err != nil {
		op.cancel()
		http.Error(w, "CENTER_ACCESS_EXPIRED", http.StatusUnauthorized)
		return
	}
	if op.appKind == "plugin" && strings.HasPrefix(r.URL.Path, "/__center/") {
		http.Error(w, "CENTER_ORIGIN_DENIED", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/__center/plugin-origins" {
		a.pluginOrigin(w, r, op)
		return
	}
	if r.URL.Path == "/__center/applications" {
		a.application(w, r, op)
		return
	}
	if r.URL.Path == "/__center/session" && r.Method == "GET" {
		device, err := a.center.Session(op.session)
		writeJSON(w, struct {
			Device       Device `json:"device"`
			CenterOrigin string `json:"portal_origin"`
		}{device, a.center.key.Origin}, err)
		return
	}
	if r.URL.Path == "/__center/activity" {
		if op.parent != nil {
			http.Error(w, "CENTER_ORIGIN_DENIED", 403)
			return
		}
		if r.Method != "POST" || r.Header.Get("Origin") != op.route.Origin || r.Header.Get("X-Redeven-Activity") != "user-input" {
			http.Error(w, "CENTER_ORIGIN_DENIED", 403)
			return
		}
		device, err := a.center.Activity(op.session)
		writeJSON(w, device, err)
		return
	}
	if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != op.route.Origin {
		http.Error(w, "CENTER_ORIGIN_DENIED", 403)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	detach := context.AfterFunc(access.ctx, cancel)
	defer detach()
	defer cancel()
	r = r.WithContext(ctx)
	if op.parent != nil {
		// The authenticated Runtime application owns its frame policy. Keeping
		// Center's DENY as a second value breaks the editor's same-origin worker
		// iframe even when Runtime correctly supplies SAMEORIGIN or stricter CSP.
		w.Header().Del("X-Frame-Options")
	}
	target, _ := url.Parse(gatewaymembership.ServiceOrigin(op.route.RuntimeID))
	proxy := &httputil.ReverseProxy{Transport: op.connection, FlushInterval: -1, Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(target)
		upstreamOrigin := op.route.Origin
		if op.parent != nil {
			upstreamOrigin = op.parent.route.Origin
		}
		p.Out.Host = strings.TrimPrefix(upstreamOrigin, "https://")
		for key := range p.Out.Header {
			lower := strings.ToLower(key)
			if strings.HasPrefix(lower, "x-forwarded-") || (strings.HasPrefix(lower, "x-redeven-") && lower != "x-redeven-plugin-session" && lower != "x-redeven-access-resume") || lower == "forwarded" || lower == "authorization" || lower == "proxy-authorization" {
				p.Out.Header.Del(key)
			}
		}
		p.Out.Header.Del("Cookie")
		for _, cookie := range p.In.Cookies() {
			if !strings.HasPrefix(cookie.Name, "__Host-redeven-") && (op.parent == nil || !strings.HasPrefix(cookie.Name, "redeven_local_access") && !strings.HasPrefix(cookie.Name, "redeven_auth_challenge")) {
				p.Out.AddCookie(cookie)
			}
		}
		if op.parent != nil {
			p.Out.URL.Path = "/api/local/web-applications/" + op.appKind + "/" + op.appID + p.In.URL.Path
			p.Out.URL.RawPath = ""
			if op.appKind == "pf" && p.In.URL.Path == "/flowersec/v3/direct" {
				p.Out.URL.Path = p.In.URL.Path
				p.Out.Header.Set("X-Redeven-Web-App-ID", op.appID)
			}
			p.Out.Header.Set("Origin", op.parent.route.Origin)
			p.Out.Header.Set("X-Redeven-Web-App-Origin", op.route.Origin)
			p.Out.Header.Set("X-Redeven-Web-App-Instance", op.appInstance)
			p.Out.Header.Del("X-Redeven-Plugin-Session")
			p.Out.Header.Del("X-Redeven-Access-Resume")
			p.Out.AddCookie(&op.runtimeCookie)
		}
	}, ModifyResponse: func(response *http.Response) error {
		// Runtime cookies remain host-only. A remote application cannot replace the
		// Center's separate admission cookies or expand them to sibling origins.
		cookies := response.Cookies()
		response.Header.Del("Set-Cookie")
		for _, cookie := range cookies {
			if cookie.Domain != "" || strings.HasPrefix(cookie.Name, "__Host-redeven-") || op.parent != nil && (strings.HasPrefix(cookie.Name, "redeven_local_access") || strings.HasPrefix(cookie.Name, "redeven_auth_challenge")) {
				continue
			}
			cookie.Secure = true
			response.Header.Add("Set-Cookie", cookie.String())
		}
		response.Header.Set("Cache-Control", "no-store")
		response.Header.Set("Referrer-Policy", "no-referrer")
		return nil
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
		http.Error(w, connectionCode(err), http.StatusBadGateway)
	}}
	proxy.ServeHTTP(w, r)
}

func (a *webAccess) removeRoute(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, op := range a.operations {
		if op.RouteID == id {
			op.cancel()
			a.releaseLocked(op)
		}
	}
}
