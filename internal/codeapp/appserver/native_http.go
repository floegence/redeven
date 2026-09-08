package appserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// NativeCodeSpaceBinding is resolved by the lifecycle owner after authorization.
// Context ends before the instance can be stopped or replaced; ports are never identity.
type NativeCodeSpaceBinding struct {
	CodeSpaceID     string
	InstanceID      string
	WorkspacePath   string
	Port            int
	Context         context.Context
	AdmitConnection func() (func(), bool)
}

// LocalNativeCodeSpaceBinding applies the current Code App permission cap before
// disclosing or resolving a running instance. Listener and AccessGate admission
// remain owned by Local UI.
func (g *Server) LocalNativeCodeSpaceBinding(w http.ResponseWriter, r *http.Request, id string) (NativeCodeSpaceBinding, bool) {
	if _, ok := g.requirePermission(w, WithLocalUICodeSpaceRoute(r, id), requiredPermissionFull); !ok {
		return NativeCodeSpaceBinding{}, false
	}
	binding, err := g.backend.BindRunningCodeSpace(r.Context(), id)
	if err != nil {
		http.Error(w, "codespace not ready", http.StatusConflict)
		return NativeCodeSpaceBinding{}, false
	}
	return binding, true
}

// NewNativeCodeSpaceHandler serves only the bound editor, never the product router.
// Its caller owns request authorization and must cancel its binding on revocation.
func NewNativeCodeSpaceHandler(binding NativeCodeSpaceBinding) (http.Handler, func(), error) {
	if binding.CodeSpaceID == "" || binding.InstanceID == "" || binding.Context == nil || binding.Port < 1 || binding.Port > 65535 {
		return nil, nil, errors.New("invalid native codespace binding")
	}
	ctx, cancel := context.WithCancel(binding.Context)
	var mu sync.Mutex
	connections := make(map[net.Conn]struct{})
	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", binding.Port)}
	transport := &http.Transport{DisableCompression: true, MaxConnsPerHost: 64, MaxIdleConnsPerHost: 16, IdleConnTimeout: 60 * time.Second, ResponseHeaderTimeout: 30 * time.Second,
		DialContext: func(requestCtx context.Context, network, address string) (net.Conn, error) {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			release := func() {}
			if binding.AdmitConnection != nil {
				var admitted bool
				release, admitted = binding.AdmitConnection()
				if !admitted {
					return nil, errors.New("native connection limit reached")
				}
			}
			retained := false
			defer func() {
				if !retained {
					release()
				}
			}()
			dialCtx, stop := context.WithCancel(requestCtx)
			defer stop()
			stopBinding := context.AfterFunc(ctx, stop)
			defer stopBinding()
			conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(dialCtx, "tcp", target.Host)
			if err != nil {
				return nil, err
			}
			mu.Lock()
			defer mu.Unlock()
			if ctx.Err() != nil {
				_ = conn.Close()
				return nil, ctx.Err()
			}
			tracked := &nativeCodeConnection{Conn: conn}
			tracked.release = func() { mu.Lock(); delete(connections, tracked); mu.Unlock(); release() }
			retained = true
			connections[tracked] = struct{}{}
			return tracked, nil
		},
	}
	closeConnections := func() {
		transport.CloseIdleConnections()
		mu.Lock()
		active := make([]net.Conn, 0, len(connections))
		for conn := range connections {
			active = append(active, conn)
		}
		mu.Unlock()
		for _, conn := range active {
			_ = conn.Close()
		}
	}
	stopCleanup := context.AfterFunc(ctx, closeConnections)
	var closeOnce sync.Once
	closeHandler := func() { closeOnce.Do(func() { cancel(); stopCleanup(); closeConnections() }) }
	proxy := &httputil.ReverseProxy{Transport: transport,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			pr.Out.Host = pr.In.Host
			for _, name := range []string{"Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For", "X-Forwarded-Port"} {
				pr.Out.Header.Del(name)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ctx.Err() != nil {
			http.Error(w, "codespace instance closed", http.StatusGone)
			return
		}
		if r.Method == http.MethodConnect {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next := r.Clone(r.Context())
		u := *r.URL
		next.URL = &u
		if !mapNativeCodeSpacePath(next.URL, binding.CodeSpaceID) {
			http.NotFound(w, r)
			return
		}
		if next.URL.Path == "/" && (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.TrimSpace(next.URL.Query().Get("folder")) == "" && strings.TrimSpace(next.URL.Query().Get("workspace")) == "" && binding.WorkspacePath != "" {
			query := next.URL.Query()
			query.Set("folder", binding.WorkspacePath)
			query.Del("workspace")
			http.Redirect(w, r, "/?"+query.Encode(), http.StatusFound)
			return
		}
		if maybeServeVSDAWebShim(w, next) {
			return
		}
		requestCtx, stop := context.WithCancel(next.Context())
		defer stop()
		stopBinding := context.AfterFunc(ctx, stop)
		defer stopBinding()
		proxy.ServeHTTP(w, next.WithContext(requestCtx))
	})
	return handler, closeHandler, nil
}

func mapNativeCodeSpacePath(u *url.URL, id string) bool {
	p := u.Path
	raw := u.EscapedPath()
	if !strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return false
	}
	for _, part := range strings.Split(p, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	if strings.HasPrefix(p, "/cs/") {
		prefix := "/cs/" + id
		if (p != prefix && !strings.HasPrefix(p, prefix+"/")) || (raw != prefix && !strings.HasPrefix(raw, prefix+"/")) {
			return false
		}
		u.Path = strings.TrimPrefix(p, prefix)
		if u.Path == "" {
			u.Path = "/"
		}
		if u.RawPath != "" {
			u.RawPath = strings.TrimPrefix(raw, prefix)
			if u.RawPath == "" {
				u.RawPath = "/"
			}
		}
	}
	for _, prefix := range []string{"/_redeven_proxy", "/_redeven_boot", "/api/local", "/cs", "/pf"} {
		if u.Path == prefix || strings.HasPrefix(u.Path, prefix+"/") {
			return false
		}
	}
	return true
}

type nativeCodeConnection struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *nativeCodeConnection) Close() error { err := c.Conn.Close(); c.once.Do(c.release); return err }
