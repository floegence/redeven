package managedwebservice

import (
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"strings"
)

// Frozen identity v1 hashed TemplateSpec v6, including its opening path and
// hooks. Compatibility compares exact candidate digests; it never rewrites an
// applied identity or authorizes changed code against an existing launch.
func matchesFrozenRuntimeIdentity(r *resolvedRuntime, secrets serviceSecrets, service *pfregistry.ManagedService) bool {
	spec := cloneTemplateSpec(r.Spec)
	spec.SchemaVersion = 6
	spec.StartupURL = nil
	paths := []string{spec.Endpoint.Path}
	if r.Spec.StartupURL != nil || (spec.Host != nil && spec.Host.OpenScript != "") {
		paths = append(paths, "/")
	}
	for _, path := range paths {
		spec.Endpoint.Path = path
		digest, err := runtimeSpecDigestDocument(1, spec, r.Configuration, r.Release, r.Binding, secrets, service)
		if err == nil && templateSourceRuntimeDigest(digest, r.Template.SourceSHA256) == service.RuntimeSpecSHA256 {
			return true
		}
	}
	return false
}

func sameAppliedRuntime(r *resolvedRuntime, service *pfregistry.ManagedService) bool {
	return r != nil && (r.MatchesApplied || strings.TrimSpace(service.RuntimeSpecSHA256) == r.RuntimeSpecSHA256)
}

// Catalog v0.7.0 tightened the existing Host hook's URL extraction. This frozen
// comparison preserves v1 execution identity while refusing to execute the new
// hook against a launch whose original hook cannot be verified.
const frozenV6HostAfterStart = `umask 077
[ ! -s "$REDEVEN_SERVICE_RUN_DIR/open-url" ] || exit 0
while :; do
  url=$(head -c 16777216 "$REDEVEN_SERVICE_OUTPUT_FILE" | awk 'index($0, "dsh web: ") == 1 { print substr($0, 10); exit }')
  if [ -n "$url" ]; then
    printf '%s\n' "$url" > "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp"
    mv "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp" "$REDEVEN_SERVICE_RUN_DIR/open-url"
    exit 0
  fi
  sleep 0.1
done`
const publishedV7HostAfterStart = `umask 077
[ ! -s "$REDEVEN_SERVICE_RUN_DIR/open-url" ] || exit 0
while :; do
  url=$(head -c 16777216 "$REDEVEN_SERVICE_OUTPUT_FILE" | awk 'index($0, "dsh web: ") == 1 { url=substr($0, 10); split(url, fields, /[[:space:]]+/); print fields[1]; exit }')
  if [ -n "$url" ]; then
    printf '%s\n' "$url" > "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp"
    mv "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp" "$REDEVEN_SERVICE_RUN_DIR/open-url"
    exit 0
  fi
  sleep 0.1
done`

func matchesFrozenHostOpeningRevision(r *resolvedRuntime, secrets serviceSecrets, service *pfregistry.ManagedService) bool {
	if r.Spec.Host == nil || r.Spec.Host.AfterStartScript != publishedV7HostAfterStart || r.Spec.Host.OpenScript != `cat "$REDEVEN_SERVICE_RUN_DIR/open-url"` {
		return false
	}
	copy := *r
	copy.Spec = cloneTemplateSpec(r.Spec)
	copy.Spec.Host.AfterStartScript = frozenV6HostAfterStart
	return matchesFrozenRuntimeIdentity(&copy, secrets, service)
}
