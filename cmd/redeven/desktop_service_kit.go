package main

import (
	"context"
	"encoding/json"
	"flag"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	nativeapps "github.com/floegence/floe-native-apps"
)

// Desktop extracts the published SDK closure from its trusted bundled Runtime.
// This command never downloads, installs, elevates or accepts credentials.
func (c *cli) desktopServiceKitCmd(args []string) int {
	flags := flag.NewFlagSet("desktop-service-kit", flag.ContinueOnError)
	flags.SetOutput(c.stderr)
	architecture := flags.String("arch", "", "Linux target architecture: amd64 or arm64")
	output := flags.String("output", "", "new absolute private output directory")
	if flags.Parse(args) != nil {
		return 2
	}
	if flags.NArg() != 0 || !filepath.IsAbs(*output) || (*architecture != "amd64" && *architecture != "arm64") {
		return 2
	}
	kit, err := nativeapps.LoginScreenServiceKit(*architecture)
	if err == nil {
		err = kit.Write(context.Background(), *output)
	}
	if err != nil {
		return 1
	}
	if json.NewEncoder(c.stdout).Encode(kit) != nil {
		return 1
	}
	return 0
}

// This command runs as the SSH user before administrator authorization. The
// cache belongs to the selected Runtime; the result is a verified SDK archive.
func (c *cli) desktopServiceMediaCmd(args []string) int {
	flags := flag.NewFlagSet("desktop-service-media", flag.ContinueOnError)
	flags.SetOutput(c.stderr)
	cache := flags.String("cache", "", "absolute Runtime media cache")
	output := flags.String("output", "", "new absolute media archive")
	if flags.Parse(args) != nil || flags.NArg() != 0 || !filepath.IsAbs(*cache) || !filepath.IsAbs(*output) || os.Geteuid() == 0 {
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	encoder := json.NewEncoder(c.stdout)
	digest, err := nativeapps.PrepareLoginScreenMedia(ctx, *cache, *output, func(status nativeapps.Status) {
		if encoder.Encode(status) != nil {
			cancel()
		}
	})
	if err != nil {
		return 1
	}
	if encoder.Encode(map[string]string{"media_sha256": digest}) != nil {
		return 1
	}
	return 0
}
