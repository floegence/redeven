package environmentcenter

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "__Host-redeven-center"
const browserCookie = "__Host-redeven-preauth"

type Server struct {
	// Set once before serving; the standalone deployment validates every route SAN.
	ValidateOriginCertificate func(string) error
	center                    *Center
	access                    *webAccess
	assets                    http.Handler
	mu                        sync.Mutex
	pairs                     map[string]*pendingPair
	mutations                 map[string]*mutationResult
	gatewayTotal              int
	gatewayDevices            map[string]int
	gatewaySources            map[string]int
}

func NewServer(center *Center, assets http.Handler) *Server {
	server := &Server{center: center, access: newWebAccess(center), assets: assets, pairs: map[string]*pendingPair{}, mutations: map[string]*mutationResult{}, gatewayDevices: map[string]int{}, gatewaySources: map[string]int{}}
	server.access.validateOrigin = func(origin string) error {
		if server.ValidateOriginCertificate != nil {
			return server.ValidateOriginCertificate(origin)
		}
		return nil
	}
	return server
}
func (s *Server) Close() { s.access.Close() }

// UseConnector selects the isolated local worker before serving requests.
// Deployed Center never falls back if its configured worker is unavailable.
func (s *Server) UseConnector(socket string, uid int) {
	s.access.connectorSocket = socket
	s.access.connectorUID = uid
}
func cookieValue(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}
func setCookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func readJSON(w http.ResponseWriter, r *http.Request, out any) error {
	if r.Header.Get("Content-Type") != "application/json" {
		return ErrDenied
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return ErrDenied
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ErrDenied
	}
	return nil
}
func writeJSON(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		status := 400
		code := err.Error()
		switch {
		case errors.Is(err, ErrDenied), errors.Is(err, ErrExpired), errors.Is(err, ErrFactor):
			status = 403
		case errors.Is(err, ErrBusy):
			status = 429
			w.Header().Set("Retry-After", "2")
		case errors.Is(err, ErrConflict):
			status = 409
		default:
			if !strings.HasPrefix(code, "CENTER_") && !strings.HasPrefix(code, "GATEWAY_") {
				code = "CENTER_REQUEST_FAILED"
			}
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]string{"code": code}})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": value})
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	if r.TLS == nil {
		http.Error(w, "HTTPS required", 400)
		return
	}
	origin := "https://" + r.Host
	if origin != s.center.key.Origin {
		// Route identity comes only from the authenticated operation or access record.
		switch r.URL.Path {
		case "/__center/start":
			s.access.start(w, r)
		case "/__center/finish":
			s.access.finish(w, r)
		default:
			s.access.serve(w, r)
		}
		return
	}
	if r.URL.Path == "/healthz" && r.Method == "GET" {
		writeJSON(w, map[string]string{"status": "ready"}, nil)
		return
	}
	if r.URL.Path == "/__center/authorize" {
		s.access.authorize(w, r, cookieValue(r, sessionCookie))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/center/v1/") {
		if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin || r.Method != "GET" && (r.Header.Get("Origin") != origin || r.Header.Get("X-Redeven-Center") != "1") {
			writeJSON(w, nil, ErrDenied)
			return
		}
		s.mutation(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
	if s.assets == nil {
		http.Error(w, "Center UI assets are unavailable", 503)
		return
	}
	s.assets.ServeHTTP(w, r)
}
func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	token, browser := cookieValue(r, sessionCookie), cookieValue(r, browserCookie)
	route := strings.TrimPrefix(r.URL.Path, "/api/center/v1/")
	if route == "status" && r.Method == "GET" {
		if browser == "" {
			browser = randomID()
			setCookie(w, browserCookie, browser, int(SetupLifetime.Seconds()))
		}
		device, err := s.center.Session(token)
		security := s.center.Security()
		if err != nil {
			security.Revision = 0
			security.RecoveryRemaining = 0
		}
		writeJSON(w, Status{Security: security, Authenticated: err == nil, Device: device, Origin: s.center.key.Origin}, nil)
		return
	}
	if route == "authenticate" && r.Method == "POST" {
		var request Authentication
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		source, _, _ := net.SplitHostPort(r.RemoteAddr)
		authSession := ""
		if request.Action != "" {
			authSession = token
		}
		result, err := s.center.Authenticate(browser, authSession, source, r.UserAgent(), request)
		if err == nil && result.Token != "" {
			setCookie(w, sessionCookie, result.Token, int(SessionAbsolute.Seconds()))
			setCookie(w, browserCookie, randomID(), int(SessionAbsolute.Seconds()))
		}
		writeJSON(w, result, err)
		return
	}
	if strings.HasPrefix(route, "setup/") && r.Method == "POST" {
		var request SetupRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		owner := ""
		if request.Replacement {
			owner = token
		}
		switch route {
		case "setup/start":
			result, err := s.center.SetupStart(request.Bootstrap, browser, request.Password)
			writeJSON(w, result, err)
		case "setup/verify":
			result, err := s.center.SetupVerify(request.Operation, browser, owner, request.Code)
			writeJSON(w, result, err)
		case "setup/commit":
			err := s.center.SetupCommit(request.Operation, browser, owner, request.Saved)
			writeJSON(w, struct{}{}, err)
		case "setup/cancel":
			s.center.SetupCancel(request.Operation, browser, owner)
			writeJSON(w, struct{}{}, nil)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if _, err := s.center.Session(token); err != nil {
		writeJSON(w, nil, err)
		return
	}
	if r.Method == "GET" {
		switch route {
		case "directory":
			result, err := s.center.Directory(token)
			writeJSON(w, result, err)
		case "devices":
			result, err := s.center.Devices(token)
			writeJSON(w, result, err)
		case "security":
			writeJSON(w, s.center.Security(), nil)
		case "audit":
			s.center.mu.Lock()
			events := append([]auditEvent(nil), s.center.state.Audit...)
			s.center.mu.Unlock()
			writeJSON(w, events, nil)
		case "catalog":
			record, err := s.center.source(token, r.URL.Query().Get("source"))
			if err != nil {
				writeJSON(w, nil, err)
				return
			}
			ctx, release, err := s.gatewayRequest(r.Context(), token, record.ID)
			if err != nil {
				writeJSON(w, nil, err)
				return
			}
			defer release()
			g := newGatewayClient(record)
			defer g.close()
			result, err := g.catalog(ctx)
			writeJSON(w, result, err)
		case "binding":
			result, err := s.center.binding(token, r.URL.Query().Get("route"))
			writeJSON(w, result, err)
		case "operations":
			result, err := s.access.operation(token, r.URL.Query().Get("id"), false)
			writeJSON(w, result, err)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	switch route {
	case "activity":
		var request struct{}
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.center.Activity(token)
		writeJSON(w, result, err)
	case "devices/revoke":
		var request RevokeDeviceRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		writeJSON(w, struct{}{}, s.center.Revoke(token, request.ID, request.All))
	case "password":
		var request PasswordRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		writeJSON(w, struct{}{}, s.center.ChangePassword(token, request.Grant, request.Password))
	case "factor/replace":
		var request GrantRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.center.ReplaceFactor(browser, token, request.Grant)
		writeJSON(w, result, err)
	case "recovery/rotate":
		var request GrantRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.center.RotateRecovery(browser, token, request.Grant)
		writeJSON(w, result, err)
	case "gateways/begin":
		s.beginPair(w, r, token)
	case "gateways/complete":
		s.completePair(w, r, token)
	case "bookmarks/add":
		var req AddBookmarkRequest
		if err := readJSON(w, r, &req); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.center.addBookmark(token, req.Grant, req.Input)
		writeJSON(w, result, err)
	case "bookmarks/remove":
		var req RemoveBookmarkRequest
		if err := readJSON(w, r, &req); err != nil {
			writeJSON(w, nil, err)
			return
		}
		writeJSON(w, struct{}{}, s.center.removeBookmark(token, req.ID, req.Revision))
	case "routes/add":
		var request AddRouteRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		if s.ValidateOriginCertificate != nil {
			if err := s.ValidateOriginCertificate(request.Input.Origin); err != nil {
				writeJSON(w, nil, err)
				return
			}
		}
		record, err := s.center.source(token, request.Input.SourceID)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		ctx, release, err := s.gatewayRequest(r.Context(), token, record.ID)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		defer release()
		g := newGatewayClient(record)
		defer g.close()
		catalog, err := g.catalog(ctx)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		found := false
		for _, member := range catalog.Members {
			if member.MemberID == request.Input.MemberID && member.RuntimePublicID == request.Input.RuntimeID && member.State == "active" {
				found = true
			}
		}
		if !found {
			writeJSON(w, nil, ErrDenied)
			return
		}
		value, binding, err := s.center.addRoute(token, request.Grant, request.Input)
		writeJSON(w, RouteResult{value, binding}, err)
	case "routes/rotate":
		var request RotateRouteRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		binding, err := s.center.rotateRoute(token, request.Grant, request.Input)
		if err == nil {
			s.access.removeRoute(request.Input.ID)
		}
		writeJSON(w, binding, err)
	case "routes/favorite":
		var request FavoriteRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		writeJSON(w, struct{}{}, s.center.favorite(token, request.ID, request.Value, request.Revision))
	case "sources/remove":
		var request RemoveSourceRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		err := s.center.removeSource(token, request.Grant, request.ID, request.Revision)
		if err == nil {
			s.access.removeSource(request.ID)
		}
		writeJSON(w, struct{}{}, err)
	case "open":
		var request OpenRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.access.open(token, request.Route, request.Request)
		writeJSON(w, result, err)
	case "operations/cancel":
		var request CancelRequest
		if err := readJSON(w, r, &request); err != nil {
			writeJSON(w, nil, err)
			return
		}
		result, err := s.access.operation(token, request.ID, true)
		writeJSON(w, result, err)
	default:
		http.NotFound(w, r)
	}
}
func (s *Server) beginPair(w http.ResponseWriter, r *http.Request, token string) {
	var req BeginPairRequest
	if err := readJSON(w, r, &req); err != nil {
		writeJSON(w, nil, err)
		return
	}
	s.center.mu.Lock()
	err := s.center.grantLocked(token, req.Grant, actionDigest("gateway:add", struct {
		URL      string `json:"url"`
		Name     string `json:"name"`
		CodeHash string `json:"code_hash"`
	}{req.URL, req.Name, digest(req.AccessCode)}))
	s.center.mu.Unlock()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	ctx, release, err := s.gatewayRequest(r.Context(), token, "pairing")
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	defer release()
	pair, err := beginPair(ctx, req.URL, req.Name, req.AccessCode, token)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, p := range s.pairs {
		if !time.Now().Before(p.expires) {
			delete(s.pairs, k)
		}
	}
	if len(s.pairs) >= 8 {
		writeJSON(w, nil, ErrBusy)
		return
	}
	id := randomID()
	s.pairs[id] = pair
	writeJSON(w, PairPreview{Operation: id, GatewayID: pair.record.GatewayID, Fingerprint: pair.challenge.GatewayPublicKeyFingerprint, URL: pair.record.URL}, nil)
}
func (s *Server) completePair(w http.ResponseWriter, r *http.Request, token string) {
	var req CompletePairRequest
	if err := readJSON(w, r, &req); err != nil {
		writeJSON(w, nil, err)
		return
	}
	s.mu.Lock()
	pair := s.pairs[req.Operation]
	if pair == nil || pair.session != token || pair.challenge.GatewayPublicKeyFingerprint != req.Fingerprint {
		s.mu.Unlock()
		writeJSON(w, nil, ErrDenied)
		return
	}
	s.mu.Unlock()
	pair.mu.Lock()
	defer pair.mu.Unlock()
	if pair.committed {
		writeJSON(w, struct{}{}, nil)
		return
	}
	if _, err := s.center.Session(token); err != nil {
		writeJSON(w, nil, err)
		return
	}
	if !time.Now().Before(pair.expires) {
		writeJSON(w, nil, ErrExpired)
		return
	}
	if !pair.completed {
		ctx, release, err := s.gatewayRequest(r.Context(), token, "pairing")
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		defer release()
		if _, err := pair.complete(ctx); err != nil {
			writeJSON(w, nil, err)
			return
		}
		pair.completed = true
	}
	err := s.center.addGateway(token, pair.record, req.Revision)
	if err == nil {
		pair.committed = true
	}
	writeJSON(w, struct{}{}, err)
}
func (s *Server) origin() *url.URL { u, _ := url.Parse(s.center.key.Origin); return u }
