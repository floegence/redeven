package installer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const ripgrepVersion = "15.2.0"

type pinnedRipgrep struct {
	target string
	digest string
}

var ripgrepPlatforms = map[string]pinnedRipgrep{
	"linux_amd64":  {"x86_64-unknown-linux-musl", "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c"},
	"linux_arm64":  {"aarch64-unknown-linux-musl", "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915"},
	"darwin_amd64": {"x86_64-apple-darwin", "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1"},
	"darwin_arm64": {"aarch64-apple-darwin", "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4"},
}

func prepareRipgrep(ctx context.Context, d *downloader, c Config, platform, temporary string) error {
	pin, ok := ripgrepPlatforms[platform]
	if !ok {
		return errors.New("pinned ripgrep platform is unavailable")
	}
	name := "ripgrep-" + ripgrepVersion + "-" + pin.target
	archive, err := d.archive(ctx, []string{"https://github.com/BurntSushi/ripgrep/releases/download/" + ripgrepVersion + "/" + name + ".tar.gz"}, pin.digest, "ripgrep")
	if err != nil {
		return err
	}
	extracted, err := os.MkdirTemp(temporary, "ripgrep-")
	if err != nil {
		return err
	}
	hashes, err := extractArchive(ctx, archive, pin.digest, extracted, name+"/rg")
	if err != nil {
		return fmt.Errorf("extract pinned ripgrep: %w", err)
	}
	return publishRipgrep(ctx, c.Home, pin.target, filepath.Join(extracted, "rg"), hashes["rg"])
}

func publishRipgrep(ctx context.Context, home, platform, source, digest string) error {
	directory := filepath.Join(home, ".redeven", "tools", "rg", ripgrepVersion, platform)
	if err := realDirectory(directory, true); err != nil {
		return err
	}
	target := filepath.Join(directory, "rg")
	if actual, err := fileDigest(ctx, target); err == nil && actual == digest {
		if err := verifyRipgrep(ctx, target); err != nil {
			return err
		}
		return linkRipgrep(home, target)
	} else if info, statErr := os.Lstat(target); statErr == nil && !info.Mode().IsRegular() {
		return errors.New("pinned ripgrep destination is not a regular file")
	}
	staging, err := os.CreateTemp(directory, ".rg-")
	if err != nil {
		return err
	}
	defer os.Remove(staging.Name())
	input, err := os.Open(source)
	if err != nil {
		staging.Close()
		return err
	}
	_, copyErr := io.Copy(staging, contextReader{ctx, input})
	input.Close()
	if copyErr == nil {
		copyErr = staging.Chmod(0755)
	}
	if copyErr == nil {
		copyErr = staging.Sync()
	}
	if err := errors.Join(copyErr, staging.Close()); err != nil {
		return err
	}
	if actual, err := fileDigest(ctx, staging.Name()); err != nil || actual != digest {
		return errors.New("staged ripgrep does not match the authenticated archive")
	}
	if err := verifyRipgrep(ctx, staging.Name()); err != nil {
		return err
	}
	if err := os.Rename(staging.Name(), target); err != nil {
		return err
	}
	if err := syncDirectory(directory); err != nil {
		return err
	}
	return linkRipgrep(home, target)
}

func verifyRipgrep(ctx context.Context, name string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, name, "--version")
	command.WaitDelay = time.Second
	var output boundedOutput
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		return fmt.Errorf("pinned ripgrep cannot run on this host: %w", errors.Join(ctx.Err(), err))
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	fields := strings.Fields(output.String())
	if len(fields) < 2 || fields[0] != "ripgrep" || fields[1] != ripgrepVersion {
		return errors.New("pinned ripgrep does not report the required version")
	}
	return nil
}

func linkRipgrep(home, target string) error {
	root := filepath.Join(home, ".redeven", "bin")
	if err := realDirectory(root, true); err != nil {
		return err
	}
	name := filepath.Join(root, "rg")
	if info, err := os.Lstat(name); err == nil && info.IsDir() {
		return errors.New("ripgrep activation path is a directory")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	transaction, err := os.MkdirTemp(root, ".rg-activate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(transaction)
	link := filepath.Join(transaction, "rg")
	if err := os.Symlink(target, link); err != nil {
		return err
	}
	if err := os.Rename(link, name); err != nil {
		return err
	}
	return syncDirectory(root)
}
