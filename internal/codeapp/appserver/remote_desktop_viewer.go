package appserver

import (
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net/http"
	"strings"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/remotedesktop"
)

//go:embed remote_desktop_viewer/*
var remoteDesktopAssets embed.FS

func (g *Server) serveRemoteDesktop(w http.ResponseWriter, s remotedesktop.Session, base string) {
	var random [18]byte
	if _, err := rand.Read(random[:]); err != nil {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	nonce := base64.RawStdEncoding.EncodeToString(random[:])
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self'; img-src blob:; base-uri 'none'; frame-ancestors 'none'")
	configuration, _ := json.Marshal(map[string]any{"session": s, "base": base + remotedesktop.ViewerPath})
	source, _ := remoteDesktopAssets.ReadFile("remote_desktop_viewer/viewer.html")
	page, err := template.New("desktop").Parse(string(source))
	if err != nil {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	_ = page.Execute(w, struct {
		Locale, Theme, Base, Nonce string
		Configuration              template.JS
	}{s.Locale, s.Theme, base + remotedesktop.ViewerPath, nonce, template.JS(configuration)})
}
func serveRemoteDesktopAsset(w http.ResponseWriter, r *http.Request, name string) {
	if strings.ContainsAny(name, "/\\") {
		http.NotFound(w, r)
		return
	}
	var data []byte
	var err error
	switch name {
	case "host_desktop_player.mjs", "host_desktop_audio.mjs":
		data, err = nativeapps.HostDesktopClientResource(name)
	case "input.js":
		data = []byte(hostApplicationInputJS)
	case "pointer.js":
		data = []byte(hostApplicationPointerJS)
	case "floe.css":
		data = []byte(hostApplicationAppearanceCSS + "\n" + hostApplicationInputCSS + "\n" + hostApplicationPointerCSS)
	case "viewer.js", "viewer.css", "catalog.generated.js", "icons.generated.js":
		data, err = remoteDesktopAssets.ReadFile("remote_desktop_viewer/" + name)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(name, "css") {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}
