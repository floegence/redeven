package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const maxNPMPackumentBytes = 16 << 20

type npmPackument struct {
	DistTags map[string]string             `json:"dist-tags"`
	Versions map[string]npmVersionDocument `json:"versions"`
	Time     map[string]string             `json:"time"`
}

type npmVersionDocument struct {
	Version    string            `json:"version"`
	Deprecated any               `json:"deprecated"`
	Engines    map[string]string `json:"engines"`
	Dist       struct {
		Integrity string `json:"integrity"`
	} `json:"dist"`
}

type npmReleaseMetadata struct {
	Version            string
	Integrity          string
	IntegrityVerified  bool
	PublishedAtUnixMs  int64
	Deprecated         bool
	DeprecationMessage string
	NodeRange          string
}

func fetchNPMReleases(ctx context.Context, client *http.Client, spec NPMHostPackageSpec, token string) ([]npmReleaseMetadata, error) {
	if client == nil {
		return nil, serviceError("RELEASE_SOURCE_UNAVAILABLE", "The npm Registry client is unavailable.", 503, true, nil)
	}
	base, err := url.Parse(strings.TrimSpace(spec.RegistryURL))
	if err != nil {
		return nil, serviceError("NPM_REGISTRY_INVALID", "The npm Registry URL is invalid.", 400, false, err)
	}
	packageName := strings.TrimSpace(spec.PackageName)
	pathPrefix := strings.TrimRight(base.Path, "/")
	escapedPrefix := strings.TrimRight(base.EscapedPath(), "/")
	base.Path = pathPrefix + "/" + packageName
	base.RawPath = escapedPrefix + "/" + url.PathEscape(packageName)
	base.RawQuery, base.Fragment = "", ""
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.npm.install-v1+json, application/json")
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, serviceError("RELEASE_SOURCE_UNAVAILABLE", "The npm Registry could not be reached.", 503, true, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, serviceError("RELEASE_SOURCE_AUTH_REQUIRED", "The npm Registry rejected its Secret token.", 401, false, nil)
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, serviceError("RELEASE_SOURCE_RATE_LIMITED", "The npm Registry rate limit was reached.", 429, true, nil)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, serviceError("RELEASE_SOURCE_UNAVAILABLE", "The npm Registry did not return package metadata.", 503, true, fmt.Errorf("npm registry returned %s", resp.Status))
	}
	limited := io.LimitReader(resp.Body, maxNPMPackumentBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(raw) > maxNPMPackumentBytes {
		return nil, serviceError("RELEASE_SOURCE_RESPONSE_INVALID", "The npm Registry response exceeded the safe metadata limit.", 502, false, nil)
	}
	var packument npmPackument
	if err := json.Unmarshal(raw, &packument); err != nil || len(packument.Versions) == 0 {
		return nil, serviceError("RELEASE_SOURCE_RESPONSE_INVALID", "The npm Registry returned invalid package metadata.", 502, false, err)
	}
	items := make([]npmReleaseMetadata, 0, len(packument.Versions))
	for key, document := range packument.Versions {
		version := strings.TrimSpace(document.Version)
		if version == "" {
			version = strings.TrimSpace(key)
		}
		if _, validVersion := parseSemanticVersion(version); !exactSemverPattern.MatchString(version) || !validVersion {
			continue
		}
		published := int64(0)
		if parsed, parseErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(packument.Time[version])); parseErr == nil {
			published = parsed.UnixMilli()
		}
		deprecatedMessage := strings.TrimSpace(fmt.Sprint(document.Deprecated))
		if document.Deprecated == nil || deprecatedMessage == "<nil>" || deprecatedMessage == "false" {
			deprecatedMessage = ""
		}
		items = append(items, npmReleaseMetadata{
			Version: version, Integrity: strings.TrimSpace(document.Dist.Integrity), IntegrityVerified: validNPMIntegrity(document.Dist.Integrity), PublishedAtUnixMs: published,
			Deprecated: deprecatedMessage != "", DeprecationMessage: deprecatedMessage, NodeRange: strings.TrimSpace(document.Engines["node"]),
		})
	}
	sort.SliceStable(items, func(i, j int) bool { return compareReleaseVersions(items[i].Version, items[j].Version) > 0 })
	return items, nil
}

func validNPMIntegrity(value string) bool {
	algorithm, encoded, ok := strings.Cut(strings.TrimSpace(value), "-")
	if !ok || algorithm != "sha512" {
		return false
	}
	digest, err := base64.StdEncoding.DecodeString(encoded)
	return err == nil && len(digest) == 64
}

