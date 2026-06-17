package main

import (
	"errors"
	"flag"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/okf"
)

func (c *cli) okfCmd(args []string) int {
	if len(args) == 0 {
		writeText(c.stderr, okfHelpText())
		return 2
	}
	if isHelpToken(args[0]) {
		writeText(c.stdout, okfHelpText())
		return 0
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "bundle":
		return c.okfBundleCmd(args[1:])
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown command for `redeven okf`: %s", strings.TrimSpace(args[0])),
			[]string{"Run `redeven help okf` for usage information."},
			okfHelpText(),
		)
		return 2
	}
}

func (c *cli) okfBundleCmd(args []string) int {
	fs := newCLIFlagSet("okf bundle")
	sourceRoot := fs.String("source-root", cleanAbs("okf"), "OKF source root")
	distRoot := fs.String("dist-root", cleanAbs(filepath.Join("okf", "dist")), "Dist output root")
	verifyOnly := fs.Bool("verify-only", false, "Verify dist files without rewriting")
	validateSourceOnly := fs.Bool("validate-source-only", false, "Validate source files only without reading dist")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, okfBundleHelpText())
			return 0
		}
		message, details := translateFlagParseError("okf bundle", err)
		writeErrorWithHelp(c.stderr, message, details, okfBundleHelpText())
		return 2
	}

	result, err := okf.BuildFromSource(cleanAbs(*sourceRoot))
	if err != nil {
		fmt.Fprintf(c.stderr, "okf bundle failed: %v\n", err)
		return 1
	}
	if *validateSourceOnly {
		fmt.Fprintf(c.stdout, "okf source validated: %s\n", cleanAbs(*sourceRoot))
		return 0
	}

	if *verifyOnly {
		if err := okf.VerifyDistFiles(cleanAbs(*distRoot), result); err != nil {
			fmt.Fprintf(c.stderr, "okf bundle verify failed: %v\n", err)
			return 1
		}
		fmt.Fprintf(c.stdout, "okf bundle verified: %s\n", cleanAbs(*distRoot))
		return 0
	}

	if err := okf.WriteDistFiles(cleanAbs(*distRoot), result); err != nil {
		fmt.Fprintf(c.stderr, "okf bundle write failed: %v\n", err)
		return 1
	}
	fmt.Fprintf(c.stdout, "okf bundle updated: %s\n", cleanAbs(*distRoot))
	return 0
}

func cleanAbs(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(abs)
}
