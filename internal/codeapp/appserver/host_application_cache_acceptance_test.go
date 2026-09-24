package appserver

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"testing"

	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/session"
)

// This opt-in Linux fixture runs the production Runtime routes and installer in
// a disposable container. Only session resolution is supplied by the test host.
func TestHostApplicationCacheAcceptanceServer(t *testing.T) {
	bind := os.Getenv("REDEVEN_COMPONENT_CACHE_ACCEPTANCE_LISTEN")
	if bind == "" || runtime.GOOS != "linux" {
		t.Skip("requires the isolated Desktop component cache acceptance runner")
	}
	root := t.TempDir()
	manager := hostapps.New(root, root, nil)
	defer manager.Close()
	routes := &Server{hostApps: manager, resolveSessionMeta: resolveMetaForTest("component-cache", session.Meta{UserPublicID: "cache-acceptance", CanRead: true, CanWrite: true, CanExecute: true})}
	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(envOriginWithChannel("component-cache"))) })
	mux.HandleFunc(hostApplicationsAPI+"/", func(w http.ResponseWriter, r *http.Request) { routes.handleHostApplicationsAPI(w, r) })
	server := &http.Server{Addr: bind, Handler: mux}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	go func() { <-ctx.Done(); server.Close() }()
	t.Logf("owned component Runtime: pid=%d bind=%s state=%s", os.Getpid(), bind, root)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		t.Fatal(err)
	}
}
