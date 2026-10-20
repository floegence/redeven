package installer

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/mod/semver"
)

type runDependencies struct {
	source  releaseSource
	client  *downloader
	verify  func(context.Context, []byte, []byte, []byte, string) error
	prepare func(context.Context, *downloader, Config, string, string) error
}

// Run installs one authenticated release without starting or restarting Runtime.
// The caller retains ownership of an existing self-upgrade/re-exec lifecycle.
func Run(ctx context.Context, config Config) error {
	config, err := config.normalized()
	if err != nil {
		return err
	}
	return run(ctx, config, runDependencies{source: sourceFor(config.Channel), verify: VerifyRelease, prepare: prepareRipgrep})
}

func run(ctx context.Context, config Config, dependencies runDependencies) error {
	platform, err := hostPlatform()
	if err != nil {
		return err
	}
	if err := realDirectory(config.InstallDir, true); err != nil {
		return fmt.Errorf("prepare writable activation root: %w", err)
	}
	unlock, err := lockInstallation(config.InstallDir)
	if err != nil {
		return err
	}
	defer unlock()
	previous, err := inspectActivation(config.InstallDir)
	if err != nil {
		return err
	}
	probe, err := os.CreateTemp(config.InstallDir, ".redeven-install-preflight-")
	if err != nil {
		return fmt.Errorf("installation directory is not writable; choose a user-writable directory: %w", err)
	}
	probe.Close()
	os.Remove(probe.Name())
	if previous.info != nil {
		previous.version, err = executableVersion(ctx, filepath.Join(config.InstallDir, "redeven"))
		if err != nil && config.Version == "" {
			return fmt.Errorf("cannot establish the installed version for an automatic upgrade; choose an explicit target version: %w", err)
		}
	}
	temporary, err := os.MkdirTemp("", "redeven-installer-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	downloader := dependencies.client
	if downloader == nil {
		downloader = newDownloader(filepath.Join(temporary, "downloads"), config.Output)
	}
	version, err := resolveVersion(ctx, downloader, config, dependencies.source)
	if err != nil {
		return err
	}
	if config.Version == "" && previous.version != "" && semver.Compare(version, previous.version) < 0 {
		return fmt.Errorf("automatic installation will not downgrade %s to %s; select the older version explicitly only if you intend to roll back", previous.version, version)
	}
	fmt.Fprintf(config.Output, "Preparing Redeven %s for %s...\n", version, platform)
	read := func(name string, limit int64) ([]byte, error) {
		data, err := downloader.metadata(ctx, dependencies.source.assetURLs(version, name), limit)
		if err != nil {
			return nil, fmt.Errorf("download release %s: %w", name, err)
		}
		return data, nil
	}
	checksums, err := read("SHA256SUMS", 8<<20)
	if err != nil {
		return err
	}
	signature, err := read("SHA256SUMS.sig", 32<<10)
	if err != nil {
		return err
	}
	certificate, err := read("SHA256SUMS.pem", 256<<10)
	if err != nil {
		return err
	}
	fmt.Fprintln(config.Output, "Verifying release publisher and transparency evidence...")
	if err := dependencies.verify(ctx, checksums, signature, certificate, version); err != nil {
		return err
	}
	inventory, err := parseChecksums(checksums)
	if err != nil {
		return err
	}
	contract, err := loadDistribution(ctx, downloader, dependencies.source, version, inventory)
	if err != nil {
		return err
	}
	if contract != nil && (validateReleaseVersion(config.InstallerVersion) != nil || semver.Compare(config.InstallerVersion, contract.MinimumInstallerVersion) < 0) {
		return fmt.Errorf("this release requires installer %s or newer; fetch the current official installation command", contract.MinimumInstallerVersion)
	}
	packageName := "redeven_" + platform + ".tar.gz"
	digest, exists := inventory[packageName]
	if !exists {
		return fmt.Errorf("authenticated release does not contain %s", packageName)
	}
	archive, err := downloader.archive(ctx, dependencies.source.assetURLs(version, packageName), digest, "Redeven")
	if err != nil {
		return err
	}
	staging, err := os.MkdirTemp(config.InstallDir, ".redeven-runtime-suite.")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	hashes, err := extractArchive(ctx, archive, digest, staging, "")
	if err != nil {
		return fmt.Errorf("extract authenticated runtime suite: %w", err)
	}
	fmt.Fprintln(config.Output, "Preparing the complete runtime suite...")
	if _, err := publishSuite(ctx, config.InstallDir, staging, digest, hashes, version); err != nil {
		return err
	}
	if err := dependencies.prepare(ctx, downloader, config, platform, temporary); err != nil {
		return fmt.Errorf("prepare required command-line tools; runtime activation was not changed: %w", err)
	}
	if err := activateSuite(ctx, config.InstallDir, digest, previous, hashes, version); err != nil {
		return err
	}
	cleanupLegacySuite(config)
	fmt.Fprintf(config.Output, "Redeven %s installed successfully.\nRuntime: %s\n", version, filepath.Join(config.InstallDir, "redeven"))
	if err := configurePath(config); err != nil {
		fmt.Fprintf(config.Output, "The runtime is installed, but PATH could not be configured automatically: %v\n", err)
	}
	if config.Mode != "upgrade" {
		fmt.Fprintln(config.Output, "The installer has not started Runtime or created a background service.")
	}
	return nil
}

func cleanupLegacySuite(config Config) {
	for _, role := range runtimeFiles {
		if role.name == "redeven" || role.name == "computer.zip" {
			continue
		}
		name := filepath.Join(config.InstallDir, role.name)
		info, err := os.Lstat(name)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || info.IsDir() {
			fmt.Fprintf(config.Output, "Warning: obsolete suite entry was left unchanged: %s\n", name)
			continue
		}
		if err := os.Remove(name); err != nil {
			fmt.Fprintf(config.Output, "Warning: could not remove obsolete suite entry %s: %v\n", name, err)
		}
	}
}
