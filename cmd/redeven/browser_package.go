package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/floegence/floe-native-apps/artifactcache"
	"github.com/floegence/redeven/internal/browserinstall"
)

// Desktop supplies only a pinned package identity and private cache placement.
// A different Runtime catalog fails before cache or network access.
func (c *cli) browserPackageCmd(args []string) int {
	flags := newCLIFlagSet("browser-package")
	id := flags.String("package-id", "", "Exact browser package identity")
	digest := flags.String("sha256", "", "Expected catalog digest")
	size := flags.Int64("size", 0, "Expected catalog archive size")
	cache := flags.String("cache", "", "Absolute private archive cache")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 || !filepath.IsAbs(*cache) {
		return 2
	}
	encoder := json.NewEncoder(c.stdout)
	pkg, err := browserinstall.ForID(*id)
	if err != nil || pkg.SHA256 != *digest || pkg.SizeBytes != *size {
		_ = encoder.Encode(map[string]string{"error": "package_mismatch"})
		return 1
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	result, err := artifactcache.Acquire(ctx, *cache, browserinstall.ArchiveSpec(pkg), artifactcache.Options{
		OnProgress: func(p artifactcache.Progress) error {
			return encoder.Encode(map[string]any{"phase": p.Phase, "received_bytes": p.ReceivedBytes, "total_bytes": p.TotalBytes})
		},
	})
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	if err := encoder.Encode(map[string]any{"complete": true, "from_cache": result.FromCache,
		"package": map[string]any{"id": pkg.ID, "sha256": pkg.SHA256, "size_bytes": pkg.SizeBytes},
	}); err != nil {
		return 1
	}
	return 0
}
