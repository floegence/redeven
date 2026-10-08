package main

import (
	"context"
	"encoding/json"
	"flag"
	"path/filepath"

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
