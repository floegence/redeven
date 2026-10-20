package installer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

const suiteDirectory = ".redeven-runtime-suites"

type activation struct {
	info    os.FileInfo
	target  string
	hash    string
	version string
}

func validDigest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32 && value == strings.ToLower(value)
}

func realDirectory(name string, create bool) error {
	if create {
		if err := os.MkdirAll(name, 0755); err != nil {
			return err
		}
	}
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("not a real installation directory: %s", name)
	}
	return nil
}

func inspectActivation(root string) (activation, error) {
	name := filepath.Join(root, "redeven")
	info, err := os.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return activation{}, nil
	}
	if err != nil {
		return activation{}, err
	}
	state := activation{info: info}
	if info.Mode()&os.ModeSymlink == 0 {
		if !info.Mode().IsRegular() {
			return activation{}, errors.New("the existing Redeven activation is not a file or managed suite link")
		}
		return state, nil
	}
	state.target, err = os.Readlink(name)
	if err != nil {
		return activation{}, err
	}
	parts := strings.Split(state.target, "/")
	if len(parts) != 3 || parts[0] != suiteDirectory || !validDigest(parts[1]) || parts[2] != "redeven" {
		return activation{}, errors.New("the existing Redeven link has an unsupported activation target")
	}
	if err := realDirectory(filepath.Join(root, suiteDirectory), false); err != nil {
		return activation{}, err
	}
	if err := realDirectory(filepath.Join(root, suiteDirectory, parts[1]), false); err != nil {
		return activation{}, err
	}
	binary, err := os.Lstat(filepath.Join(root, state.target))
	if err != nil || !binary.Mode().IsRegular() {
		return activation{}, errors.New("the existing activation does not reference a regular suite executable")
	}
	state.hash = parts[1]
	return state, nil
}

func sameActivation(a, b activation) bool {
	if a.info == nil || b.info == nil {
		return a.info == nil && b.info == nil
	}
	return a.target == b.target && os.SameFile(a.info, b.info) && a.info.Size() == b.info.Size() && a.info.ModTime().Equal(b.info.ModTime())
}

func fileDigest(ctx context.Context, name string) (string, error) {
	info, err := os.Lstat(name)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > 512<<20 {
		return "", fmt.Errorf("suite member is not a bounded regular file: %s", name)
	}
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return "", errors.New("suite member changed while opening")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, contextReader{ctx, io.LimitReader(file, info.Size()+1)})
	if err != nil || n != info.Size() {
		return "", fmt.Errorf("read complete suite member: %w", errors.Join(err, io.ErrUnexpectedEOF))
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 64<<10 {
		return 0, errors.New("executable version output exceeds its size limit")
	}
	return b.Buffer.Write(p)
}

func executableVersion(ctx context.Context, name string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, name, "version")
	var output boundedOutput
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		return "", fmt.Errorf("check installed runtime version: %w", err)
	}
	fields := strings.Fields(output.String())
	if len(fields) < 2 || fields[0] != "redeven" {
		return "", errors.New("runtime version output has an unsupported format")
	}
	version := fields[1]
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	if !semver.IsValid(version) || validateReleaseVersion(version) != nil {
		return "", errors.New("runtime executable does not report a canonical release version")
	}
	return version, nil
}

func verifySuite(ctx context.Context, directory string, hashes map[string]string, version string) error {
	if err := realDirectory(directory, false); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	if len(entries) != len(hashes) {
		return errors.New("content-addressed runtime suite has an unexpected file inventory")
	}
	for name, expected := range hashes {
		actual, err := fileDigest(ctx, filepath.Join(directory, name))
		if err != nil {
			return err
		}
		if actual != expected {
			return fmt.Errorf("suite file does not match the authenticated release: %s", name)
		}
		info, err := os.Lstat(filepath.Join(directory, name))
		if err != nil {
			return err
		}
		if (name == "redeven" || name == "redevplugin-runtime") && info.Mode().Perm()&0111 == 0 {
			return fmt.Errorf("runtime suite binary is not executable: %s", name)
		}
	}
	observed, err := executableVersion(ctx, filepath.Join(directory, "redeven"))
	if err != nil {
		return err
	}
	if observed != version {
		return fmt.Errorf("runtime reports %s, expected %s", observed, version)
	}
	return nil
}

func syncDirectory(name string) error {
	file, err := os.Open(name)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}

