package accessproxy

import (
	"io/fs"
	"net/http"
	"strings"

	envui "github.com/floegence/redeven/internal/envapp/ui"
)

var accessAssets = func() http.Handler {
	assets, err := fs.Sub(envui.DistFS(), "env")
	if err != nil {
		panic(err)
	}
	return http.StripPrefix("/_redeven_proxy/env", http.FileServer(http.FS(assets)))
}()

// Isolated CodeSpace and Web Service origins have their own authenticated
// channel. Serve only the Runtime-owned login document/assets before unlock;
// every application request still passes the common channel gate.
func (s *Server) serveBrowserGate(w http.ResponseWriter, r *http.Request) bool {
	if s.meta.FloeApp == "com.floegence.redeven.agent" {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.HasPrefix(r.URL.Path, "/_redeven_proxy/env/assets/") {
		accessAssets.ServeHTTP(w, r)
		return true
	}
	if s.gate == nil || !s.gate.Enabled() || s.gate.IsChannelUnlocked(s.meta.ChannelID) || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		return false
	}
	return envui.ServeAccessPage(w, r, false)
}
