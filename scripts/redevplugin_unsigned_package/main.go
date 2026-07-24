package main

import (
	"archive/zip"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/floegence/redevplugin/pkg/pluginpkg"
)

func main() {
	input := flag.String("input", "", "signed .redevplugin package")
	output := flag.String("output", "", "unsigned .redevplugin package")
	flag.Parse()
	if *input == "" || *output == "" {
		fatal(errors.New("both -input and -output are required"))
	}
	if err := buildUnsignedPackage(*input, *output); err != nil {
		fatal(err)
	}
}

func buildUnsignedPackage(input, output string) error {
	reader, err := zip.OpenReader(input)
	if err != nil {
		return err
	}
	defer reader.Close()
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(output), ".unsigned-plugin-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryName)
		}
	}()

	writer := zip.NewWriter(temporary)
	foundSignature := false
	for _, entry := range reader.File {
		if entry.Name == pluginpkg.PackageSignaturePath {
			foundSignature = true
			continue
		}
		source, err := entry.Open()
		if err != nil {
			return err
		}
		header := entry.FileHeader
		destination, err := writer.CreateHeader(&header)
		if err == nil {
			_, err = io.Copy(destination, source)
		}
		closeErr := source.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if !foundSignature {
		return errors.New("input package does not contain a signature")
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Chmod(temporaryName, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, output); err != nil {
		return err
	}
	committed = true
	return nil
}

func fatal(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
