package sidecar

import (
	"embed"
	"io/fs"
)

// embeddedDist contains the bundled sidecar artifacts.
//
// The agent embeds the build output (not sources) so the shipped runtime is strictly
// coupled to the agent version.
//
// To update dist, edit `internal/ai/sidecar_src/` and run:
//
//	pnpm install --frozen-lockfile && pnpm build
//
//go:embed all:dist
var embeddedDist embed.FS

func DistFS() fs.FS {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
