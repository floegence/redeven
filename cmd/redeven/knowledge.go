package main

import (
	"errors"
	"flag"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/knowledge"
)

func (c *cli) knowledgeCmd(args []string) int {
	if len(args) == 0 {
		writeText(c.stderr, knowledgeHelpText())
		return 2
	}
	if isHelpToken(args[0]) {
		writeText(c.stdout, knowledgeHelpText())
		return 0
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "bundle":
		return c.knowledgeBundleCmd(args[1:])
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown command for `redeven knowledge`: %s", strings.TrimSpace(args[0])),
			[]string{"Run `redeven help knowledge` for usage information."},
			knowledgeHelpText(),
		)
		return 2
	}
}

func (c *cli) knowledgeBundleCmd(args []string) int {
	fs := newCLIFlagSet("knowledge bundle")
	sourceRoot := fs.String("source-root", cleanAbs(filepath.Join("internal", "knowledge", "source")), "Knowledge source root")
	distRoot := fs.String("dist-root", cleanAbs(filepath.Join("internal", "knowledge", "dist")), "Dist output root")
	verifyOnly := fs.Bool("verify-only", false, "Verify dist files without rewriting")
	validateSourceOnly := fs.Bool("validate-source-only", false, "Validate source files only without reading dist")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, knowledgeBundleHelpText())
			return 0
		}
		message, details := translateFlagParseError("knowledge bundle", err)
		writeErrorWithHelp(c.stderr, message, details, knowledgeBundleHelpText())
		return 2
	}

	result, err := knowledge.BuildFromSource(cleanAbs(*sourceRoot))
	if err != nil {
		fmt.Fprintf(c.stderr, "knowledge bundle failed: %v\n", err)
		return 1
	}
	if *validateSourceOnly {
		fmt.Fprintf(c.stdout, "knowledge source validated: %s\n", cleanAbs(*sourceRoot))
		return 0
	}

	if *verifyOnly {
		if err := knowledge.VerifyDistFiles(cleanAbs(*distRoot), result); err != nil {
			fmt.Fprintf(c.stderr, "knowledge bundle verify failed: %v\n", err)
			return 1
		}
		fmt.Fprintf(c.stdout, "knowledge bundle verified: %s\n", cleanAbs(*distRoot))
		return 0
	}

	if err := knowledge.WriteDistFiles(cleanAbs(*distRoot), result); err != nil {
		fmt.Fprintf(c.stderr, "knowledge bundle write failed: %v\n", err)
		return 1
	}
	fmt.Fprintf(c.stdout, "knowledge bundle updated: %s\n", cleanAbs(*distRoot))
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
