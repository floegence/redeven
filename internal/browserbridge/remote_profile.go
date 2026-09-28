package browserbridge

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

// RemoteProfile describes product-owned browser data for a private graphical
// application. The host-application service remains its sole process/display
// owner. These paths and arguments are never accepted from a browser client.
type RemoteProfile struct {
	ID        string
	Directory string
	Arguments []string
}

var remoteNativeHost = regexp.MustCompile(`^dev\.floegence\.redeven\.r[0-9a-f]{16}$`)

func RemoteProfileID(state, owner, installationID string) string {
	identity := sha256.Sum256([]byte(state + "\x00" + owner + "\x00" + installationID))
	return "remote-browser-" + hex.EncodeToString(identity[:16])
}

// PrepareRemoteProfile never reads a personal profile. Only the existing
// Runtime registration is installed into this separate browser's data root.
// Repeated preparation preserves cookies, site storage and extension consent.
func PrepareRemoteProfile(state, owner string, installation Installation, nativeHost string) (RemoteProfile, error) {
	var result RemoteProfile
	if !filepath.IsAbs(state) || owner == "" || !installation.Installed ||
		!filepath.IsAbs(installation.Executable) || !remoteNativeHost.MatchString(nativeHost) {
		return result, errors.New("invalid remote browser identity")
	}
	if installation.Kind != "google_chrome" && installation.Kind != "chromium" && installation.Kind != "chromium_snap" {
		return result, errors.New("unsupported remote browser installation")
	}
	manifest, err := remoteRegistration(installation.ManifestDirectory, nativeHost)
	if err != nil {
		return result, err
	}
	result.ID = RemoteProfileID(state, owner, installation.ID)
	base, directory := state, "remote-browsers"
	if installation.Kind == "chromium_snap" {
		if !filepath.IsAbs(installation.PrivateRoot) {
			return result, errors.New("browser data area for Snap is unavailable")
		}
		base, directory = installation.PrivateRoot, "Redeven"
	}
	if err := os.MkdirAll(base, 0700); err != nil {
		return result, err
	}
	info, err := os.Lstat(base)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return result, errors.New("invalid remote browser data area")
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return result, err
	}
	defer root.Close()
	parent, err := remoteProfileDirectory(root, directory, false)
	if err != nil {
		return result, err
	}
	defer parent.Close()
	profile, err := remoteProfileDirectory(parent, result.ID, true)
	if err != nil {
		return result, err
	}
	defer profile.Close()
	hosts, err := remoteProfileDirectory(profile, "NativeMessagingHosts", true)
	if err != nil {
		return result, err
	}
	defer hosts.Close()
	temporary := ".registration-" + rand.Text()
	// Keep one registration owner. Runtime replaces the canonical manifest on
	// restart; copying it here would retain a retired bridge/socket endpoint.
	if err := hosts.Symlink(manifest, temporary); err != nil {
		return result, err
	}
	if err := hosts.Rename(temporary, nativeHost+".json"); err != nil {
		return result, errors.Join(err, hosts.Remove(temporary))
	}
	result.Directory = filepath.Join(base, directory, result.ID)
	result.Arguments = []string{"--user-data-dir=" + result.Directory, "--ozone-platform=x11", "--no-first-run", "--no-default-browser-check", "chrome://extensions/"}
	return result, nil
}

func remoteProfileDirectory(parent *os.Root, name string, private bool) (*os.Root, error) {
	if err := parent.Mkdir(name, 0700); err != nil && !os.IsExist(err) {
		return nil, err
	}
	info, err := parent.Lstat(name)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 || (private && info.Mode().Perm() != 0700) {
		return nil, errors.New("remote browser directory is not private")
	}
	return parent.OpenRoot(name)
}

func remoteRegistration(directory, host string) (string, error) {
	name := filepath.Join(directory, host+".json")
	if !filepath.IsAbs(name) {
		return "", errors.New("invalid browser registration directory")
	}
	info, err := os.Lstat(name)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > 65536 {
		return "", errors.New("invalid browser registration file")
	}
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		return "", errors.New("browser registration changed during preparation")
	}
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil {
		return "", err
	}
	var manifest struct {
		Name    string   `json:"name"`
		Path    string   `json:"path"`
		Type    string   `json:"type"`
		Origins []string `json:"allowed_origins"`
	}
	if len(data) > 65536 || json.Unmarshal(data, &manifest) != nil || manifest.Name != host ||
		manifest.Type != "stdio" || !filepath.IsAbs(manifest.Path) || len(manifest.Origins) != 1 ||
		manifest.Origins[0] != "chrome-extension://"+ExtensionID+"/" {
		return "", errors.New("invalid native browser registration")
	}
	return name, nil
}
