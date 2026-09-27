package hostapps

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

// PrepareBrowser creates only a fixed, product-owned desktop entry and profile.
// Launch, graphical preparation, reconnection and shutdown use the ordinary
// host-application owner. Preparing this entry never starts a browser.
func (m *Manager) PrepareBrowser(ctx context.Context, owner, installationID, nativeHost string) (Application, error) {
	if runtime.GOOS != "linux" {
		return Application{}, ErrUnavailable
	}
	if owner == "" {
		return Application{}, ErrInvalid
	}
	installation, err := browserbridge.ResolveInstallation(installationID)
	if err != nil || !installation.Installed {
		return Application{}, ErrNotFound
	}
	if err := m.prepare(); err != nil {
		return Application{}, err
	}
	profile, err := browserbridge.PrepareRemoteProfile(m.state, owner, installation, nativeHost)
	if err != nil {
		return Application{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, tools := m.installedTools(ctx)
	// Entry creation requires only host GIO. Graphical components remain an
	// explicit preparation step in the existing application launch flow.
	if tools.python == "" {
		tools.python = desktopPython(ctx, os.Environ())
	}
	if tools.python == "" {
		return Application{}, ErrUnavailable
	}
	request := struct {
		Name       string `json:"name"`
		Executable string `json:"executable"`
		Arguments  string `json:"arguments"`
		Browser    bool   `json:"remote_browser"`
	}{installation.Name, installation.Executable, quoteArgv(profile.Arguments), true}
	data, _ := json.Marshal(request)
	cmd := helperCommand(ctx, tools.python, m.helper, m.custom, "add", "", profile.ID)
	cmd.Env = tools.environment(cmd.Env)
	cmd.Stdin = bytes.NewReader(data)
	if err := cmd.Run(); err != nil {
		return Application{}, ErrInvalid
	}
	return Application{ID: "custom:" + profile.ID + ".desktop", Name: installation.Name, Categories: []string{"Network", "WebBrowser"}, Custom: true}, nil
}

func (m *Manager) browserApplicationAllowed(id, owner string) bool {
	if !strings.HasPrefix(id, "custom:remote-browser-") {
		return true
	}
	if owner == "" {
		return false
	}
	installations, err := browserbridge.Installations()
	if err != nil {
		return false
	}
	for _, installation := range installations {
		if id == "custom:"+browserbridge.RemoteProfileID(m.state, owner, installation.ID)+".desktop" {
			return true
		}
	}
	return false
}
