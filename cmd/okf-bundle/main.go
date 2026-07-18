package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/okf"
)

func main() {
	sourceRoot := flag.String("source-root", cleanAbs("okf"), "OKF source root")
	distRoot := flag.String("dist-root", cleanAbs(filepath.Join("okf", "dist")), "Dist output root")
	verifyOnly := flag.Bool("verify-only", false, "Verify dist files without rewriting")
	validateSourceOnly := flag.Bool("validate-source-only", false, "Validate source files only without reading dist")
	qualityMode := flag.String("quality-mode", string(okf.QualityOff), "Run OKF authoring quality checks: off, report, or strict")
	qualityJSON := flag.Bool("quality-json", false, "Write the OKF quality report as JSON")
	flag.Parse()
	mode := okf.QualityMode(strings.ToLower(strings.TrimSpace(*qualityMode)))
	if mode != okf.QualityOff && mode != okf.QualityReportMode && mode != okf.QualityStrict {
		fmt.Fprintf(os.Stderr, "invalid quality mode %q; use off, report, or strict\n", *qualityMode)
		os.Exit(2)
	}

	result, err := okf.BuildFromSource(cleanAbs(*sourceRoot))
	if err != nil {
		fmt.Fprintf(os.Stderr, "okf bundle build failed: %v\n", err)
		os.Exit(1)
	}
	if *validateSourceOnly {
		report := okf.ValidateBundleQuality(result.Bundle, cleanAbs(*sourceRoot), mode)
		if *qualityJSON {
			report.Issues = report.SortedIssues()
			if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
				fmt.Fprintf(os.Stderr, "encode OKF quality report failed: %v\n", err)
				os.Exit(1)
			}
		} else {
			for _, issue := range report.SortedIssues() {
				fmt.Fprintf(os.Stderr, "[%s] %s %s: %s\n", issue.Level, issue.Code, issue.Path, issue.Message)
			}
		}
		if mode == okf.QualityStrict && report.Errors > 0 {
			if !*qualityJSON {
				fmt.Fprintf(os.Stderr, "okf quality failed: %d errors, %d warnings\n", report.Errors, report.Warnings)
			}
			os.Exit(1)
		}
		if mode != okf.QualityOff && !*qualityJSON {
			fmt.Printf("okf quality checked: %d errors, %d warnings\n", report.Errors, report.Warnings)
		}
		if !*qualityJSON {
			fmt.Printf("okf source validated: %s\n", cleanAbs(*sourceRoot))
		}
		return
	}

	if *verifyOnly {
		if err := okf.VerifyDistFiles(cleanAbs(*distRoot), result); err != nil {
			fmt.Fprintf(os.Stderr, "okf bundle verify failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("okf bundle verified: %s\n", cleanAbs(*distRoot))
		return
	}

	if err := okf.WriteDistFiles(cleanAbs(*distRoot), result); err != nil {
		fmt.Fprintf(os.Stderr, "okf bundle write failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("okf bundle updated: %s\n", cleanAbs(*distRoot))
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