func npmReleaseByVersion(items []npmReleaseMetadata, version string) (npmReleaseMetadata, bool) {
	for _, item := range items {
		if item.Version == strings.TrimSpace(version) {
			return item, true
		}
	}
	return npmReleaseMetadata{}, false
}

type npmRuntimeManifest struct {
	SchemaVersion    int    `json:"schema_version"`
	PackageName      string `json:"package_name"`
	PackageVersion   string `json:"package_version"`
	PackageIntegrity string `json:"package_integrity"`
	Registry         string `json:"registry"`
	Executable       string `json:"executable"`
	Platform         string `json:"platform"`
	NodeSHA256       string `json:"node_sha256"`
	RuntimeSHA256    string `json:"runtime_sha256"`
}

type npmApplicationManifest struct {
	Private      bool              `json:"private"`
	Dependencies map[string]string `json:"dependencies"`
}

func (d *hostScriptDriver) installNPMRuntime(ctx context.Context, service *pfregistry.ManagedService, spec NPMHostPackageSpec, progress operationProgress) (string, ReleaseIdentity, error) {
	parameters, err := d.manager.serviceParameters(service)
	if err != nil {
		return "", ReleaseIdentity{}, err
	}
	token := ""
	if name := strings.TrimSpace(spec.AuthTokenParameter); name != "" {
		token = parameters[name]
		if strings.TrimSpace(token) == "" {
			return "", ReleaseIdentity{}, serviceError("RELEASE_SOURCE_AUTH_REQUIRED", "The npm Registry Secret token is missing.", 409, false, nil)
		}
	}
	releases, err := fetchNPMReleases(ctx, d.manager.releaseHTTPClient(), spec, token)
	if err != nil {
		return "", ReleaseIdentity{}, err
	}
	release, ok := npmReleaseByVersion(releases, spec.Version)
	if !ok {
		return "", ReleaseIdentity{}, serviceError("RELEASE_NOT_FOUND", "The exact npm package version is no longer available from its Registry.", 409, false, nil)
	}
	if !release.IntegrityVerified {
		return "", ReleaseIdentity{}, serviceError("RELEASE_IDENTITY_UNVERIFIABLE", "The npm Registry did not provide a verifiable SHA-512 integrity for this exact package version.", 409, false, nil)
	}
	identity := ReleaseIdentity{SchemaVersion: 1, Kind: "npm", Source: spec.PackageName, Registry: normalizedRegistryURL(spec.RegistryURL), Version: release.Version, Integrity: release.Integrity, Platform: currentPlatformKey(), Trust: "registry_verified"}
	if err := verifyExpectedNPMReleaseIdentity(service, identity); err != nil {
		return "", ReleaseIdentity{}, err
	}
	artifact, ok := auditedNodeRuntimeArtifact(currentPlatformKey())
	if !ok || d.manager.packageDownloader == nil {
		return "", ReleaseIdentity{}, serviceError("PLATFORM_UNSUPPORTED", "This Redeven release does not include a managed Node.js Runtime for the Environment platform.", 409, false, nil)
	}
	if err := validateVerifiedPackageArtifact(artifact, d.manager.packageDownloader.client, defaultNodePackageOrigin); err != nil {
		return "", ReleaseIdentity{}, err
	}
	identityKey := sha256.Sum256([]byte(spec.PackageName + "\x00" + release.Version + "\x00" + release.Integrity + "\x00" + currentPlatformKey()))
	installRoot := filepath.Join(d.instanceRoot(service), "releases", hex.EncodeToString(identityKey[:16]))
	executable := filepath.Join(installRoot, "bin", "managed-service")
	if err := verifyNPMRuntime(installRoot, spec, identity); err == nil {
		return executable, identity, nil
	}
	if _, err := os.Stat(installRoot); err == nil {
		return "", ReleaseIdentity{}, serviceError("INSTALL_IDENTITY_CONFLICT", "An unexpected npm installation occupies the selected release directory.", 409, false, nil)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", ReleaseIdentity{}, err
	}
	stagingRoot := filepath.Join(d.manager.stateDir, ".staging", service.ServiceID)
	_ = os.RemoveAll(stagingRoot)
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return "", ReleaseIdentity{}, err
	}
	defer os.RemoveAll(stagingRoot)
	archivePath := filepath.Join(stagingRoot, "node-runtime.tar.gz")
	if err := downloadVerifiedPackageArchive(ctx, d.manager.packageDownloader.client, artifact, archivePath, progress); err != nil {
		return "", ReleaseIdentity{}, err
	}
	progress("verifying", 3)
	if err := verifyVerifiedPackageArchive(archivePath, artifact); err != nil {
		return "", ReleaseIdentity{}, err
	}
	extractRoot := filepath.Join(stagingRoot, "root")
	if err := extractNodeRuntimeArchive(archivePath, extractRoot); err != nil {
		return "", ReleaseIdentity{}, serviceError("ARCHIVE_INVALID", "The audited Node.js Runtime could not be safely extracted.", 502, false, err)
	}
	nodePath := filepath.Join(extractRoot, filepath.FromSlash(artifact.NodeRelPath))
	npmCLIPath := filepath.Join(extractRoot, filepath.FromSlash(artifact.NPMCLIRelPath))
	if !regularExecutable(nodePath) || !regularFile(npmCLIPath) {
		return "", ReleaseIdentity{}, serviceError("ARCHIVE_LAYOUT_INVALID", "The audited Node.js Runtime has an unexpected layout.", 502, false, nil)
	}
	nodeDigest, err := fileSHA256(nodePath)
	if err != nil {
		return "", ReleaseIdentity{}, err
	}
	runtimeDigest, err := managedNodeRuntimeDigest(extractRoot)
	if err != nil {
		return "", ReleaseIdentity{}, err
	}
	appRoot := filepath.Join(extractRoot, "app")
	if err := os.MkdirAll(appRoot, 0o700); err != nil {
		return "", ReleaseIdentity{}, err
	}
	progress("installing", 4)
	if err := runNPMReleaseInstall(ctx, nodePath, npmCLIPath, appRoot, filepath.Join(stagingRoot, "npm"), spec, token); err != nil {
		return "", ReleaseIdentity{}, err
	}
	if after, digestErr := managedNodeRuntimeDigest(extractRoot); digestErr != nil || after != runtimeDigest {
		return "", ReleaseIdentity{}, serviceError("RUNTIME_MUTATED_DURING_INSTALL", "An npm lifecycle script modified the verified Node.js Runtime.", 502, false, digestErr)
	}
	if err := verifyInstalledNPMPackage(appRoot, spec); err != nil {
		return "", ReleaseIdentity{}, err
	}
	launcher := npmRuntimeLauncher(artifact, spec.Executable)
	launcherPath := filepath.Join(extractRoot, "bin", "managed-service")
	if err := os.MkdirAll(filepath.Dir(launcherPath), 0o700); err != nil {
		return "", ReleaseIdentity{}, err
	}
	if err := os.WriteFile(launcherPath, launcher, 0o700); err != nil {
		return "", ReleaseIdentity{}, err
	}
	manifest := npmRuntimeManifest{SchemaVersion: 1, PackageName: spec.PackageName, PackageVersion: spec.Version, PackageIntegrity: release.Integrity, Registry: normalizedRegistryURL(spec.RegistryURL), Executable: spec.Executable, Platform: currentPlatformKey(), NodeSHA256: nodeDigest, RuntimeSHA256: runtimeDigest}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return "", ReleaseIdentity{}, err
	}
	if err := os.WriteFile(filepath.Join(extractRoot, "redeven-npm-runtime.json"), raw, 0o600); err != nil {
		return "", ReleaseIdentity{}, err
	}
	if err := os.MkdirAll(filepath.Dir(installRoot), 0o700); err != nil {
		return "", ReleaseIdentity{}, err
	}
	if err := os.Rename(extractRoot, installRoot); err != nil {
		return "", ReleaseIdentity{}, err
	}
	return executable, identity, nil
}