func publishSuite(ctx context.Context, root, staging, digest string, hashes map[string]string, version string) (string, error) {
	if !validDigest(digest) {
		return "", errors.New("verified archive identity is unavailable")
	}
	parent := filepath.Join(root, suiteDirectory)
	if err := realDirectory(parent, true); err != nil {
		return "", err
	}
	target := filepath.Join(parent, digest)
	if _, err := os.Lstat(target); err == nil {
		if err := verifySuite(ctx, target, hashes, version); err != nil {
			return "", fmt.Errorf("existing immutable runtime suite is invalid: %w", err)
		}
		return target, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := verifySuite(ctx, staging, hashes, version); err != nil {
		return "", err
	}
	if err := os.Chmod(staging, 0755); err != nil {
		return "", err
	}
	if err := syncDirectory(staging); err != nil {
		return "", err
	}
	if err := os.Rename(staging, target); err != nil {
		return "", fmt.Errorf("publish complete runtime suite: %w", err)
	}
	if err := syncDirectory(parent); err != nil {
		return "", err
	}
	return target, nil
}

func pruneSuites(root, desired, previous string) error {
	parent := filepath.Join(root, suiteDirectory)
	entries, err := os.ReadDir(parent)
	if err != nil {
		return err
	}
	// Validate the whole inventory before deleting anything.
	for _, entry := range entries {
		if !validDigest(entry.Name()) || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return errors.New("runtime suite inventory contains an unsupported entry")
		}
	}
	for _, entry := range entries {
		if entry.Name() != desired && entry.Name() != previous {
			if err := os.RemoveAll(filepath.Join(parent, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

func activateSuite(ctx context.Context, root, digest string, previous activation, hashes map[string]string, version string) error {
	current, err := inspectActivation(root)
	if err != nil {
		return err
	}
	if !sameActivation(previous, current) {
		return errors.New("activation changed while the new runtime suite was prepared")
	}
	if err := pruneSuites(root, digest, previous.hash); err != nil {
		return err
	}
	transaction, err := os.MkdirTemp(root, ".redeven-runtime-activate.")
	if err != nil {
		return err
	}
	defer os.RemoveAll(transaction)
	backup := filepath.Join(transaction, "previous")
	if previous.info != nil {
		if previous.target != "" {
			err = os.Symlink(previous.target, backup)
		} else {
			err = os.Link(filepath.Join(root, "redeven"), backup)
		}
		if err != nil {
			return fmt.Errorf("preserve previous activation: %w", err)
		}
	}
	desired := suiteDirectory + "/" + digest + "/redeven"
	prepared := filepath.Join(transaction, "next")
	if err := os.Symlink(desired, prepared); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Rename(prepared, filepath.Join(root, "redeven")); err != nil {
		return fmt.Errorf("commit runtime activation: %w", err)
	}
	verifyErr := syncDirectory(root)
	if verifyErr == nil {
		verifyErr = verifySuite(ctx, filepath.Join(root, suiteDirectory, digest), hashes, version)
	}
	if verifyErr == nil {
		observed, err := executableVersion(ctx, filepath.Join(root, "redeven"))
		if err != nil || observed != version {
			verifyErr = errors.Join(err, errors.New("final activation did not report the requested runtime version"))
		}
	}
	if verifyErr == nil {
		return nil
	}
	// Verification failure does not undo the committed rename. Reconcile the
	// actual link before restoring only this transaction's previous activation.
	actual, inspectErr := inspectActivation(root)
	if inspectErr != nil || actual.target != desired {
		return fmt.Errorf("runtime activation committed but verification failed; activation changed and was not overwritten: %w", errors.Join(verifyErr, inspectErr))
	}
	if previous.info == nil {
		err = os.Remove(filepath.Join(root, "redeven"))
	} else {
		err = os.Rename(backup, filepath.Join(root, "redeven"))
	}
	if err == nil {
		err = syncDirectory(root)
	}
	if err != nil {
		return fmt.Errorf("runtime activation verification and restoration failed: %w", errors.Join(verifyErr, err))
	}
	restored, err := inspectActivation(root)
	matches := err == nil
	if previous.info == nil {
		matches = matches && restored.info == nil
	} else if previous.target != "" {
		// Restoring a symlink creates a new inode. Its exact managed target,
		// rather than the deleted link's inode, is the activation identity.
		matches = matches && restored.target == previous.target && restored.hash == previous.hash
	} else {
		matches = matches && sameActivation(previous, restored)
	}
	if matches && previous.version != "" {
		check, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		observed, versionErr := executableVersion(check, filepath.Join(root, "redeven"))
		cancel()
		matches = versionErr == nil && observed == previous.version
		err = errors.Join(err, versionErr)
	}
	if !matches {
		return fmt.Errorf("previous activation restoration could not be confirmed: %w", errors.Join(verifyErr, err))
	}
	return fmt.Errorf("runtime verification failed; the previous activation was restored: %w", verifyErr)
}
