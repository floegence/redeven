package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/floegence/redeven/internal/boundarycontract"
)

func main() {
	check := flag.Bool("check", false, "verify the reviewed threadstore SQL catalog")
	write := flag.Bool("write-queries", false, "rewrite the SQL catalog while preserving reviewed metadata")
	root := flag.String("root", ".", "repository root")
	flag.Parse()
	if *check == *write {
		fmt.Fprintln(os.Stderr, "exactly one of --check or --write-queries is required")
		os.Exit(2)
	}
	manifestPath := filepath.Join(*root, "scripts", "contracts", "threadstore_boundary_manifest.json")
	manifest, err := boundarycontract.LoadThreadstoreBoundaryManifest(manifestPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	queries, err := boundarycontract.ScanThreadstoreSQL(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	columns, indexes, triggers, err := boundarycontract.LoadReviewedThreadstorePhysicalSchema(filepath.Join(*root, "internal", "ai", "threadstore", "reviewed_schema_manifest.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *write {
		manifest = boundarycontract.RefreshThreadstoreQueries(manifest, queries)
		manifest, err = boundarycontract.RefreshThreadstorePhysicalContracts(manifest, columns, indexes, triggers)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		manifest = boundarycontract.RefreshThreadstoreUsageContracts(manifest)
		if err := boundarycontract.WriteThreadstoreBoundaryManifest(manifestPath, manifest); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Printf("wrote %d threadstore SQL query contracts\n", len(manifest.Queries))
		return
	}
	issues := boundarycontract.ValidateThreadstoreBoundaryManifest(manifest, columns, indexes, triggers, queries)
	for _, issue := range issues {
		fmt.Fprintf(os.Stderr, "[ERROR] %s\n", issue)
	}
	if len(issues) > 0 {
		os.Exit(1)
	}
	fmt.Printf("[INFO] threadstore SQL catalog checked (%d reviewed calls)\n", len(queries))
}
