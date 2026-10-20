package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/installer"
)

// Version is fixed by the release build, not resolved from a mutable endpoint.
var Version = "dev"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	ctx, deadline := context.WithTimeout(ctx, 10*time.Minute)
	defer deadline()
	if err := execute(ctx, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "Redeven installation failed: %v\n", err)
		os.Exit(1)
	}
}

func execute(ctx context.Context, args []string) error {
	if len(args) > 0 && args[0] == "version" {
		if len(args) != 1 {
			return errors.New("version does not accept arguments")
		}
		fmt.Printf("redeven-installer %s\n", Version)
		return nil
	}
	if len(args) > 0 && args[0] == "verify-release" {
		return verifyRelease(ctx, args[1:])
	}
	if len(args) > 0 && args[0] == "check-distribution" {
		flags := flag.NewFlagSet("redeven-installer check-distribution", flag.ContinueOnError)
		channel := flags.String("channel", "github", "official distribution channel: github or portal")
		version := flags.String("runtime-version", "", "exact release tag to promote")
		entry := flags.String("expected-entry", "", "reviewed installation entry source file")
		rollback := flags.String("rollback-entry", "", "reviewed emergency entry whose installer must also remain compatible")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 || *entry == "" {
			return errors.New("check-distribution requires --expected-entry and --runtime-version")
		}
		if err := installer.CheckDistribution(ctx, *channel, *version, *entry, *rollback); err != nil {
			return err
		}
		fmt.Printf("Release %s distribution entry and authenticated installer pins verified.\n", *version)
		return nil
	}
	if len(args) > 0 && args[0] == "install" {
		args = args[1:]
	}
	flags := flag.NewFlagSet("redeven-installer", flag.ContinueOnError)
	config := installer.Config{InstallerVersion: Version, Shell: os.Getenv("SHELL"), Output: os.Stdout}
	flags.StringVar(&config.Channel, "channel", "github", "official distribution channel: github or portal")
	flags.StringVar(&config.Version, "runtime-version", os.Getenv("REDEVEN_VERSION"), "explicit Runtime release tag")
	flags.StringVar(&config.Mode, "mode", os.Getenv("REDEVEN_INSTALL_MODE"), "install or upgrade")
	flags.StringVar(&config.InstallDir, "install-dir", os.Getenv("REDEVEN_INSTALL_DIR"), "stable writable activation root")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional installation arguments")
	}
	return installer.Run(ctx, config)
}

func verifyRelease(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("redeven-installer verify-release", flag.ContinueOnError)
	version := flags.String("release-version", "", "exact release tag whose publisher must match")
	directory := flags.String("directory", "", "directory containing the original SHA256SUMS, .sig and .pem")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *directory == "" || *version == "" || flags.NArg() != 0 {
		return errors.New("verify-release requires --directory and --release-version")
	}
	read := func(name string, limit int64) ([]byte, error) {
		path := filepath.Join(*directory, name)
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
			return nil, fmt.Errorf("invalid release material: %s", name)
		}
		return os.ReadFile(path)
	}
	payload, err := read("SHA256SUMS", 8<<20)
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
	if err := installer.VerifyRelease(ctx, payload, signature, certificate, *version); err != nil {
		return err
	}
	fmt.Printf("Release %s signature, publisher and transparency evidence verified.\n", *version)
	return nil
}