func verifyExpectedNPMReleaseIdentity(service *pfregistry.ManagedService, actual ReleaseIdentity) error {
	if service == nil || strings.TrimSpace(service.ReleaseIdentityJSON) == "" || strings.TrimSpace(service.ReleaseIdentitySHA256) == "" {
		return nil
	}
	expected, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		return serviceError("RELEASE_IDENTITY_INVALID", "The saved npm release identity is invalid.", 409, false, err)
	}
	if expected.Kind != "npm" {
		return nil
	}
	matches := expected.Source == actual.Source && expected.Registry == actual.Registry && expected.Version == actual.Version && expected.Platform == actual.Platform
	if expected.Integrity != "" {
		matches = matches && expected.Integrity == actual.Integrity
	}
	if !matches {
		return serviceError("RELEASE_CANDIDATE_CHANGED", "The selected npm release changed at its Registry. Refresh the version list and review it again.", 409, true, nil)
	}
	return nil
}

func runNPMReleaseInstall(ctx context.Context, nodePath, npmCLIPath, appRoot, taskRoot string, spec NPMHostPackageSpec, token string) error {
	configRoot := filepath.Join(taskRoot, "config")
	cacheRoot := filepath.Join(taskRoot, "cache")
	homeRoot := filepath.Join(taskRoot, "home")
	if err := os.MkdirAll(configRoot, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(cacheRoot, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(homeRoot, 0o700); err != nil {
		return err
	}
	if err := writeNPMApplicationManifest(appRoot, spec); err != nil {
		return serviceError("DEPENDENCY_LAYOUT_INVALID", "Redeven could not prepare the exact npm application manifest.", 500, true, err)
	}
	userConfig := filepath.Join(configRoot, "user.npmrc")
	globalConfig := filepath.Join(configRoot, "global.npmrc")
	if err := os.WriteFile(globalConfig, nil, 0o600); err != nil {
		return err
	}
	configuration := "registry=" + normalizedRegistryURL(spec.RegistryURL) + "\n"
	if strings.TrimSpace(token) != "" {
		configuration += npmAuthConfigKey(spec.RegistryURL) + "=" + strings.TrimSpace(token) + "\n"
	}
	if err := os.WriteFile(userConfig, []byte(configuration), 0o600); err != nil {
		return err
	}
	env := npmCommandEnvironment(nodePath, homeRoot, cacheRoot, userConfig, globalConfig, spec.RegistryURL)
	installArgs := append([]string{npmCLIPath}, npmPackageInstallArguments(spec.PackageName, spec.Version, appRoot)...)
	if err := runManagedNPMCommand(ctx, nodePath, installArgs, appRoot, env); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return serviceError("DEPENDENCY_INSTALL_FAILED", "The exact npm package could not be installed from its Registry.", 503, true, err)
	}
	if err := verifyInstalledNPMPackage(appRoot, spec); err != nil {
		return err
	}
	// Credentials must be gone before third-party lifecycle scripts execute.
	if err := os.WriteFile(userConfig, []byte("registry="+normalizedRegistryURL(spec.RegistryURL)+"\n"), 0o600); err != nil {
		return err
	}
	rebuildArgs := append([]string{npmCLIPath}, npmPackageRebuildArguments(appRoot)...)
	if err := runManagedNPMCommand(ctx, nodePath, rebuildArgs, appRoot, env); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return serviceError("LIFECYCLE_SCRIPT_FAILED", "The npm package lifecycle scripts failed.", 502, true, err)
	}
	return verifyInstalledNPMPackage(appRoot, spec)
}

