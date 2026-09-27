//go:build !linux

package browserinstall

import (
	"context"
	"errors"
	"io"
	"path/filepath"
)

func systemBrowserExecutable(pkg Package, directory string) (string, error) {
	return filepath.Join(directory, pkg.Executable), nil
}
func requiresSystemBrowser(Package) bool              { return false }
func systemBrowserDependencies(Package, string) error { return nil }
func InstallSystemBrowser(context.Context, string, io.Reader, io.Writer) error {
	return errors.New("system browser preparation is supported only on Linux")
}
