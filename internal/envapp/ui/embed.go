package ui

import (
	"embed"
	"io/fs"
)

// embeddedDist contains the Env App built artifacts served under `/_redeven_proxy/env/*`.
//
// We embed the build output (not sources) so the shipped Env App UI is strictly coupled
// to the agent version.
//
// To update dist, edit `internal/envapp/ui_src/` and run:
//
//	pnpm install --frozen-lockfile && pnpm build
//
//go:embed all:dist
var embeddedDist embed.FS

// DistFS returns a fs.FS rooted at `dist/`.
func DistFS() fs.FS {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
