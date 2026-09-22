package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	nativeapps "github.com/floegence/floe-native-apps"
)

// Desktop uses the released component catalog through its bundled Runtime. The
// command accepts architecture and output placement, never caller-provided URLs.
func (c *cli) hostApplicationPackageCmd(args []string) int {
	flags := newCLIFlagSet("host-application-package")
	architecture := flags.String("arch", "", "Linux component architecture")
	cache := flags.String("cache", "", "Absolute private download cache")
	output := flags.String("output", "", "Absolute offline ZIP output")
	planJSON := flags.String("plan", "", "Receiver transfer plan restricted to the compiled catalog")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !filepath.IsAbs(*cache) || !filepath.IsAbs(*output) || flags.NArg() != 0 {
		return 2
	}
	pkg, err := nativeapps.ForPlatform("linux", *architecture)
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	var plan *nativeapps.TransferPlan
	if *planJSON != "" {
		var value nativeapps.TransferPlan
		decoder := json.NewDecoder(strings.NewReader(*planJSON))
		decoder.DisallowUnknownFields()
		if len(*planJSON) > 64<<10 || decoder.Decode(&value) != nil || decoder.Decode(new(any)) != io.EOF || value.PackageDigest != pkg.Digest() || value.Architecture != pkg.Architecture {
			fmt.Fprintln(c.stderr, "Desktop component catalog does not match the host transfer plan")
			return 3
		}
		plan = &value
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	file, err := os.CreateTemp(filepath.Dir(*output), ".native-package-*")
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	defer os.Remove(file.Name())
	expected := pkg.SizeBytes
	if plan != nil {
		expected = plan.MissingBytes
	}
	progress := func(n int64) {
		_ = json.NewEncoder(c.stdout).Encode(map[string]int64{"received_bytes": n, "expected_bytes": expected})
	}
	if plan == nil {
		err = nativeapps.WriteBundle(ctx, pkg, *cache, file, progress)
	} else {
		err = nativeapps.WriteTransferBundle(ctx, pkg, *plan, *cache, file, progress)
	}
	closed := file.Close()
	if err == nil {
		err = closed
	}
	if err == nil {
		err = os.Rename(file.Name(), *output)
	}
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	return 0
}
