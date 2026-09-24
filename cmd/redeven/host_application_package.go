package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/floe-native-apps/artifactcache"
)

func hostApplicationCachePolicy() artifactcache.Policy {
	return artifactcache.Policy{MaxIdleAge: 7 * 24 * time.Hour, MaxBytes: 2_000_000_000}
}

// Desktop uses the released component catalog through its bundled Runtime. The
// command accepts architecture and output placement, never caller-provided URLs.
func (c *cli) hostApplicationPackageCmd(args []string) int {
	flags := newCLIFlagSet("host-application-package")
	maintenance := flags.Bool("maintenance", false, "Maintain the private cache without waiting for active preparation")
	architecture := flags.String("arch", "", "Linux component architecture")
	cache := flags.String("cache", "", "Absolute private download cache")
	output := flags.String("output", "", "Absolute offline ZIP output")
	planJSON := flags.String("plan", "", "Receiver transfer plan restricted to the compiled catalog")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !filepath.IsAbs(*cache) || flags.NArg() != 0 {
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *maintenance {
		if *architecture != "" || *output != "" || *planJSON != "" {
			return 2
		}
		report, err := artifactcache.Maintain(ctx, filepath.Join(*cache, "archives"), hostApplicationCachePolicy(), true)
		if errors.Is(err, artifactcache.ErrBusy) {
			_ = json.NewEncoder(c.stdout).Encode(map[string]bool{"busy": true})
			return 0
		}
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		_ = json.NewEncoder(c.stdout).Encode(report)
		return 0
	}
	if !filepath.IsAbs(*output) {
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
	file, err := os.CreateTemp(filepath.Dir(*output), ".native-package-*")
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	defer os.Remove(file.Name())
	options := nativeapps.BundleOptions{
		CachePolicy: hostApplicationCachePolicy(),
		OnProgress:  func(progress nativeapps.BundleProgress) error { return json.NewEncoder(c.stdout).Encode(progress) },
		OnMaintenance: func(_ artifactcache.Maintenance, err error) {
			if err != nil {
				fmt.Fprintf(c.stderr, "Component cache maintenance: %v\n", err)
			}
		},
	}
	if plan == nil {
		err = nativeapps.WriteBundleWithOptions(ctx, pkg, *cache, file, options)
	} else {
		err = nativeapps.WriteTransferBundleWithOptions(ctx, pkg, *plan, *cache, file, options)
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