func writeNPMApplicationManifest(appRoot string, spec NPMHostPackageSpec) error {
	manifest := npmApplicationManifest{
		Private:      true,
		Dependencies: map[string]string{strings.TrimSpace(spec.PackageName): strings.TrimSpace(spec.Version)},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(appRoot, "package.json"), raw, 0o600)
}

func runManagedNPMCommand(ctx context.Context, nodePath string, args []string, dir string, env []string) error {
	cmd := exec.CommandContext(ctx, nodePath, args...)
	cmd.Dir, cmd.Env = dir, env
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	return cmd.Run()
}

func npmCommandEnvironment(nodePath, home, cache, userConfig, globalConfig, registry string) []string {
	pathValue := filepath.Dir(nodePath)
	if inherited := strings.TrimSpace(os.Getenv("PATH")); inherited != "" {
		pathValue += string(os.PathListSeparator) + inherited
	}
	env := []string{
		"HOME=" + home, "PATH=" + pathValue, "npm_config_registry=" + normalizedRegistryURL(registry),
		"npm_config_cache=" + cache, "npm_config_userconfig=" + userConfig, "npm_config_globalconfig=" + globalConfig,
		"npm_config_audit=false", "npm_config_fund=false", "npm_config_update_notifier=false", "npm_config_progress=false", "npm_config_loglevel=warn",
	}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func normalizedRegistryURL(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/") + "/"
}

func npmAuthConfigKey(registry string) string {
	parsed, _ := url.Parse(normalizedRegistryURL(registry))
	return "//" + parsed.Host + strings.TrimRight(parsed.EscapedPath(), "/") + "/:_authToken"
}

func verifyInstalledNPMPackage(appRoot string, spec NPMHostPackageSpec) error {
	manifestRaw, err := os.ReadFile(filepath.Join(appRoot, "package.json"))
	if err != nil {
		return serviceError("DEPENDENCY_LAYOUT_INVALID", "The managed npm application manifest is missing.", 502, false, err)
	}
	var manifest npmApplicationManifest
	if err := decodeStrictJSON(manifestRaw, &manifest); err != nil || !manifest.Private || manifest.Dependencies[strings.TrimSpace(spec.PackageName)] != strings.TrimSpace(spec.Version) || len(manifest.Dependencies) != 1 {
		return serviceError("DEPENDENCY_IDENTITY_MISMATCH", "The managed npm application manifest does not match the selected exact release.", 502, false, err)
	}
	parts := strings.Split(spec.PackageName, "/")
	packageRoot := filepath.Join(append([]string{appRoot, "node_modules"}, parts...)...)
	raw, err := os.ReadFile(filepath.Join(packageRoot, "package.json"))
	if err != nil {
		return serviceError("DEPENDENCY_LAYOUT_INVALID", "The installed npm package is missing its package metadata.", 502, false, err)
	}
	var metadata struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil || metadata.Name != spec.PackageName || metadata.Version != spec.Version {
		return serviceError("DEPENDENCY_IDENTITY_MISMATCH", "The installed npm package does not match the selected exact release.", 502, false, err)
	}
	executable := filepath.Join(appRoot, "node_modules", ".bin", spec.Executable)
	if info, err := os.Lstat(executable); err != nil || info.Mode()&os.ModeSymlink == 0 && !info.Mode().IsRegular() {
		return serviceError("DEPENDENCY_LAYOUT_INVALID", "The installed npm package does not provide its declared executable.", 502, false, err)
	}
	if _, err := os.Stat(filepath.Join(appRoot, "package-lock.json")); err == nil {
		return serviceError("DEPENDENCY_POLICY_VIOLATION", "The npm Host installation unexpectedly created a package-lock file.", 502, false, nil)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func npmRuntimeLauncher(artifact verifiedPackageArtifact, executable string) []byte {
	return []byte(fmt.Sprintf("#!/bin/sh\nset -eu\nruntime_root=$(CDPATH= cd \"$(dirname \"$0\")/..\" && pwd)\nPATH=\"$runtime_root/%s:$PATH\"\nexport PATH\nexec \"$runtime_root/app/node_modules/.bin/%s\" \"$@\"\n", filepath.ToSlash(filepath.Dir(artifact.NodeRelPath)), executable))
}

func verifyNPMRuntime(installRoot string, spec NPMHostPackageSpec, identity ReleaseIdentity) error {
	raw, err := os.ReadFile(filepath.Join(installRoot, "redeven-npm-runtime.json"))
	if err != nil {
		return err
	}
	var manifest npmRuntimeManifest
	if err := decodeStrictJSON(raw, &manifest); err != nil {
		return err
	}
	if manifest.SchemaVersion != 1 || manifest.PackageName != spec.PackageName || manifest.PackageVersion != spec.Version || manifest.PackageIntegrity != identity.Integrity || manifest.Registry != normalizedRegistryURL(spec.RegistryURL) || manifest.Executable != spec.Executable || manifest.Platform != currentPlatformKey() {
		return errors.New("npm Runtime manifest does not match the selected release")
	}
	artifact, ok := auditedNodeRuntimeArtifact(currentPlatformKey())
	if !ok {
		return errors.New("managed Node.js Runtime is unavailable")
	}
	nodePath := filepath.Join(installRoot, filepath.FromSlash(artifact.NodeRelPath))
	digest, err := fileSHA256(nodePath)
	runtimeDigest, runtimeErr := managedNodeRuntimeDigest(installRoot)
	if err != nil || runtimeErr != nil || digest != manifest.NodeSHA256 || runtimeDigest != manifest.RuntimeSHA256 || !regularExecutable(filepath.Join(installRoot, "bin", "managed-service")) {
		return errors.New("managed Node.js Runtime identity mismatch")
	}
	return verifyInstalledNPMPackage(filepath.Join(installRoot, "app"), spec)
}

func managedNodeRuntimeDigest(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "app" && entry.IsDir() {
			return filepath.SkipDir
		}
		if rel == "bin/managed-service" || rel == "redeven-npm-runtime.json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		_, _ = hash.Write([]byte(rel + "\x00" + info.Mode().String() + "\x00"))
		switch {
		case info.Mode().IsRegular():
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(hash, file)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			_, _ = hash.Write([]byte{0})
			return nil
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			_, _ = hash.Write([]byte(target))
			_, _ = hash.Write([]byte{0})
			return nil
		case info.IsDir():
			return nil
		default:
			return fmt.Errorf("managed Node.js Runtime contains unsupported file type at %s", rel)
		}
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type semanticVersion struct {
	core       [3]int64
	prerelease []string
}

func parseSemanticVersion(value string) (semanticVersion, bool) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	var build string
	var hasBuild bool
	value, build, hasBuild = strings.Cut(value, "+")
	if hasBuild && !validSemanticIdentifiers(build, false) {
		return semanticVersion{}, false
	}
	base, prerelease, hasPrerelease := strings.Cut(value, "-")
	parts := strings.Split(base, ".")
	if len(parts) != 3 {
		return semanticVersion{}, false
	}
	parsed := semanticVersion{}
	for index, part := range parts {
		if part == "" || len(part) > 1 && part[0] == '0' {
			return semanticVersion{}, false
		}
		number, err := strconv.ParseInt(part, 10, 64)
		if err != nil || number < 0 {
			return semanticVersion{}, false
		}
		parsed.core[index] = number
	}
	if hasPrerelease {
		parsed.prerelease = strings.Split(prerelease, ".")
		if !validSemanticIdentifiers(prerelease, true) {
			return semanticVersion{}, false
		}
	}
	return parsed, true
}

func validSemanticIdentifiers(value string, rejectNumericLeadingZero bool) bool {
	for _, identifier := range strings.Split(value, ".") {
		if identifier == "" {
			return false
		}
		numeric := true
		for _, character := range identifier {
			if character < '0' || character > '9' {
				numeric = false
			}
			if character != '-' && (character < '0' || character > '9') && (character < 'A' || character > 'Z') && (character < 'a' || character > 'z') {
				return false
			}
		}
		if rejectNumericLeadingZero && numeric && len(identifier) > 1 && identifier[0] == '0' {
			return false
		}
	}
	return true
}

func compareReleaseVersions(left, right string) int {
	l, leftOK := parseSemanticVersion(left)
	r, rightOK := parseSemanticVersion(right)
	if !leftOK || !rightOK {
		return strings.Compare(left, right)
	}
	for i := range l.core {
		if l.core[i] < r.core[i] {
			return -1
		}
		if l.core[i] > r.core[i] {
			return 1
		}
	}
	if len(l.prerelease) == 0 && len(r.prerelease) == 0 {
		return 0
	}
	if len(l.prerelease) == 0 {
		return 1
	}
	if len(r.prerelease) == 0 {
		return -1
	}
	for index := 0; index < len(l.prerelease) && index < len(r.prerelease); index++ {
		leftPart, rightPart := l.prerelease[index], r.prerelease[index]
		leftNumber, leftErr := strconv.ParseInt(leftPart, 10, 64)
		rightNumber, rightErr := strconv.ParseInt(rightPart, 10, 64)
		switch {
		case leftErr == nil && rightErr == nil && leftNumber != rightNumber:
			if leftNumber < rightNumber {
				return -1
			}
			return 1
		case leftErr == nil && rightErr != nil:
			return -1
		case leftErr != nil && rightErr == nil:
			return 1
		case leftPart != rightPart:
			return strings.Compare(leftPart, rightPart)
		}
	}
	if len(l.prerelease) < len(r.prerelease) {
		return -1
	}
	if len(l.prerelease) > len(r.prerelease) {
		return 1
	}
	return 0
}

func canonicalReleaseIdentity(identity ReleaseIdentity) (string, string, error) {
	identity.SchemaVersion = 1
	raw, err := json.Marshal(identity)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(digest[:]), nil
}

func decodeReleaseIdentity(raw, expectedDigest string) (*ReleaseIdentity, error) {
	digest := sha256.Sum256([]byte(raw))
	if hex.EncodeToString(digest[:]) != strings.TrimSpace(expectedDigest) {
		return nil, errors.New("release identity SHA-256 mismatch")
	}
	var identity ReleaseIdentity
	if err := decodeStrictJSON([]byte(raw), &identity); err != nil {
		return nil, err
	}
	if identity.SchemaVersion != 1 || strings.TrimSpace(identity.Kind) == "" {
		return nil, errors.New("unsupported release identity")
	}
	return &identity, nil
}
