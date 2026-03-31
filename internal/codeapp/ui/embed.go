package ui

import (
	"embed"
	"io/fs"
)

// embeddedDist contains the minimal runtime assets served under `/_redeven_proxy/*`.
//
// We embed the built artifacts (not sources) so the runtime binary is self-contained and
// the shipped UI version is strictly coupled to the runtime version.
//
// To update dist, edit `internal/codeapp/ui_src/` and run:
//
//	npm ci && npm run build
//
//go:embed all:dist
var embeddedDist embed.FS

// DistFS returns a fs.FS rooted at `dist/`.
func DistFS() fs.FS {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		// This should never happen unless the embed path changes.
		panic(err)
	}
	return sub
}
